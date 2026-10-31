# Self-review

Before mainnet, the contracts were reviewed adversarially by someone who hadn't written them, with a proof-of-concept Foundry test for every issue run against live Robinhood Chain state. Nothing Critical or High was found. Everything Medium and Low below was fixed before deploy; each fix has a regression test that runs against mainnet state.

| # | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| M-1 | Medium | `Intake.convert` could be sandwiched: push the target's pool, call `convert` repeatedly (the $500 cap was per call), sell back. The 2% band became the price. PoC: +0.10 ETH profit on 20 ETH pending. | Before a leg trades, every pool on its route must sit within **0.75%** of Chainlink (`spotRate` vs. oracle), so a same-transaction push is refused. Execution band tightened to 1.5%. Per-call cap replaced by **$1,000 per hour** across all calls. | `test_fork_sandwichPushIsRefused`, `test_fork_offPricePoolIsSkipped`, `test_fork_hourlyWindowCapsConversions` |
| M-2 | Medium | Every convert bought the cash leg first. If SGOV, its feed or its route broke for good, all ETH/USDG in the Intake was stuck forever (no owner). A 1-WIF vote for a paused option also halted conversions for a day. | A leg that can't trade is **skipped and its share goes to the other leg**; only if neither can trade does `convert` revert (`NothingBuyable`). | `test_fork_brokenCashFeedDoesNotStrandInflows`, `test_fork_pausedTargetRoutesEverythingToCashLeg`, `test_fork_pausedCashOracleRoutesEverythingToTarget`, `test_fork_bothLegsOffPriceRefusesEverything` |
| L-1 | Low | The paymaster counted burns from calldata, so calls that could never burn (vote option 0, redeem of 0) passed validation; the NatSpec overstated what on-chain rules guarantee. | Validation now rejects out-of-range options, votes under 1 WIF, zero redemptions and zero recipients. NatSpec states the remaining limit honestly (a holder can still move WIF away between signing and inclusion; that costs one capped operation and is rate-limited server-side, where the operation is also simulated before signing). | `test_fork_impossibleBurnsAreRefused` |
| L-2 | Low | The paymaster could never stake, so bundlers would apply unstaked-entity limits forever. | Permissionless `addStake`; with no unlock function the stake is permanent. | `test_fork_anyoneCanAddPermanentStake` |
| L-3 | Low | Feed decimals weren't checked. | Constructor asserts every feed has 8 decimals. | deploy-time |
| I | Info | WIF sent to the floor by mistake still counted as circulating. `sweep` reverted if any held Stock Token was paused. The lens could revert on a token's `balanceOf`. | Floor's own WIF excluded from circulating; `sweep` isolates each token; lens reads balances defensively. | `test_wifSentToTheFloorLeavesCirculation` |

## Checked and fine

- **Redeem math**: payout ≤ 0.99 · w/S · balance, rounded down; backing per WIF can't fall (invariant-fuzzed).
- **Reentrancy**: `redeem` is guarded, computes payouts before burning and burns before transferring; an issuer-upgraded Stock Token can't re-enter it.
- **Hook accounting**: exact in all four shapes (exact-in/exact-out × both directions), the PoolManager stays balanced and the hook keeps no balance (`testFuzz_hookAccountingAllFourDirections`).
- **Paymaster**: the signed hash covers sender, nonce, initCode, callData, every gas field including the paymaster's, chain id, paymaster address and validity window; no storage access during validation (ERC-7562-clean for an unstaked paymaster); the 7702 check requires the exact `0xef0100‖implementation` designator.
- **Ballot**: the running leader is always the true leader; ties keep the earlier leader; the buy target is always the previous epoch's winner.

## Accepted, disclosed

Issuer powers over Stock Tokens (pause, blocklist, upgrade, `adminBurn`); no L2 sequencer-uptime feed on Robinhood Chain; a pool pushed just inside the 0.75% check can leak up to roughly that share of the hourly cap; a blocklisted floor would make SPY-side swaps in the hook pool revert (LPs can still exit). See [README → Honest limits](README.md#honest-limits).
