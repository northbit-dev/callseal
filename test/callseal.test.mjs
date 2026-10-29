// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 northbit
// Runs the compiled Compact circuits in-process with @midnight-ntwrk/compact-runtime.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CallSealSim, CallStatus, Direction, toFixed, hex, makeOpening, verifyOpening,
  pureCircuits, statusName,
} from '../src/callseal.mjs';

const P0 = [98000, 3500, 0.5, 0.05]; // BTC ETH ADA NIGHT

// Fresh sim with one published round and a registered analyst "alice".
function setup(opts) {
  const s = new CallSealSim(opts);
  s.publishCloses(P0); // round 0 -> now = 1
  s.register('alice');
  return s;
}
const advance = (s, n, prices = P0) => { for (let i = 0; i < n; i++) s.publishCloses(prices); };
const rejects = (fn, msg) => assert.throws(fn, (e) => { assert.match(String(e.message ?? e), msg); return true; });

describe('constructor and oracle', () => {
  test('initial ledger holds parameters and empty state', () => {
    const s = new CallSealSim({ minMoveBps: 300n, graceRounds: 4n });
    const l = s.ledger;
    assert.equal(l.minMoveBps, 300n);
    assert.equal(l.graceRounds, 4n);
    assert.equal(l.round, 0n);
    assert.equal(l.nextId, 0n);
    assert.equal(hex(l.oracle), hex(s.actors.oracle.pk));
  });

  test('oracle publishes closes and advances the round', () => {
    const s = new CallSealSim();
    assert.equal(s.publishCloses(P0), 0n);
    assert.equal(s.publishCloses([99000, 3600, 0.51, 0.06]), 1n);
    assert.equal(s.ledger.round, 2n);
    assert.deepEqual(s.ledger.closes.lookup(1n), [toFixed(99000), toFixed(3600), toFixed(0.51), toFixed(0.06)]);
  });

  test('only the oracle can publish closes', () => {
    const s = new CallSealSim();
    s.addActor('mallory');
    rejects(() => s.call('mallory', 'publishCloses', P0.map(toFixed)), /only the oracle/);
  });
});

describe('registration', () => {
  test('analyst registers once with zero stats', () => {
    const s = new CallSealSim();
    const pk = s.register('alice');
    assert.equal(hex(pk), hex(s.actors.alice.pk));
    assert.deepEqual(s.stats(pk), { calls: 0n, hits: 0n, misses: 0n });
    rejects(() => s.register('alice'), /already registered/);
  });
});

describe('sealing', () => {
  test('seal stores only a commitment and rounds', () => {
    const s = setup();
    const { id, opening } = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 101000, expiryRound: 3 });
    const r = s.callRecord(id);
    assert.equal(r.status, CallStatus.SEALED);
    assert.equal(r.sealedRound, 1n);
    assert.equal(r.expiryRound, 3n);
    assert.equal(hex(r.analyst), hex(s.actors.alice.pk));
    assert.ok(verifyOpening(r, opening), 'opening matches commitment off-chain');
    assert.equal(s.stats(s.actors.alice.pk).calls, 1n);
    assert.equal(s.ledger.totalSealed, 1n);
  });

  test('unregistered analyst cannot seal', () => {
    const s = setup();
    s.addActor('bob');
    rejects(() => s.seal('bob', { asset: 'BTC', direction: 'ABOVE', level: 101000, expiryRound: 2 }), /unknown analyst/);
  });

  test('cannot seal before any close exists', () => {
    const s = new CallSealSim();
    s.register('alice');
    rejects(() => s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 101000, expiryRound: 2 }), /no closes/);
  });

  test('expiry in the past is rejected', () => {
    const s = setup();
    advance(s, 2); // now = 3
    rejects(() => s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 101000, expiryRound: 2 }), /past/);
  });

  test('trivial calls are rejected inside the proof (min move 2%)', () => {
    const s = setup(); // ref BTC = 98000, 2% => ABOVE needs >= 99960, BELOW needs <= 96040
    rejects(() => s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 99959, expiryRound: 2 }), /too close/);
    rejects(() => s.seal('alice', { asset: 'BTC', direction: 'BELOW', level: 96041, expiryRound: 2 }), /too close/);
    rejects(() => s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 1, expiryRound: 2 }), /too close/);
    s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 99960, expiryRound: 2 });
    s.seal('alice', { asset: 'BTC', direction: 'BELOW', level: 96040, expiryRound: 2 });
    assert.equal(s.ledger.nextId, 2n);
  });

  test('unknown asset index is rejected', () => {
    const s = setup();
    const a = s.actors.alice;
    a.ps = { ...a.ps, pending: { asset: 7n, direction: Direction.ABOVE, level: toFixed(200000), salt: new Uint8Array(32) } };
    rejects(() => s.call('alice', 'sealCall', 2n), /unknown asset/);
  });
});

