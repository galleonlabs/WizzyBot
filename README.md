# UnaBot

**PRIVATE.** Galleon Labs. Not a Uniswap Labs product and not endorsed by Uniswap Labs.

Agent-first Uniswap v3 LP automation on Base (8453). Bankr-style CLI / chat plus Revert-style compound / re-range / exit. **You keep the Uniswap v3 NFT.** No vault custody. No Revert Lend. No Aerodrome.

v1 is Base Uniswap v3 only. Protocol interfaces are typed so v4 can be added later.

A Virtuals token is a later launch step, not part of this repo.

This software does **not** claim no IL. Concentrated liquidity diverges from HOLD.

## Treasury

`0xC141Cbe4f4a9CAbc3cc78159a9268a4e008922CD`

All product fees go to the address in src/constants.ts (TREASURY).

## Fees

- Auto-compound: 2% of compounded fees to treasury. --no-fee owner self-compound skips the take.
- Auto-range / auto-exit: default 2% of uncollected fees; optional 0.15% of position notional (--fee-source notional|fees).
- No extra swap fee. Rebalance swaps pay the DEX pool fee only.

## Env

Copy .env.example. Never commit .env or a private key.

- BASE_RPC_URL: reads, default https://mainnet.base.org
- UNISWAP_API_KEY: LP API + Trading API writes (x-api-key, Content-Type and Accept = application/json)
- UNABOT_PRIVATE_KEY: viem privateKeyToAccount. Never logged.
- UNABOT_TREASURY: optional treasury override
- UNABOT_ETH_USD: fallback for skip math

Without an API key, UnaBot still does full read / PnL / dry-run and assembles calldata with the Uniswap v3 SDK + viem.

## Dry-run vs live

Dry-run is the default. --live broadcasts. Live writes require typing yes.

Signer allowlist: NFPM, Permit2, Universal Router, treasury. Position tokens are added only for fee transfers and approvals.

## CLI

unabot list | import | status | pool | mint | compound | range | exit | simulate | run | chat | mcp | config

Also: unabot "status 12345" for natural language. Global flags: --live --no-fee --fee-source fees|notional

## Policy

~/.unabot/config.json merged with ./unabot.config.json. Per-tokenId rules, spend caps, minFeeUsd, maxPriceImpactBps, cooldownSec, oorPercent (0 = only fully OOR).

unabot run is the keeper. It logs skip / execute decisions.

## MCP

Stdio JSON-RPC tools: pool_info, position_list, position_pnl, quote_mint, create, increase, decrease, claim, compound, rebalance, exit, simulate.

See skills/unabot-lp/SKILL.md.

## Official Base v3 addresses

Canonical list lives in src/constants.ts. USDC on Base is native USDC, not USDbC.

## Threat model

The signer key is a hot key. Whoever runs --live has custody of that EOA. UnaBot never takes the NFT. A leaked key can drain allowlisted targets. Quotes go stale; slippage limits are backstops, not guarantees.

## Develop

Node 22 recommended.


Use package scripts: install, test, build.

CI workflow template: docs/github-ci.yml (copy to .github/workflows/ci.yml).
