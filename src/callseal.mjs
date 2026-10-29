// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 northbit
//
// Shared CallSeal logic: private state, witnesses, and an in-memory simulator
// that executes the compiled Compact circuits with @midnight-ntwrk/compact-runtime.
// The same module runs in Node (CLI, tests) and in the browser (web demo).

import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  pureCircuits,
  Direction,
  CallStatus,
} from '../contract/managed/callseal/contract/index.js';

export { Direction, CallStatus, pureCircuits, ledger };

export const ASSETS = ['BTC', 'ETH', 'ADA', 'NIGHT'];
export const PRICE_SCALE = 10_000n; // prices are fixed-point with 4 decimals

export const toFixed = (x) => BigInt(Math.round(Number(x) * Number(PRICE_SCALE)));
export const fromFixed = (v) => Number(v) / Number(PRICE_SCALE);
export const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export const short = (u8) => hex(u8).slice(0, 8);

export function randomBytes(n = 32) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

// ---- private state ------------------------------------------------------------
// Everything in here stays on the user's device. Only what a circuit
// explicitly disclose()s ever reaches the public ledger.
export function newPrivateState(secretKey = randomBytes(32)) {
  return { secretKey, pending: null, openings: {} };
}

export function makeOpening({ asset, direction, level, salt = randomBytes(32) }) {
  const a = typeof asset === 'string' ? ASSETS.indexOf(asset.toUpperCase()) : asset;
  if (a < 0 || a > 3) throw new Error(`unknown asset ${asset}`);
  const d = typeof direction === 'string'
    ? (direction.toUpperCase() === 'ABOVE' ? Direction.ABOVE : Direction.BELOW)
    : direction;
  return { asset: BigInt(a), direction: d, level: BigInt(level), salt };
}

export const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
  pendingCall: ({ privateState }) => {
    if (!privateState.pending) throw new Error('no pending call in private state');
    return [privateState, privateState.pending];
  },
  storedOpening: ({ privateState }, id) => {
    const o = privateState.openings[id.toString()];
    if (!o) throw new Error(`no opening stored for call ${id}`);
    return [privateState, o];
  },
};

export const publicKeyOf = (sk) => pureCircuits.publicKey(sk);
export const commitmentOf = (authorPk, opening) => pureCircuits.commitmentOf(authorPk, opening);

// Off-chain check a subscriber runs when an analyst shares an opening privately.
export function verifyOpening(record, opening) {
  return hex(commitmentOf(record.analyst, opening)) === hex(record.commitment);
}

export function describeOpening(o) {
  const dir = o.direction === Direction.ABOVE ? '>=' : '<=';
  return `${ASSETS[Number(o.asset)]} ${dir} ${fromFixed(o.level)}`;
}

export const statusName = (s) => ['SEALED', 'HIT', 'MISS'][s];

// ---- simulator -------------------------------------------------------------------
// Holds one public contract state and any number of actors with their own
// private state. Each call runs the real compiled circuit; a failed assert
// throws exactly as it would when building the proof for a real transaction.
export class CallSealSim {
  constructor({ oracleSecretKey = randomBytes(32), minMoveBps = 200n, graceRounds = 2n } = {}) {
    this.contract = new Contract(witnesses);
    this.address = sampleContractAddress();
    this.actors = {};
    this.log = [];
    const oracle = this.addActor('oracle', oracleSecretKey);
    const init = this.contract.initialState(
      createConstructorContext(oracle.ps, '0'.repeat(64)),
      publicKeyOf(oracleSecretKey),
      BigInt(minMoveBps),
      BigInt(graceRounds),
    );
    this.state = init.currentContractState.data;
  }

  addActor(name, secretKey = randomBytes(32)) {
    const actor = { name, ps: newPrivateState(secretKey), pk: publicKeyOf(secretKey) };
    this.actors[name] = actor;
    return actor;
  }

  get ledger() {
    return ledger(this.state);
  }

  // Run an impure circuit as `actorName`. Returns { result, proofData, gasCost }.
  call(actorName, circuit, ...args) {
    const actor = this.actors[actorName];
    if (!actor) throw new Error(`unknown actor ${actorName}`);
    const ctx = createCircuitContext(this.address, '0'.repeat(64), this.state, actor.ps);
    const res = this.contract.impureCircuits[circuit](ctx, ...args);
    this.state = res.context.currentQueryContext.state;
    actor.ps = res.context.currentPrivateState;
    this.log.push({ actor: actorName, circuit, args });
    return res;
  }

  // ---- convenience wrappers --------------------------------------------------------
  publishCloses(prices) {
    const v = prices.map((p) => (typeof p === 'bigint' ? p : toFixed(p)));
    return this.call('oracle', 'publishCloses', v).result;
  }

  register(name) {
    if (!this.actors[name]) this.addActor(name);
    return this.call(name, 'registerAnalyst').result;
  }

  seal(name, { asset, direction, level, expiryRound }) {
    const actor = this.actors[name];
    const opening = makeOpening({ asset, direction, level: typeof level === 'bigint' ? level : toFixed(level) });
    actor.ps = { ...actor.ps, pending: opening };
    const res = this.call(name, 'sealCall', BigInt(expiryRound));
    const id = res.result;
    actor.ps = { ...actor.ps, pending: null, openings: { ...actor.ps.openings, [id.toString()]: opening } };
    return { id, opening, proofData: res.proofData };
  }

  proveHit(name, id) { return this.call(name, 'proveHit', BigInt(id)); }
  expire(name, id) { return this.call(name, 'expireCall', BigInt(id)).result; }
  reveal(name, id) { return this.call(name, 'revealCall', BigInt(id)).result; }

  // ---- read helpers --------------------------------------------------------------------
  callRecord(id) { return this.ledger.calls.lookup(BigInt(id)); }

  stats(pk) {
    const l = this.ledger;
    return l.analysts.member(pk) ? l.analysts.lookup(pk) : null;
  }

  board() {
    const l = this.ledger;
    const rows = [];
    for (const [pk, s] of l.analysts) {
      const resolved = Number(s.hits + s.misses);
      rows.push({
        analyst: hex(pk),
        name: Object.values(this.actors).find((a) => hex(a.pk) === hex(pk))?.name ?? short(pk),
        calls: Number(s.calls),
        hits: Number(s.hits),
        misses: Number(s.misses),
        open: Number(s.calls) - resolved,
        hitRate: resolved ? Number(s.hits) / resolved : null,
      });
    }
    return rows.sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.calls - a.calls);
  }
}

// Serialise anything (bigints, Uint8Arrays, nested) for leak scanning and display.
export function toJSONSafe(x) {
  return JSON.stringify(x, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Uint8Array) return hex(v);
    return v;
  });
}

