# CallSeal: pitch deck outline (8 slides)

1. **Title.** CallSeal: prove your trading track record, never leak a call. northbit · Midnight Network hackathon.
2. **Problem.** Paid signals run on screenshots. Winners get posted, losers get deleted. Proving a record openly gives the product away to non-payers and front-runners. Platforms that "verify" see every call.
3. **Insight.** Midnight separates *proving the record* (public) from *the calls* (private). Selective disclosure is the product.
4. **How it works.** Seal → oracle close → prove hit in ZK → unproven calls expire to MISS. Diagram from the README.
5. **Anti-gaming inside the proof.** Table: hidden losers, trivial calls, edits, copied commitments, timing, double settlement, hedging. All enforced as circuit asserts, all covered by tests.
6. **Demo.** Browser demo screenshot + on-chain run table (deploy + 9 circuit calls, block heights, SucceedEntirely). Terminal demo GIF.
7. **Engineering.** Compact contract with 6 circuits; 27 tests incl. privacy leak scans; full season on a real Midnight network with ZK proofs; static web demo runs the real circuits in the browser; Apache-2.0.
8. **Market & next.** Signal groups, research newsletters, prop-trading hiring (verifiable record without leaking strategy), copy-trading. Roadmap: oracle committee, paid access to openings in shielded tokens, season registry, mainnet. Honest limits: single oracle, key-level identity, timing metadata.
