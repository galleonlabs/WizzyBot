# WIZZY graduation readiness

The Wizzy token lives on its launchpad bonding curve. Graduation seeds the real WIZZY/WETH Uniswap v3 pool on Robinhood Chain. This runbook makes sleeve activation a fill-in-the-addresses release: from graduation onward, every index deposit LPs a fixed related-party sleeve into WIZZY/WETH and every redemption unwinds it proportionally. That allocation flow — not fee routing — is the flywheel, exactly as sized in [TOKEN_FLYWHEEL.md](TOKEN_FLYWHEEL.md).

## Already built and shipped dark

- **Catalog**: `sleeve: true` markets parse with hard invariants — at most one sleeve per chain, 1,000 bps (10%) hard weight cap, never a migration endpoint, active weights still sum to 10,000.
- **Allocation**: a selected sleeve receives exactly its configured bps of every deposit at every breadth tier; selected ordinaries share the remainder (`sleeveAwareWeights`). The sleeve is appended to every tier, so the smallest deposit still carries it.
- **Curator guards**: the research agent and deterministic updater refuse any candidate, review, or replacement that touches the sleeve token or market. The curator's only sleeve authority is `pause` (which redistributes its weight to ordinaries). This holds the TOKEN_FLYWHEEL non-negotiables in code, not just policy.
- **Gate**: the full test suite passes with and without an active sleeve, so the activation commit cannot be blocked by its own tests.
- **Activation script**: `scripts/activate-wizzy-sleeve.ts` verifies the pool onchain (pair, fee, non-zero liquidity), rescales the ordinary constituents, appends the sleeve, and revalidates the catalog. Config-only; no transaction or fee change.
- **Watcher**: `scripts/watch-wizzy-graduation.ts` polls the v3 factory for the WIZZY/WETH pool and alerts through `UNABOT_ALERT_WEBHOOK` on `pool-created` and `graduated` transitions. Disarmed until it has the token address.

## Arm the watcher (do this now)

Needs the confirmed WIZZY token contract address from the launchpad.

```bash
WIZZY_TOKEN_ADDRESS=0x... bun scripts/watch-wizzy-graduation.ts
```

On dappnode, add `WIZZY_TOKEN_ADDRESS=0x...` to `~/.config/unabot/curator.env` and run it from a 5-minute user timer with `WorkingDirectory=%h/projects/personal/UnaBot`, mirroring `unabot-curator.service` hardening. State lands next to the curator's in `~/.local/state/unabot-curator/wizzy-graduation.json`.

## The recorded decision still open

[TOKEN_FLYWHEEL.md](TOKEN_FLYWHEEL.md) Stage 3 gates activation on 30 days of market history, $250k usable liquidity, $100k genuine 7-day volume, and legal review. Activating at graduation instead is a deliberate revision of that recorded plan — the operator's call, made explicitly and recorded here, not a side effect. The machinery supports either timing; nothing activates until the release below ships.

## Activation release (day-of)

1. Confirm graduation from independent chain data: pool address, pair, fee tier, seeded liquidity (the watcher report plus a manual Blockscout check).
2. Run the activation on a clean checkout of `main`:
   ```bash
   bun scripts/activate-wizzy-sleeve.ts --token=0x... --pool=0x...
   ```
   Default weight is 500 bps with a 10% hard cap; the script refuses a zero-liquidity pool and a second sleeve.
3. Review the diff: one new `robinhood-wizzy` sleeve market, ordinaries rescaled to 9,500 bps, catalog version bumped. Nothing else.
4. Ship the sleeve disclosure UI in the same release: related-party tag on the market row and composition bar, sleeve target and current weight, pause reason when paused. This is a Stage 3 gate, deliberately left for the activation release.
5. Full gate: `bun run test && bun run typecheck && bun run build:web`.
6. Merge to `main`, verify the deploy live: `/api/markets` shows the sleeve, a deposit quote allocates the sleeve share to WIZZY/WETH at every tier, Markets page discloses it.
7. Public comms per [TOKEN_FLYWHEEL.md](TOKEN_FLYWHEEL.md): one canonical pinned post with the contract, pool, sleeve status, and related-party disclosure. Never describe the sleeve as guaranteed demand, price support, yield, or a floor.

## Standing constraints after activation

- The curator reviews the sleeve's liquidity, volume, and security like any incumbent but can only pause it. Reinstating a paused sleeve is a new reviewed release.
- Weight changes (5% → anything) are separate releases; 10% is the hard maximum and requires the Stage 4 review.
- Treasury fee flows are untouched by activation. Any treasury-owned WIZZY/WETH liquidity remains a separate, disclosed, manual action under the treasury policy.
