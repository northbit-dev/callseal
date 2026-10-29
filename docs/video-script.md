# 2-minute video script

| time | on screen | voice-over |
|---|---|---|
| 0:00–0:12 | Title card, then a blurred "signal group" screenshot with only green trades | "Trading signals are sold on track records. And track records are screenshots: winners posted, losers deleted." |
| 0:12–0:25 | Split screen: public post vs paywall | "If an analyst publishes every call to prove their record, they give the product away. CallSeal fixes that with Midnight." |
| 0:25–0:45 | Browser demo: alice seals "BTC ≥ 101,000"; public ledger row shows only commitment + rounds | "Alice seals a call. On-chain there is only a commitment, her key and the expiry round. The zero-knowledge proof also checks the call is at least 2 % away from the last close, so no free hits." |
| 0:45–1:00 | Trivial call rejected toast; oracle publishes closes | "Trivial calls are rejected inside the proof. The oracle publishes closes for the round." |
| 1:00–1:20 | Prove hit → HIT; second call proof fails; expire → MISS | "Alice proves the BTC call hit, without revealing it. Her ETH call missed. She can't prove it, and she can't hide it: after the window anyone expires it into a public miss." |
| 1:20–1:35 | Leaderboard 50 %; subscriber verify box, forged level rejected | "The leaderboard is honest by construction. Paying subscribers can get the opening privately and check it against the chain. An edited call doesn't match." |
| 1:35–1:50 | Terminal: `npm test` (27 passing), on-chain run table with block heights | "The Compact contract has six circuits and 27 tests, including privacy leak scans, and it ran end to end on a Midnight network with real proofs." |
| 1:50–2:00 | Logo, repo URL, "Apache-2.0 · built by northbit" | "CallSeal: prove your record, never leak a call. Built on Midnight by northbit." |

Recording notes: 1280×720, browser demo at `npm run serve`, terminal at 110×32 with `CALLSEAL_FAST=1 npm run demo`. Voice-over can be recorded by the team or generated with TTS. If TTS is used, say so in the video description (AI disclosure).