describe('proving a hit', () => {
  test('hit proven after expiry updates status and stats', () => {
    const s = setup();
    const { id } = s.seal('alice', { asset: 'ETH', direction: 'BELOW', level: 3300, expiryRound: 2 });
    advance(s, 1);                        // round 1 close
    s.publishCloses([98000, 3250, 0.5, 0.05]); // round 2 close: ETH 3250 <= 3300
    s.proveHit('alice', id);
    assert.equal(s.callRecord(id).status, CallStatus.HIT);
    assert.deepEqual(s.stats(s.actors.alice.pk), { calls: 1n, hits: 1n, misses: 0n });
    assert.equal(s.ledger.totalHits, 1n);
    assert.equal(s.ledger.revealed.member(id), false, 'nothing about the call is revealed');
  });

  test('a miss cannot be proven as a hit', () => {
    const s = setup();
    const { id } = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 105000, expiryRound: 1 });
    s.publishCloses([104999, 3500, 0.5, 0.05]);
    rejects(() => s.proveHit('alice', id), /did not hit/);
  });

  test('cannot prove before the expiry close exists', () => {
    const s = setup();
    const { id } = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 105000, expiryRound: 2 });
    s.publishCloses([110000, 3500, 0.5, 0.05]); // round 1 only
    rejects(() => s.proveHit('alice', id), /not published yet/);
  });

  test('proof window closes after graceRounds', () => {
    const s = setup({ graceRounds: 2n });
    const { id } = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 105000, expiryRound: 1 });
    s.publishCloses([110000, 3500, 0.5, 0.05]); // round 1 (expiry) -> now 2
    advance(s, 2);                               // now 4 > 1 + 2
    rejects(() => s.proveHit('alice', id), /window closed/);
  });

  test('only the author can prove, even with the opening', () => {
    const s = setup();
    const { id, opening } = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 105000, expiryRound: 1 });
    s.publishCloses([110000, 3500, 0.5, 0.05]);
    s.register('bob');
    const b = s.actors.bob;
    b.ps = { ...b.ps, openings: { [id.toString()]: opening } };
    rejects(() => s.proveHit('bob', id), /not your call/);
  });

  test('wrong opening is rejected', () => {
    const s = setup();
    const { id, opening } = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 105000, expiryRound: 1 });
    s.publishCloses([110000, 3500, 0.5, 0.05]);
    const a = s.actors.alice;
    // Claim a different (easier) level after the fact.
    a.ps = { ...a.ps, openings: { [id.toString()]: { ...opening, level: toFixed(100000) } } };
    rejects(() => s.proveHit('alice', id), /does not match/);
  });

  test('a copied commitment cannot be claimed by someone else', () => {
    const s = setup();
    const op = makeOpening({ asset: 'BTC', direction: 'ABOVE', level: toFixed(105000) });
    const alicePk = s.actors.alice.pk;
    s.register('bob');
    // Bob's commitment over the identical opening differs, because it binds the author.
    assert.notEqual(hex(pureCircuits.commitmentOf(alicePk, op)), hex(pureCircuits.commitmentOf(s.actors.bob.pk, op)));
  });

  test('double settlement is rejected', () => {
    const s = setup();
    const { id } = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 105000, expiryRound: 1 });
    s.publishCloses([110000, 3500, 0.5, 0.05]);
    s.proveHit('alice', id);
    rejects(() => s.proveHit('alice', id), /already settled/);
    advance(s, 3);
    rejects(() => s.expire('alice', id), /already settled/);
  });

  test('unknown call id', () => {
    const s = setup();
    rejects(() => s.proveHit('alice', 42), /unknown call/);
  });
});

