# Una

Liquidity, as an agent.

v2, v3, and v4. You hold the NFT.

## Use

List, status, mint, compound, range, exit. Chat, Telegram, or MCP.

## Rules

- Base. Dry-run default. Live needs `yes`.
- Never print keys or `.env`.
- `--no-fee` skips the take. `--fee-source fees|notional` on range/exit.
- You hold the NFT. No vault.

## Commands

```
unabot list --owner <addr> --protocol v3
unabot status <tokenId> --protocol v3
unabot pool --token0 <addr> --token1 <addr> --fee 500
unabot mint --protocol v3 --token0 <addr> --token1 <addr> --fee 500 --width 10 --amount0 <raw> --amount1 <raw>
unabot compound <tokenId> --protocol v3
unabot range <tokenId> --protocol v3
unabot exit <tokenId> --protocol v3
unabot telegram
unabot mcp
```

MCP verbs: `list`, `status`, `mint`, `compound`, `range`, `exit`, `simulate`. Aliases: `position_list`, `position_pnl`, `create`, `rebalance`, plus `pool_info`, `quote_mint`, `increase`, `decrease`, `claim`.

`--protocol v2|v3|v4` defaults to v3. You hold the NFT.
