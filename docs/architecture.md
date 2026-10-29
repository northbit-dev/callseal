# Architecture

## Components

| layer | file | role |
|---|---|---|
| contract | `contract/src/callseal.compact` | ledger, 6 circuits, 4 pure helpers |
| compiled | `contract/managed/callseal/` | JS bindings, ZKIR, prover/verifier keys (compactc 0.31.1) |
| shared logic | `src/callseal.mjs` | private state, witnesses, opening/commitment helpers, `CallSealSim` |
| CLI | `src/cli.mjs` | `demo` (scripted season) and `verify` (subscriber check) |
| web | `web/` → `web/dist/` | static demo; circuits + on-chain runtime WASM run in the browser |
| network | `deploy/run.mjs` | wallet, providers, deploy and the full season on a real Midnight network |

## Private state and witnesses

```
privateState = { secretKey: Bytes<32>, pending: CallOpening | null, openings: { [id]: CallOpening } }

localSecretKey()     -> secretKey               (identity: pk = H("callseal:pk:", sk))
pendingCall()        -> pending                 (the call being sealed)
storedOpening(id)    -> openings[id]            (used by proveHit and revealCall)
```

The opening `{asset, direction, level, salt}` is created on the analyst's device. The salt is 32 random bytes,
so the commitment cannot be brute-forced over the small space of assets and price levels.

## Commitment

```
commitment = persistentHash([authorPk, persistentHash(opening)])
```

Binding the author into the commitment means a commitment copied from another analyst can never be proven by
the copier: `proveHit` recomputes it with the caller's own key.

## Clock and settlement

* `round` counts published closes. `closes[r]` is the vector of four closes for round `r`.
* A call sealed at round `now` references the latest close `closes[now-1]` for the non-triviality check.
* `proveHit` is valid while `expiry < round <= expiry + graceRounds`.
* `expireCall` is valid when `round > expiry + graceRounds`, by anyone.

## Privacy analysis

Disclosed per circuit (everything else stays private):

| circuit | disclosed |
|---|---|
| `sealCall` | analyst pk, commitment, sealed round, expiry round |
| `proveHit` | call id, "caller is author", "opening matches", "hit" |
| `expireCall` | call id |
| `revealCall` | the opening (by choice) |

`proveHit` reads the whole close vector for the expiry round and selects the asset inside the circuit,
so the public transcript is the same whatever asset the call was on (covered by a test).

## Trust assumptions

* The oracle publishes honest closes. It cannot see or influence calls, but a dishonest oracle can flip outcomes.
  Roadmap: k-of-n oracle committee or an on-chain price feed.
* The analyst's device holds the openings. Losing them only means the analyst cannot prove hits; the calls then
  expire as misses, which is the safe failure mode.
