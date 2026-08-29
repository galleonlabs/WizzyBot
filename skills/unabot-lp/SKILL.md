# UnaBot

Uniswap LP on autopilot.

v2, v3, and v4. You keep the position.

Compound, re-range, exit.

## Use

List, status, mint, compound, range, exit. Chat, Telegram, or MCP.

## Rules

- Base. Dry-run default. Live needs `yes`.
- Never print keys or `.env`.
- `--no-fee` skips the take. `--fee-source fees|notional` on range/exit.
- You keep the position. No vault.

## Commands

```
unabot list --owner <addr>
unabot status <tokenId>
unabot pool --token0 <addr> --token1 <addr> --fee 500
unabot mint --token0 <addr> --token1 <addr> --fee 500 --width 10 --amount0 <raw> --amount1 <raw>
unabot compound <tokenId>
unabot range <tokenId>
unabot exit <tokenId>
unabot telegram
unabot mcp
```

MCP: `pool_info`, `position_list`, `position_pnl`, `quote_mint`, `create`, `increase`, `decrease`, `claim`, `compound`, `rebalance`, `exit`, `simulate`. `create` is mint.