describe('expiry: hidden losers still count', () => {
  test('anyone can expire an unproven call after the window', () => {
    const s = setup({ graceRounds: 1n });
    const { id } = s.seal('alice', { asset: 'ADA', direction: 'ABOVE', level: 0.6, expiryRound: 1 });
    s.publishCloses([98000, 3500, 0.55, 0.05]); // round 1: ADA 0.55 < 0.6 (a miss)
    s.addActor('watcher');
    rejects(() => s.expire('watcher', id), /still open/); // now 2, window to round 2
    advance(s, 1); // now 3 > 1 + 1
    s.expire('watcher', id);
    assert.equal(s.callRecord(id).status, CallStatus.MISS);
    assert.deepEqual(s.stats(s.actors.alice.pk), { calls: 1n, hits: 0n, misses: 1n });
    assert.equal(s.ledger.totalMisses, 1n);
  });

  test('a hit that the analyst forgot to prove also becomes a miss', () => {
    const s = setup({ graceRounds: 0n });
    const { id } = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 105000, expiryRound: 1 });
    s.publishCloses([110000, 3500, 0.5, 0.05]);
    s.publishCloses(P0); // window gone
    s.expire('oracle', id);
    assert.equal(statusName(s.callRecord(id).status), 'MISS');
  });
});

describe('selective disclosure', () => {
  test('reveal after a proven hit publishes the opening, stats unchanged', () => {
    const s = setup();
    const { id, opening } = s.seal('alice', { asset: 'NIGHT', direction: 'ABOVE', level: 0.07, expiryRound: 1 });
    s.publishCloses([98000, 3500, 0.5, 0.08]);
    s.proveHit('alice', id);
    assert.equal(s.reveal('alice', id), CallStatus.HIT);
    const r = s.ledger.revealed.lookup(id);
    assert.deepEqual(r, { asset: opening.asset, direction: opening.direction, level: opening.level });
    assert.deepEqual(s.stats(s.actors.alice.pk), { calls: 1n, hits: 1n, misses: 0n });
    rejects(() => s.reveal('alice', id), /already revealed/);
  });

  test('revealing a still-sealed loser scores it as a miss on the spot', () => {
    const s = setup();
    const { id } = s.seal('alice', { asset: 'BTC', direction: 'BELOW', level: 90000, expiryRound: 1 });
    s.publishCloses([99000, 3500, 0.5, 0.05]);
    assert.equal(s.reveal('alice', id), CallStatus.MISS);
    assert.equal(s.stats(s.actors.alice.pk).misses, 1n);
  });

  test('cannot reveal before expiry, nor someone else\'s call', () => {
    const s = setup();
    const { id } = s.seal('alice', { asset: 'BTC', direction: 'BELOW', level: 90000, expiryRound: 3 });
    rejects(() => s.reveal('alice', id), /not expired/);
    s.register('bob');
    advance(s, 4);
    rejects(() => s.reveal('bob', id), /not your call/);
  });
});

