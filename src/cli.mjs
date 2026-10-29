#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 northbit
//
// CallSeal CLI. `demo` plays a full season against the compiled contract
// (in-process runtime, no network needed). `verify` checks a shared opening
// against a commitment, the way a paying subscriber would.
import {
  CallSealSim, CallStatus, describeOpening, statusName, short, hex, toFixed, fromFixed, ASSETS, makeOpening,
  commitmentOf,
} from './callseal.mjs';

const C = process.stdout.isTTY || process.env.FORCE_COLOR
  ? { b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m` }
  : { b: (s) => s, d: (s) => s, g: (s) => s, r: (s) => s, y: (s) => s, c: (s) => s };
const pause = (ms) => new Promise((r) => setTimeout(r, process.env.CALLSEAL_FAST ? 0 : ms));
const line = (s = '') => console.log(s);

function printBoard(sim) {
  line(C.b('  analyst      calls  hits  misses  open  hit-rate'));
  for (const r of sim.board()) {
    const rate = r.hitRate === null ? '   -' : `${(r.hitRate * 100).toFixed(0).padStart(3)}%`;
    line(`  ${r.name.padEnd(11)} ${String(r.calls).padStart(5)} ${String(r.hits).padStart(5)} ${String(r.misses).padStart(7)} ${String(r.open).padStart(5)}  ${rate}`);
  }
}

function printPublicCall(sim, id) {
  const r = sim.callRecord(id);
  line(C.d(`    public ledger: call #${id} analyst=${short(r.analyst)}… commitment=${short(r.commitment)}… sealed@${r.sealedRound} expiry@${r.expiryRound} status=${statusName(r.status)}`));
}

function closes(sim, round) {
  const v = sim.ledger.closes.lookup(BigInt(round));
  return ASSETS.map((a, i) => `${a} ${fromFixed(v[i])}`).join('  ');
}

