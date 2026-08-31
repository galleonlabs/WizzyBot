# WIZZY graduation readiness

The Wizzy token lives on its launchpad bonding curve. Graduation seeds the real WIZZY/WETH Uniswap v3 pool on Robinhood Chain. This runbook makes sleeve activation a fill-in-the-addresses release: from graduation onward, every index deposit LPs a fixed related-party sleeve into WIZZY/WETH and every redemption unwinds it proportionally. That allocation flow — not fee routing — is the flywheel, exactly as sized in [TOKEN_FLYWHEEL.md](TOKEN_FLYWHEEL.md).

## Already built and shipped dark

- **Catalog**: `sleeve: true` markets parse with hard invariants — at most one sleeve per chain, 1,000 bps (10%) hard weight cap, never a migration endpoint, active weights still sum to 10,000.
- **Allocation**: a selected sleeve receives exactly its configured bps of every deposit at every breadth tier; selected ordinaries share the remainder (`sleeveAwareWeights`). The sleeve is appended to every tier, so the smallest deposit still carries it.
- **Curator guards**: the research agent and deterministic updater refuse any candidate, review, or replacement that touches the sleeve token or market. The curator's only sleeve authority is `pause` (which redistributes its weight to ordinaries). This holds the TOKEN_FLYWHEEL non-negotiables in code, not just policy.
- **Gate**: the full test suite passes with and without an active sleeve, so the activation commit cannot be blocked by its own tests.
- **Activation script**: `scripts/activate-wizzy-sleeve.ts` verifies the pool onchain (pair, fee, non-zero liquidity), rescales the ordinary constituents, appends the sleeve, and revalidates the catalog. Config-only; no transaction or fee change.
- **Watcher**: `scripts/watch-wizzy-graduation.ts` polls the v3 factory for the WIZZY/WETH pool and alerts through `UNABOT_ALERT_WEBHOOK` on `pool-created` and `graduated` transitions. Disarmed until it has the token address.

## Token

`0x9626F5491773BD28e1a1Edb91BE962264adF4F63` on Robinhood Chain — verified onchain 2026-08-31 from the canonical RPC: contract code present, `name() = "Wizzy"`, `symbol() = "WIZZY"`, 18 decimals, fixed 1,000,000,000 supply. Launchpad page: pools.trade. The watcher runs on the dappnode timer `wizzy-graduation.timer` every five minutes and alerts on `pool-created` and `graduated`; state lands in `~/.local/state/unabot-curator/wizzy-graduation.json`.

## Timing decision (recorded)

Operator decision, 2026-08-31: **activate the sleeve at graduation.** This deliberately supersedes the Stage 3 timing gates in [TOKEN_FLYWHEEL.md](TOKEN_FLYWHEEL.md) (30 days of market history, $250k liquidity, $100k seven-day volume, prior legal review). The activation script's own onchain safety checks still apply — correct pair, expected fee tier, non-zero seeded liquidity — and the curator's pause authority, the 10% hard cap, and the no-fee-routing boundary all remain in force.

## Activation release (day-of)

1. Confirm graduation from independent chain data: pool address, pair, fee tier, seeded liquidity (the watcher report plus a manual Blockscout check).
2. Run the activation on a clean checkout of `main`:
   ```bash
   bun scripts/activate-wizzy-sleeve.ts --token=0x... --pool=0x...
   ```
   Default weight is 500 bps with a 10% hard cap; the script refuses a zero-liquidity pool and a second sleeve.
3. Review the diff: one new `robinhood-wizzy` sleeve market, ordinaries rescaled to 9,500 bps, catalog version bumped. Nothing else. No new UI ships with activation (operator decision, 2026-08-31): WIZZY renders as an ordinary market row through the existing data-driven surfaces.
4. Full gate: `bun run test && bun run typecheck && bun run build:web`.
5. Merge to `main`, verify the deploy live: `/api/markets` shows the sleeve, a deposit quote allocates the sleeve share to WIZZY/WETH at every tier, and WIZZY appears on the Markets page.
6. Public comms per [TOKEN_FLYWHEEL.md](TOKEN_FLYWHEEL.md): one canonical pinned post with the contract, pool, and sleeve status. Never describe the sleeve as guaranteed demand, price support, yield, or a floor.

## Standing constraints after activation

- The curator reviews the sleeve's liquidity, volume, and security like any incumbent but can only pause it. Reinstating a paused sleeve is a new reviewed release.
- Weight changes (5% → anything) are separate releases; 10% is the hard maximum and requires the Stage 4 review.
- Treasury fee flows are untouched by activation. Any treasury-owned WIZZY/WETH liquidity remains a separate, disclosed, manual action under the treasury policy.
