# WIZZY graduation readiness

The Wizzy token lives on its launchpad bonding curve. Graduation seeds the canonical WIZZY/WETH pool on Robinhood Chain. Graduation does not add WIZZY to other deposits or make it part of a basket; it only creates the pool that can later be reviewed as its own selectable market.

## Token

`0x9626F5491773BD28e1a1Edb91BE962264adF4F63` on Robinhood Chain. On 2026-08-31 the canonical RPC returned contract code, `name() = "Wizzy"`, `symbol() = "WIZZY"`, 18 decimals, and a fixed 1,000,000,000 supply. The launchpad page is on pools.trade.

`scripts/watch-wizzy-graduation.ts` polls the v3 factory and alerts through `UNABOT_ALERT_WEBHOOK` on `pool-created` and `graduated` transitions. The dappnode timer stores state in `~/.local/state/unabot-curator/wizzy-graduation.json`.

## Graduation checklist

1. Confirm the pool address, pair, fee tier, seeded liquidity, and token contract from independent chain data.
2. Complete the contract, holder, liquidity, volume, execution-depth, related-party, treasury, and legal review in [TOKEN_FLYWHEEL.md](TOKEN_FLYWHEEL.md).
3. If the market passes, add one ordinary `robinhood-wizzy` entry to `src/config/markets.json`. Do not add a weight, sleeve flag, migration, or automatic allocation rule.
4. Run `bun run test && bun run typecheck && bun run build:web`.
5. Ship through the normal release path and verify `/api/markets`, the WIZZY market row, a real quote, wallet-owned LP minting, and collect/rebalance/withdraw actions.
6. Publish the canonical contract and pool disclosure. Never claim that other Wizzy deposits buy WIZZY, or describe the listing as guaranteed demand, price support, yield, or a floor.

Treasury fee flows do not change when the pool graduates or when the market is listed. Any treasury-owned WIZZY/WETH liquidity is a separate, disclosed treasury action.
