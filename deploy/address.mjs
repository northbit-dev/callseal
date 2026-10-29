// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 northbit
// Print the unshielded (NIGHT) and DUST addresses for a seed file. Never prints the seed.
//   MIDNIGHT_NETWORK=preview MIDNIGHT_SEED_FILE=/path/to/seed node deploy/address.mjs
import fs from 'node:fs';
import { WalletSeeds } from '@midnight-ntwrk/testkit-js';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk/unshielded';
import { DustSecretKey } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { DustAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk';
import { getNetwork } from './network.mjs';

const net = getNetwork();
const seed = fs.readFileSync(process.env.MIDNIGHT_SEED_FILE, 'utf8').trim();
const seeds = WalletSeeds.fromMasterSeed(seed);
const ks = createKeystore(seeds.unshielded, net.networkId);
console.log(`network:     ${net.name}`);
console.log(`unshielded:  ${String(ks.getBech32Address())}`);
try {
  const dpk = DustSecretKey.fromSeed(seeds.dust).publicKey;
  console.log(`dust:        ${MidnightBech32m.encode(net.networkId, new DustAddress(dpk)).asString()}`);
} catch (e) { console.log(`dust:        (derive skipped: ${e.message})`); }
if (net.faucet) console.log(`faucet:      ${net.faucet}`);