describe('privacy: the call never reaches public data', () => {
  // Little-endian hex as the runtime encodes Uint<64> values in transcripts.
  const leHex = (v) => { let s = ''; let x = v; while (x > 0n) { s += (x & 0xffn).toString(16).padStart(2, '0'); x >>= 8n; } return s; };
  const dump = (x) => JSON.stringify(x, (_k, v) => typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? hex(v) : v);

  test('seal and proveHit transcripts and ledger contain neither level nor salt', () => {
    const s = setup();
    const level = 101234.5678; // distinctive canary
    const seal = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level, expiryRound: 1 });
    s.publishCloses([102000, 3500, 0.5, 0.05]);
    const prove = s.proveHit('alice', seal.id);
    const pub = dump(seal.proofData.publicTranscript) + dump(prove.proofData.publicTranscript)
      + dump(seal.proofData.input) + dump(prove.proofData.input) + dump(s.state.toString?.() ?? '');
    const ledgerDump = dump([...s.ledger.calls]) + dump([...s.ledger.revealed]);
    for (const hay of [pub, ledgerDump]) {
      assert.ok(!hay.includes(leHex(toFixed(level))), 'level bytes leaked');
      assert.ok(!hay.includes(hex(seal.opening.salt)), 'salt leaked');
      assert.ok(!hay.includes(hex(s.actors.alice.ps.secretKey)), 'secret key leaked');
    }
    // Sanity: the canary is detectable when it is published on purpose.
    s.reveal('alice', seal.id);
    assert.ok(dump([...s.ledger.revealed]).includes(toFixed(level).toString()));
  });

  test('two calls on different assets produce indistinguishable public records', () => {
    const s = setup();
    const a = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 105000, expiryRound: 2 });
    const b = s.seal('alice', { asset: 'NIGHT', direction: 'BELOW', level: 0.04, expiryRound: 2 });
    const ra = s.callRecord(a.id); const rb = s.callRecord(b.id);
    assert.deepEqual(Object.keys(ra).sort(), Object.keys(rb).sort());
    assert.equal(ra.sealedRound, rb.sealedRound);
    assert.equal(ra.expiryRound, rb.expiryRound);
    // Public transcript shape (ops) is identical: the asset branch is not visible.
    const ops = (pd) => pd.publicTranscript.map((op) => typeof op === 'string' ? op : Object.keys(op)[0]).join(',');
    assert.equal(ops(a.proofData), ops(b.proofData));
  });
});

describe('leaderboard', () => {
  test('cherry-picking does not help: full season across three analysts', () => {
    const s = setup({ graceRounds: 1n });
    s.register('bob'); s.register('carol');
    const c1 = s.seal('alice', { asset: 'BTC', direction: 'ABOVE', level: 100000, expiryRound: 2 });
    const c2 = s.seal('alice', { asset: 'ETH', direction: 'BELOW', level: 3400, expiryRound: 2 });
    const c3 = s.seal('bob', { asset: 'BTC', direction: 'BELOW', level: 90000, expiryRound: 2 });
    const c4 = s.seal('bob', { asset: 'ADA', direction: 'ABOVE', level: 0.52, expiryRound: 2 });
    const c5 = s.seal('carol', { asset: 'NIGHT', direction: 'ABOVE', level: 0.06, expiryRound: 2 });
    advance(s, 1);
    s.publishCloses([101000, 3420, 0.53, 0.061]); // round 2 closes
    s.proveHit('alice', c1.id);                 // hit
    rejects(() => s.proveHit('alice', c2.id), /did not hit/); // ETH 3420 > 3400
    s.proveHit('bob', c4.id);                   // hit; bob hides c3 (miss)
    s.proveHit('carol', c5.id);
    advance(s, 1); // window over
    for (const c of [c2, c3]) s.expire('oracle', c.id);
    const board = Object.fromEntries(s.board().map((r) => [r.name, r]));
    assert.equal(board.alice.hitRate, 0.5);
    assert.equal(board.bob.hitRate, 0.5);
    assert.equal(board.carol.hitRate, 1);
    assert.equal(s.ledger.totalSealed, 5n);
    assert.equal(s.ledger.totalHits + s.ledger.totalMisses, 5n);
  });
});