async function demo() {
  line(C.b('\nCallSeal — prove your trading track record, never leak a call.'));
  line(C.d('Every step below runs the compiled Compact circuits (compact-runtime). A failed assert = no valid proof.\n'));
  const sim = new CallSealSim({ minMoveBps: 200n, graceRounds: 1n });
  line(`${C.c('oracle')}   deploys CallSeal: min move 2.00%, proof window 1 round`);
  sim.publishCloses([98000, 3500, 0.5, 0.05]);
  line(`${C.c('oracle')}   round 0 closes: ${closes(sim, 0)}`);
  await pause(600);
  for (const n of ['alice', 'bob']) { sim.register(n); line(`${C.c(n.padEnd(8))} registers as analyst  pk=${short(sim.actors[n].pk)}…`); }
  await pause(600);

  line(C.b('\n1) Seal calls. Only a commitment goes on-chain.'));
  const calls = [];
  const seal = (n, o) => {
    const r = sim.seal(n, o); calls.push({ n, ...r });
    line(`${C.c(n.padEnd(8))} seals #${r.id}  ${C.y('private:')} ${describeOpening(r.opening)}  expiry round ${o.expiryRound}`);
    printPublicCall(sim, r.id);
  };
  seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 101000, expiryRound: 2 });
  seal('alice', { asset: 'ETH', direction: 'BELOW', level: 3300, expiryRound: 2 });
  seal('bob', { asset: 'ADA', direction: 'ABOVE', level: 0.52, expiryRound: 2 });
  seal('bob', { asset: 'NIGHT', direction: 'BELOW', level: 0.045, expiryRound: 2 });
  await pause(600);

  line(C.b('\n2) Gaming attempts are rejected inside the proof.'));
  try { sim.seal('bob', { asset: 'BTC', direction: 'ABOVE', level: 98500, expiryRound: 2 }); }
  catch (e) { line(`${C.c('bob     ')} tries "BTC >= 98500" (0.5% away)  → ${C.r('rejected:')} ${e.message.replace(/^.*failed assert: /, '')}`); }
  await pause(600);

  line(C.b('\n3) Market moves. Oracle publishes closes.'));
  sim.publishCloses([99200, 3460, 0.505, 0.051]);
  line(`${C.c('oracle')}   round 1 closes: ${closes(sim, 1)}`);
  sim.publishCloses([102300, 3420, 0.531, 0.049]);
  line(`${C.c('oracle')}   round 2 closes: ${closes(sim, 2)}   ${C.d('(expiry round)')}`);
  await pause(600);

  line(C.b('\n4) Prove hits in zero knowledge. The call itself stays sealed.'));
  for (const c of calls) {
    try {
      sim.proveHit(c.n, c.id);
      line(`${C.c(c.n.padEnd(8))} proveHit #${c.id} → ${C.g('HIT proven')}  ${C.d('(public learns: hit. not asset, side or level)')}`);
    } catch (e) {
      line(`${C.c(c.n.padEnd(8))} proveHit #${c.id} → ${C.r('cannot prove')} (${e.message.replace(/^.*failed assert: /, '')}); stays sealed`);
    }
  }
  try { sim.proveHit('bob', calls[0].id); } catch (e) { line(`${C.c('bob     ')} tries to claim alice's #0 → ${C.r('rejected:')} ${e.message.replace(/^.*failed assert: /, '')}`); }
  await pause(600);

  line(C.b('\n5) Proof window closes. Hidden losers are counted, by anyone.'));
  sim.publishCloses([101000, 3440, 0.52, 0.05]);
  sim.addActor('anyone');
  for (const c of calls) {
    if (sim.callRecord(c.id).status === CallStatus.SEALED) {
      sim.expire('anyone', c.id);
      line(`${C.c('anyone  ')} expireCall #${c.id} → ${C.r('MISS')}`);
    }
  }
  await pause(600);

  line(C.b('\n6) Optional: alice reveals her winner to market herself.'));
  sim.reveal('alice', calls[0].id);
  const rv = sim.ledger.revealed.lookup(calls[0].id);
  line(`${C.c('alice   ')} revealCall #0 → public now: ${describeOpening(rv)}`);
  line(C.d('         bob\'s calls stay private forever; his record is still complete.'));
  await pause(600);

  line(C.b('\n7) Subscriber check (off-chain): alice DMs a paying subscriber the opening of #1.'));
  const ok = hex(commitmentOf(sim.actors.alice.pk, calls[1].opening)) === hex(sim.callRecord(calls[1].id).commitment);
  const forged = hex(commitmentOf(sim.actors.alice.pk, { ...calls[1].opening, level: toFixed(3500) })) === hex(sim.callRecord(calls[1].id).commitment);
  line(`  real opening matches commitment: ${ok ? C.g('yes') : C.r('no')}    edited level matches: ${forged ? C.r('yes') : C.g('no')}`);

  line(C.b('\nPublic leaderboard (straight from the ledger):'));
  printBoard(sim);
  const l = sim.ledger;
  line(C.d(`\n  totals: sealed ${l.totalSealed}, hits ${l.totalHits}, misses ${l.totalMisses}. Every sealed call is scored. No cherry-picking.\n`));
}

function verify(argv) {
  const [analystHex, commitmentHex, asset, direction, level, saltHex] = argv;
  if (!saltHex) {
    line('usage: callseal verify <analystPkHex> <commitmentHex> <ASSET> <ABOVE|BELOW> <level> <saltHex>');
    process.exit(2);
  }
  const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
  const o = makeOpening({ asset, direction, level: toFixed(level), salt: fromHex(saltHex) });
  const ok = hex(commitmentOf(fromHex(analystHex), o)) === commitmentHex.toLowerCase();
  line(ok ? C.g('MATCH: this is the call that was sealed on-chain') : C.r('NO MATCH'));
  process.exit(ok ? 0 : 1);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'demo' || !cmd) await demo();
else if (cmd === 'verify') verify(rest);
else { line('commands: demo | verify'); process.exit(2); }
