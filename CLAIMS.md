# What we claim, and how to check it

Every public statement about Underfoot, tagged by the kind of evidence behind it.

- **LIVE** — happened on Robinhood Chain mainnet; follow the link.
- **REPRODUCIBLE** — a test or script anyone can run from this repo.
- **MODELED** — follows from the math or the code but hasn't happened at scale yet.
- **NOT CLAIMED** — things we deliberately don't say.

| Claim | Tier | Evidence |
|---|---|---|
| Six contracts are deployed on Robinhood Chain mainnet, source-verified, with no owner or admin functions. | LIVE + REPRODUCIBLE | [README → Deployment](README.md#deployment), `pnpm verify:onchain` (checks code, wiring, constants and scans each contract's dispatcher for admin selectors) |
| Burning WIF pays out a pro-rata slice of every basket asset, in kind, minus 1%. | LIVE | [redemption tx](https://robinhoodchain.blockscout.com/tx/0x2406285862347a30cdccde1c0aa1f5d0f0500550d3750f1c6513cca8dccd594b) |
| Backing per circulating WIF never decreases under redemptions, votes, burns elsewhere, transfers to the dead address and inflows. | REPRODUCIBLE | `contracts/test/invariant/Backing.invariant.t.sol` (256 runs × 64 calls), `testFuzz_redeemNeverLowersBacking` |
| Every WIF burned anywhere on the chain raises the floor. | REPRODUCIBLE + MODELED | `test_backingRisesWhenAnyoneBurns`, `test_backingRisesWhenWifGoesToDead`; the live burn ledger at `/floor` lists every burn since WIF was minted |
| A vote burns WIF and sets tomorrow's buy, not today's. | LIVE + REPRODUCIBLE | [vote tx](https://robinhoodchain.blockscout.com/tx/0x4ecffbe543368dd1fd226b2e4e4982ae1aa1379a8fd923ea8fddf51467bb59d5), `test_votesDecideTomorrowNotToday` |
| The Intake skips a leg it can't price safely and puts its share into the other leg. | LIVE | [first buy](https://robinhoodchain.blockscout.com/tx/0xc7c4e2e7f327bb23be8308a43c1ec7c385c59854f903e7e7c44755cc7bb34a1e): `LegSkipped(0, FeedUnusable)` then all into SPY |
| The Intake refuses to buy when markets are closed, a token is paused, or a pool is pushed off Chainlink. | REPRODUCIBLE | `test_fork_refusesWhenMarketsClosed`, `test_fork_pausedTargetRoutesEverythingToCashLeg`, `test_fork_sandwichPushIsRefused`, `test_fork_bothLegsOffPriceRefusesEverything` |
| Every one of the 20 fixed routes (10 assets × ETH/USDG) trades against live pools. | REPRODUCIBLE | `test_fork_everyRouteWorks` |
| The WIF/SPY hook sends 0.5% of SPY-side output to the floor and burns 0.5% of WIF-side output. | LIVE + REPRODUCIBLE | [sell](https://robinhoodchain.blockscout.com/tx/0xd168979e4622db8f6499d2557d81f08767a2f37980108ae9797c6e76fe4fb444), [buy-back](https://robinhoodchain.blockscout.com/tx/0x9010b64bca96f1df573c4ae1a758280fba5490a46b3a3ec05bd2f1503e3713be), `testFuzz_hookAccountingAllFourDirections` |
| Floor actions are gasless for an EIP-7702 account; the paymaster pays only for burns. | LIVE + REPRODUCIBLE | [gasless vote from a 0-ETH account](https://robinhoodchain.blockscout.com/tx/0x9aaba2e91e357f2b29e6042c7c1e73e91fb8d484ef4f229e219279c26c6b2cfd), `scripts/sponsored-vote.mjs`, `test_fork_signedTransferIsStillRefused` |
| Coverage today is a tiny fraction of the WIF price. | LIVE | `/floor` shows it; at launch ≈ $1.12 behind ~1.0B WIF |
| The floor grows as projects route fees to the Intake. | MODELED | One `fund()` call per inflow; nothing is routed in automatically yet |

## Not claimed

- That the floor protects the WIF price today. It is a fraction of a percent of market cap.
- That Underfoot is audited by a firm. It had an adversarial self-review with proofs of concept ([AUDIT.md](AUDIT.md)).
- That Stock Tokens give rights in the underlying shares. They are debt securities with economic exposure only, issued by Robinhood Assets (Jersey) Ltd.
- That anything here is affiliated with, or endorsed by, Robinhood or the $WIF team.
- That the email sign-in has been tested with every wallet. The gasless path is proven end to end with a script; the in-app version uses the same paymaster and bundler.
