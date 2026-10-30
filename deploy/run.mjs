// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 northbit
//
// End-to-end CallSeal run on a real Midnight network (local devnet or preview):
// deploy, oracle closes, register, seal two calls, prove one hit in ZK,
// expire the hidden loser, selectively reveal the winner. Every step is a real,
// proven, balanced transaction. Results are written to deploy/runs/<network>.json.
//
//   MIDNIGHT_NETWORK=local   node deploy/run.mjs   (uses the funded dev genesis seed)
//   MIDNIGHT_NETWORK=preview MIDNIGHT_SEED_FILE=/path/to/seed node deploy/run.mjs
//
// The wallet seed is read from a file and never printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  MidnightWalletProvider, FluentWalletBuilder, DEFAULT_DUST_OPTIONS, syncWallet, inMemoryPrivateStateProvider,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import { unshieldedToken, ZswapSecretKeys, DustSecretKey } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { Contract, ledger } from '../contract/managed/callseal/contract/index.js';
import {
  witnesses, newPrivateState, makeOpening, publicKeyOf, toFixed, hex, statusName, randomBytes, describeOpening,
} from '../src/callseal.mjs';
import { getNetwork } from './network.mjs';

globalThis.WebSocket = WebSocket;
const here = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(here, '../contract/managed/callseal');
const net = getNetwork();
// testkit logs "Your wallet seed is: ..." at info level. Never let a seed reach a log.
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  hooks: {
    logMethod(args, method) {
      const redact = (v) => (typeof v === 'string' ? v.replace(/(wallet seed is:?\s*)[0-9a-fA-F]+/gi, '$1<redacted>') : v);
      return method.apply(this, args.map(redact));
    },
  },
});
const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}Z]`, ...a);

const LOCAL_DEV_SEED = '0000000000000000000000000000000000000000000000000000000000000001'; // dev-preset genesis wallet

function readSeed() {
  if (net.name === 'local') return process.env.MIDNIGHT_SEED_FILE ? fs.readFileSync(process.env.MIDNIGHT_SEED_FILE, 'utf8').trim() : LOCAL_DEV_SEED;
  const f = process.env.MIDNIGHT_SEED_FILE;
  if (!f) throw new Error('MIDNIGHT_SEED_FILE is required for remote networks');
  return fs.readFileSync(f, 'utf8').trim();
}

// Why: once an idle chain's fee price sits at its floor, a cheap call like proveHit costs 0 DUST before
// balancing. The dust wallet (wallet-sdk-dust-wallet 4.x) then selects no DUST inputs and either loops
// forever or builds an empty DustActions intent that panics in the ledger wasm ("unreachable").
// A small fixed overhead keeps every fee above zero so the wallet always spends one DUST coin.
const FEE_OVERHEAD_SPECKS = 1_000_000_000n;

async function buildWallet(seed) {
  const { wallet, seeds, keystore } = await FluentWalletBuilder.forEnvironment(net)
    .withSeed(seed)
    .withDustOptions({ ...DEFAULT_DUST_OPTIONS, additionalFeeOverhead: FEE_OVERHEAD_SPECKS })
    .buildWithoutStarting();
  return MidnightWalletProvider.withWallet(
    logger, net, wallet, ZswapSecretKeys.fromSeed(seeds.shielded), DustSecretKey.fromSeed(seeds.dust), keystore,
  );
}

const CompiledCallSeal = CompiledContract.make('CallSeal', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

async function waitForDust(wallet, timeoutMs = 600_000) {
  say('waiting for spendable DUST ...');
  await Rx.firstValueFrom(wallet.state().pipe(
    Rx.filter((s) => s.dust.availableCoins.length > 0),
    Rx.take(1),
    Rx.timeout({ each: timeoutMs, with: () => Rx.throwError(() => new Error('no DUST in time')) }),
  ));
}

async function waitForNight(wallet, timeoutMs = 6 * 60 * 60_000) {
  say('waiting for NIGHT from the faucet ...');
  const night = unshieldedToken().raw;
  await Rx.firstValueFrom(wallet.state().pipe(
    Rx.filter((s) => s.unshielded.availableCoins.some((c) => c.utxo.type === night)),
    Rx.take(1),
    Rx.timeout({ each: timeoutMs, with: () => Rx.throwError(() => new Error('no NIGHT in time')) }),
  ));
}

// Register NIGHT UTXOs for DUST generation (adapted from midnight-examples, Apache-2.0).
async function registerNightForDust(provider) {
  const wallet = provider.wallet;
  const keystore = provider.unshieldedKeystore;
  const state = await Rx.firstValueFrom(wallet.state());
  if (state.dust.balance(new Date()) > 0n) return say('wallet already holds DUST');
  const night = unshieldedToken().raw;
  const unregistered = state.unshielded.availableCoins.filter(
    (c) => c.utxo.type === night && !c.meta.registeredForDustGeneration,
  );
  if (unregistered.length === 0) return say('NIGHT already registered for DUST');
  say(`registering ${unregistered.length} NIGHT UTXO(s) for DUST generation ...`);
  const recipe = await wallet.registerNightUtxosForDustGeneration(
    unregistered, keystore.getPublicKey(), (payload) => keystore.signData(payload),
  );
  const txId = await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
  say(`DUST registration tx ${txId}`);
}

async function main() {
  setNetworkId(net.networkId);
  say(`network: ${net.name} (${net.networkId})`);
  const wallet = await buildWallet(readSeed());
  if (net.name === 'local') {
    // Local dev genesis wallet: already funded, DUST already generating.
    await wallet.start();
    await syncWallet(wallet.wallet, 1_000, 30 * 60_000);
  } else {
    // Fresh testnet wallet: wait for faucet NIGHT, register it for DUST, wait for DUST.
    await wallet.start(false);
    await syncWallet(wallet.wallet, 1_000, 30 * 60_000).catch((e) => say(`sync check soft-failed (${e.message}); continuing`));
    say(`unshielded address: ${String(wallet.unshieldedKeystore.getBech32Address())}`);
    await waitForNight(wallet.wallet);
    await registerNightForDust(wallet);
  }
  say(`wallet synced; unshielded address: ${String(wallet.unshieldedKeystore.getBech32Address())}`);
  await waitForDust(wallet.wallet, net.name === 'local' ? 600_000 : 30 * 60_000);

  const zk = new NodeZkConfigProvider(zkConfigPath);
  const providers = {
    privateStateProvider: inMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(net.indexer, net.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(net.proofServer, zk),
    walletProvider: wallet,
    midnightProvider: wallet,
  };

  const run = { network: net.name, networkId: net.networkId, startedAt: new Date().toISOString(), txs: [] };
  const record = (step, tx, extra = {}) => {
    const p = tx.public ?? tx.deployTxData?.public;
    const row = { step, txId: p.txId, txHash: p.txHash, blockHeight: p.blockHeight, blockHash: p.blockHash, status: p.status, ...extra };
    run.txs.push(row);
    say(`✔ ${step}  tx ${p.txHash ?? p.txId}  block ${p.blockHeight ?? '?'}`);
  };

  // Actors: oracle and two analysts, each with their own private state id.
  const oracleSk = randomBytes(32);
  const ps = { oracle: newPrivateState(oracleSk), alice: newPrivateState() };
  const minMoveBps = 200n; const graceRounds = 1n;

  say('deploying CallSeal ...');
  const deployed = await deployContract(providers, {
    compiledContract: CompiledCallSeal,
    privateStateId: 'oracle',
    initialPrivateState: ps.oracle,
    args: [publicKeyOf(oracleSk), minMoveBps, graceRounds],
  });
  const contractAddress = deployed.deployTxData.public.contractAddress;
  run.contractAddress = contractAddress;
  record('deploy', deployed, { contractAddress });
  providers.privateStateProvider.setContractAddress?.(contractAddress);
  await providers.privateStateProvider.set('alice', ps.alice);

  const call = async (actor, circuitId, args, label) => {
    const tx = await submitCallTx(providers, { compiledContract: CompiledCallSeal, contractAddress, privateStateId: actor, circuitId, args });
    record(label ?? `${actor}.${circuitId}`, tx, { result: tx.private?.result === undefined ? undefined : JSON.parse(JSON.stringify(tx.private.result, (_k, v) => typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? hex(v) : v)) });
    return tx;
  };
  const readLedger = async () => ledger((await providers.publicDataProvider.queryContractState(contractAddress)).data);
  const P = (a) => a.map(toFixed);

  await call('oracle', 'publishCloses', [P([98000, 3500, 0.5, 0.05])], 'oracle.publishCloses(round 0)');
  await call('alice', 'registerAnalyst', [], 'alice.registerAnalyst');

  const seal = async (opening, expiry, label) => {
    const cur = await providers.privateStateProvider.get('alice');
    await providers.privateStateProvider.set('alice', { ...cur, pending: opening });
    const tx = await call('alice', 'sealCall', [expiry], label);
    const id = tx.private.result;
    const after = await providers.privateStateProvider.get('alice');
    await providers.privateStateProvider.set('alice', { ...after, pending: null, openings: { ...after.openings, [id.toString()]: opening } });
    return id;
  };
  const hit = makeOpening({ asset: 'BTC', direction: 'ABOVE', level: toFixed(101000) });
  const miss = makeOpening({ asset: 'ETH', direction: 'BELOW', level: toFixed(3300) });
  const idHit = await seal(hit, 1n, `alice.sealCall #0 (private: ${describeOpening(hit)})`);
  const idMiss = await seal(miss, 1n, `alice.sealCall #1 (private: ${describeOpening(miss)})`);

  await call('oracle', 'publishCloses', [P([102000, 3450, 0.52, 0.06])], 'oracle.publishCloses(round 1 = expiry)');
  await call('alice', 'proveHit', [idHit], 'alice.proveHit #0 (ZK: hit, call stays sealed)');
  await call('oracle', 'publishCloses', [P([101500, 3480, 0.51, 0.06])], 'oracle.publishCloses(round 2)');
  await call('oracle', 'expireCall', [idMiss], 'anyone.expireCall #1 (hidden loser counted)');
  await call('alice', 'revealCall', [idHit], 'alice.revealCall #0 (optional disclosure)');

  const l = await readLedger();
  const alicePk = publicKeyOf(ps.alice.secretKey);
  const st = l.analysts.lookup(alicePk);
  run.final = {
    round: l.round.toString(),
    totalSealed: l.totalSealed.toString(), totalHits: l.totalHits.toString(), totalMisses: l.totalMisses.toString(),
    alice: { pk: hex(alicePk), calls: st.calls.toString(), hits: st.hits.toString(), misses: st.misses.toString() },
    call0: statusName(l.calls.lookup(idHit).status), call1: statusName(l.calls.lookup(idMiss).status),
    call1Revealed: l.revealed.member(idMiss),
    call0Revealed: l.revealed.member(idHit) ? describeOpening({ ...l.revealed.lookup(idHit) }) : null,
  };
  run.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.join(here, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(here, 'runs', `${net.name}.json`), JSON.stringify(run, null, 2));
  say('final on-chain state:', JSON.stringify(run.final));
  say(`contract ${contractAddress} — wrote deploy/runs/${net.name}.json`);
  await wallet.stop();
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
