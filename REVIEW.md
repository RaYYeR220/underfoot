# Review Underfoot in five minutes

1. **See it live** — https://underfoot-brown.vercel.app/floor. Top row: backing per WIF, WIF price, coverage, floor value. Open *Buy now*: the intake tells you, before you sign anything, whether it would buy or refuse and why (on weekends it refuses — Stock Token feeds are stale).
2. **Check the contracts in one command** — `pnpm install && pnpm verify:onchain`. It reads the deployment from mainnet and checks code, wiring, constants, hook flags, the gas tank and that no contract exposes an admin function.
3. **Follow the transactions** — [README → Deployment](README.md#deployment): a redemption paid in Stock Tokens, a vote, both directions of the hook pool, WIF burned at the intake, a buy that skipped a stale leg, and a vote from an account with 0 ETH.
4. **Run the tests** — `cd contracts && forge test` (47: unit, fuzz, the backing invariant, hook accounting) and `FOUNDRY_PROFILE=fork forge test` (29, against live Robinhood Chain: every route, every refusal, redemption, the hook pool through the official router, gasless operations through EntryPoint v0.8).
5. **Read what can go wrong** — [README → Honest limits](README.md#honest-limits), [AUDIT.md](AUDIT.md) (self-review, every fix with its test), [CLAIMS.md](CLAIMS.md) (each claim and its evidence).

For agents: the MCP endpoint is `https://underfoot-brown.vercel.app/api/mcp` (streamable HTTP). Tools: `floor_snapshot`, `quote_redeem`, `build_redeem`, `build_vote`, `build_fund`. It never holds keys; every action comes back as unsigned calls.
