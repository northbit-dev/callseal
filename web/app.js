// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 northbit
// CallSeal browser demo. Every button runs the real compiled Compact circuit
// (via @midnight-ntwrk/compact-runtime + the on-chain runtime WASM) in your browser.
import {
  ASSETS, CallSealSim, Direction, hex, short, fromFixed, toFixed, makeOpening,
  commitmentOf, describeOpening, statusName, toJSONSafe,
} from '../src/callseal.mjs';

/* global __CALLSEAL_RUNS__ */
const RUNS = typeof __CALLSEAL_RUNS__ !== 'undefined' ? __CALLSEAL_RUNS__ : {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n >= 100 ? n.toLocaleString('en-US') : String(n));

let sim;
let actor = 'alice';
const events = [];

function reset() {
  sim = new CallSealSim({ minMoveBps: 200n, graceRounds: 1n });
  for (const n of ['alice', 'bob', 'carol', 'anyone']) sim.addActor(n);
  events.length = 0;
  sim.publishCloses([98000, 3500, 0.5, 0.05]);
  log('oracle', 'publishCloses(round 0)', 'BTC 98,000 · ETH 3,500 · ADA 0.5 · NIGHT 0.05', 'ok');
  for (const n of ['alice', 'bob']) { sim.register(n); log(n, 'registerAnalyst', `pk ${short(sim.actors[n].pk)}…`, 'ok'); }
  render();
}

function log(who, what, publicNote, kind = 'ok') {
  events.unshift({ who, what, publicNote, kind, round: Number(sim.ledger.round) });
}

function run(who, label, fn, publicNote) {
  try {
    const r = fn();
    log(who, label, typeof publicNote === 'function' ? publicNote(r) : publicNote, 'ok');
    return r;
  } catch (e) {
    const msg = String(e.message ?? e).replace(/^.*failed assert: /i, '');
    log(who, label, `rejected by circuit: ${msg}`, 'err');
    toast(`✖ ${msg}`);
    return undefined;
  } finally { render(); }
}

function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3500);
}

const latestCloses = () => {
  const l = sim.ledger; const r = l.round;
  return r > 0n ? l.closes.lookup(r - 1n).map(fromFixed) : null;
};

// ---------------------------------------------------------------- actions
function publish() {
  const v = ASSETS.map((a) => Number($(`#close-${a}`).value));
  const r = Number(sim.ledger.round);
  run('oracle', `publishCloses(round ${r})`, () => sim.publishCloses(v), v.map((x, i) => `${ASSETS[i]} ${fmt(x)}`).join(' · '));
}

function drift() {
  const c = latestCloses() ?? [98000, 3500, 0.5, 0.05];
  ASSETS.forEach((a, i) => {
    const p = c[i] * (1 + (Math.random() - 0.45) * 0.08);
    $(`#close-${a}`).value = p >= 100 ? Math.round(p) : +p.toPrecision(4);
  });
}

function register() {
  run(actor, 'registerAnalyst', () => sim.register(actor), `pk ${short(sim.actors[actor].pk)}… joins the season`);
}

function seal() {
  const asset = $('#asset').value; const direction = $('#dir').value;
  const level = Number($('#level').value); const expiryRound = Number($('#expiry').value);
  const res = run(actor, 'sealCall', () => sim.seal(actor, { asset, direction, level, expiryRound }), (r) => {
    const t = toJSONSafe(r.proofData.publicTranscript);
    const leaked = t.includes(hex(r.opening.salt));
    return `call #${r.id} sealed: commitment ${short(sim.callRecord(r.id).commitment)}…, expires r${expiryRound}. ` +
      `Public transcript ${r.proofData.publicTranscript.length} ops; private salt found in it: ${leaked ? 'YES' : 'no'} (only the commitment is disclosed)`;
  });
  if (res) toast(`Sealed call #${res.id}. Only you know: ${describeOpening(res.opening)}`);
}

