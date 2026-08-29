# UnaBot LP skill

Use this skill to operate **UnaBot**, Galleon Labs' agent-first Uniswap v3 LP bot on Base.

PRIVATE. Not affiliated with Uniswap Labs. The user keeps the NFT. No vault custody.

## When to use

- Inspect Base v3 positions (list, card, PnL vs HOLD)
- Mint / increase / decrease / claim
- Compound fees, re-range when OOR, or exit at a price
- Run as a keeper or via MCP stdio

## Hard rules

- Chain: Base `8453` only. Protocol: Uniswap v3. Do not touch Aerodrome or take the NFT.
- Dry-run is default. Require an explicit user confirmation before `--live`.
- Never print `UNABOT_PRIVATE_KEY` or `.env`.
- Product fees go to treasury `0xC141Cbe4f4a9CAbc3cc78159a9268a4e008922CD`.
- `--no-fee` is only for the owner self-compounding.
- `--fee-source fees|notional` on range/exit. Compound is always 2% of fees unless `--no-fee`.
- Native USDC on Base is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. USDbC is not USDC.
- Do not claim "no IL".

## CLI

```
unabot list --owner <addr>
unabot status <tokenId>
unabot mint --token0 <addr> --token1 <addr> --fee 500 --width 10
unabot compound <tokenId>
unabot range <tokenId> --oor 0
unabot exit <tokenId> --swap-to <addr>
unabot run --once
unabot chat
unabot "<natural language>"
```

## MCP tools

`pool_info`, `position_list`, `position_pnl`, `quote_mint`, `create`, `increase`, `decrease`, `claim`, `compound`, `rebalance`, `exit`, `simulate`

Launch: `unabot mcp` (JSON-RPC on stdio).

## Policy

Read `unabot.config.json` and `~/.unabot/config.json`. Honor `minFeeUsd`, `minPositionUsd`, `maxPriceImpactBps`, `cooldownSec`, `spendCapUsd`, `oorPercent`.

## Confirm before writes

For mint / compound / re-range / exit in live mode, show the planned receipt (actions, treasury take, from/to) and wait for `yes`.