function prove(id) { run(actor, `proveHit #${id}`, () => sim.proveHit(actor, id), `call #${id} → HIT (the ZK proof checked it against the oracle close; the call stays sealed)`); }
function reveal(id) { run(actor, `revealCall #${id}`, () => sim.reveal(actor, id), () => `call #${id} opened publicly: ${describeOpening({ ...sim.ledger.revealed.lookup(BigInt(id)) })}`); }
function expire(id) { run('anyone', `expireCall #${id}`, () => sim.expire('anyone', id), `call #${id} → MISS (no hit proof inside the window; nothing about the call revealed)`); }

function share(id) {
  const a = sim.actors[actor]; const o = a.ps.openings[String(id)];
  const payload = { id, analyst: hex(a.pk), asset: ASSETS[Number(o.asset)], direction: o.direction === Direction.ABOVE ? 'ABOVE' : 'BELOW', level: fromFixed(o.level), salt: hex(o.salt) };
  $('#verify-input').value = JSON.stringify(payload, null, 1);
  toast(`Opening for #${id} copied into the subscriber box →`);
  $('#verify').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function verify() {
  const out = $('#verify-out');
  try {
    const p = JSON.parse($('#verify-input').value);
    const rec = sim.callRecord(BigInt(p.id));
    const salt = Uint8Array.from(p.salt.match(/../g).map((h) => parseInt(h, 16)));
    const o = makeOpening({ asset: p.asset, direction: p.direction, level: toFixed(p.level), salt });
    const ok = hex(commitmentOf(rec.analyst, o)) === hex(rec.commitment) && hex(rec.analyst) === p.analyst;
    out.className = ok ? 'good' : 'bad';
    out.textContent = ok
      ? `✔ Matches on-chain commitment of call #${p.id} (sealed in round ${rec.sealedRound}, status ${statusName(rec.status)}). This really was the call.`
      : `✖ Does not match call #${p.id}. The analyst changed something after sealing (or this is not their call).`;
  } catch (e) { out.className = 'bad'; out.textContent = `✖ ${e.message}`; }
}

// ---------------------------------------------------------------- render
function render() {
  const l = sim.ledger; const round = Number(l.round);
  const c = latestCloses();
  $('#round').textContent = round;
  $('#latest').innerHTML = c ? ASSETS.map((a, i) => `<span><b>${a}</b> ${fmt(c[i])}</span>`).join('') : '—';
  $('#totals').textContent = `${l.totalSealed} sealed · ${l.totalHits} hits · ${l.totalMisses} misses`;
  if (!$('#close-BTC').value && c) ASSETS.forEach((a, i) => { $(`#close-${a}`).value = c[i]; });

  // actor tabs
  $('#actors').innerHTML = ['alice', 'bob', 'carol'].map((n) => `<button class="tab ${n === actor ? 'on' : ''}" data-actor="${n}">${n}${l.analysts.member(sim.actors[n].pk) ? '' : ' (new)'}</button>`).join('');
  const a = sim.actors[actor];
  const registered = l.analysts.member(a.pk);
  $('#register').style.display = registered ? 'none' : '';
  $('#sealform').style.display = registered ? '' : 'none';
  $('#me').textContent = `public key ${short(a.pk)}…  ·  secret key never leaves this tab`;
  $('#expiry').min = round; if (Number($('#expiry').value) < round) $('#expiry').value = round;
  const minMove = Number(l.minMoveBps) / 100;
  if (c) {
    const i = ASSETS.indexOf($('#asset').value);
    const up = $('#dir').value === 'ABOVE';
    $('#hint').textContent = `Last close ${fmt(c[i])}. Must be at least ${minMove}% away: ${up ? '≥' : '≤'} ${fmt(+(c[i] * (1 + (up ? 1 : -1) * minMove / 100)).toPrecision(6))}`;
  }

  // private vault
  const mine = Object.entries(a.ps.openings);
  $('#vault').innerHTML = mine.length ? mine.map(([id, o]) => {
    const rec = sim.callRecord(BigInt(id)); const st = statusName(rec.status);
    const isRev = l.revealed.member(BigInt(id));
    const expired = round > Number(rec.expiryRound);
    return `<tr><td>#${id}</td><td class="secret">${esc(describeOpening(o))}</td><td>r${rec.expiryRound}</td><td><span class="pill ${st}">${st}</span></td><td class="acts">
      ${st === 'SEALED' && expired ? `<button data-prove="${id}">Prove hit</button>` : ''}
      ${st !== 'SEALED' && !isRev ? `<button class="ghost" data-reveal="${id}">Reveal</button>` : ''}
      <button class="ghost" data-share="${id}">Share privately</button></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="muted">No calls yet. Seal one above.</td></tr>';

  // public ledger
  const rows = [];
  for (const [id, r] of l.calls) {
    const st = statusName(r.status); const rv = l.revealed.member(id) ? describeOpening(l.revealed.lookup(id)) : null;
    const name = Object.values(sim.actors).find((x) => hex(x.pk) === hex(r.analyst))?.name ?? short(r.analyst);
    const canExpire = st === 'SEALED' && round > Number(r.expiryRound) + Number(l.graceRounds);
    rows.push(`<tr><td>#${id}</td><td>${esc(name)} <span class="muted">${short(r.analyst)}…</span></td><td class="mono">${short(r.commitment)}…</td><td>r${r.sealedRound} → r${r.expiryRound}</td><td><span class="pill ${st}">${st}</span></td><td>${rv ? esc(rv) : '<span class="muted">sealed</span>'}</td><td>${canExpire ? `<button class="ghost" data-expire="${id}">Expire → MISS</button>` : ''}</td></tr>`);
  }
  $('#ledger').innerHTML = rows.join('') || '<tr><td colspan="7" class="muted">No calls on the ledger yet.</td></tr>';

  // leaderboard
  $('#board').innerHTML = sim.board().map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.calls}</td><td>${r.hits}</td><td>${r.misses}</td><td>${r.open}</td><td><b>${r.hitRate == null ? '—' : Math.round(r.hitRate * 100) + '%'}</b></td></tr>`).join('');

  // event log
  $('#events').innerHTML = events.slice(0, 40).map((e) => `<li class="${e.kind}"><span class="who">${esc(e.who)}</span> <code>${esc(e.what)}</code><div>${esc(e.publicNote)}</div></li>`).join('');
}

function renderRuns() {
  const r = RUNS.preview ?? RUNS.preprod ?? RUNS.local;
  if (!r) { $('#onchain').innerHTML = '<p class="muted">No network run bundled.</p>'; return; }
  const label = r.network === 'local' ? 'local Midnight devnet (node 1.0.400 · indexer 4.3.5 · proof server 8.1.3)' : `Midnight ${r.network} testnet`;
  $('#onchain').innerHTML = `<p>Same contract, real ZK proofs, ${esc(label)}. Contract <code>${esc(r.contractAddress)}</code></p>
  <table><thead><tr><th>step</th><th>tx hash</th><th>block</th><th>status</th></tr></thead><tbody>${r.txs.map((t) => `<tr><td>${esc(t.step)}</td><td class="mono">${esc(t.txHash.slice(0, 16))}…</td><td>${t.blockHeight}</td><td>${esc(t.status)}</td></tr>`).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- wire up
document.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.actor) { actor = d.actor; render(); }
  else if (d.prove) prove(d.prove);
  else if (d.reveal) reveal(d.reveal);
  else if (d.expire) expire(d.expire);
  else if (d.share) share(d.share);
});
$('#publish').onclick = publish;
$('#drift').onclick = drift;
$('#register').onclick = register;
$('#seal').onclick = seal;
$('#verify-btn').onclick = verify;
$('#reset').onclick = () => { $('#close-BTC').value = ''; reset(); };
$('#asset').onchange = $('#dir').onchange = render;
$('#loading').remove();
reset();
renderRuns();
drift();
