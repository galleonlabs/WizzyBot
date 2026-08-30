# Uniswap — APIs, Base deployments, agent surface

Last verified: 29 Aug 2026.

Sources (official):

- Developer platform: https://developers.uniswap.org
- Full ingest: https://developers.uniswap.org/llms-full.txt
- LP API: https://developers.uniswap.org/docs/liquidity/liquidity-provisioning-api/integration-guide
- Trading / Uniswap API: https://developers.uniswap.org/docs/trading/swapping-api/getting-started
- Common errors / rate limit: https://developers.uniswap.org/docs/trading/swapping-api/common-errors
- Integrator fee changelog: https://developers.uniswap.org/docs/changelog/active-notifications/setting-a-fee-through-the-api (posted 6 Mar 2026, effective 17 Mar 2026)
- Unified address feed: https://developers.uniswap.org/deployments.json (generatedAt 2026-07-15T22:25:40.000Z, source Uniswap/contracts commit 37936185dee7decf681360ec799c124e0e034672)
- v2 deployments: https://developers.uniswap.org/docs/protocols/v2/deployments
- v3 Base: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments
- v4 deployments: https://developers.uniswap.org/docs/protocols/v4/deployments
- Uniswap AI: https://developers.uniswap.org/docs/uniswap-ai/overview, https://developers.uniswap.org/docs/uniswap-ai/skills, source https://github.com/Uniswap/uniswap-ai
- Developer Platform / 6 RPS: https://uniswap.substack.com/p/everything-you-need-to-build-with, https://blog.uniswap.org/uniswap-developer-platform-is-live

UnaBot is **not** a Uniswap Labs product and is not endorsed by Uniswap Labs.

## 1. Two hosted APIs

Uniswap publishes two REST surfaces that share auth and Permit2 conventions. The canonical name for the swap surface is **Uniswap API**; "Trading API" is the legacy informal name being phased out (llms-full.txt FAQ).

| Surface | Host | Job |
| --- | --- | --- |
| Uniswap API (Trading API) | `https://trade-api.gateway.uniswap.org/v1` | Quote + build swap / UniswapX order calldata |
| Uniswap LP API | `https://liquidity.api.uniswap.org` | Build v2/v3/v4 LP lifecycle calldata |

The APIs return **unsigned** TransactionRequest objects. The integrator signs and broadcasts. The API is free at the developer-dashboard key; there is no per-call charge. Production use requires a key from https://developers.uniswap.org/dashboard.

### Required headers (both APIs)

Every request uses:

- `x-api-key: <dashboard key>`
- `Content-Type: application/json`
- `Accept: application/json`

Keep the key server-side. Do not ship it in front-end code.

Optional Uniswap API headers (confirm against the live API reference before depending on them):

| Header | Why |
| --- | --- |
| `x-universal-router-version: 2.1.1` | Required to take **fractional** integrator basis points (e.g. 10.25). Only UR 2.1.1 supports fractional bips. |
| `x-permit2-disabled` | If true, expect permitData to be null; falls back to classic approve. |
| `x-erc20eth-enabled` | ERC-20 ETH path. Treat as optional unless the live reference marks it required. |

### Rate limit

Most API keys default to **6 requests per second**. Exceeding it returns HTTP **429**. Official advice: pause the key, then retry with backoff. Ask Uniswap Developer Support for a higher cap. The Developer Platform post (2026) states the default was raised from 3 RPS to 6 RPS.

HTTP map (LP guide + trading common-errors): 200 OK; 400 validation; 401 missing/invalid x-api-key or unsupported header; 429 rate limit; 500/503 retry with backoff.

4xx on quote/swap is not retryable with the same payload. 5xx is transient. Quote and swap requests are idempotent.

## 2. Uniswap API (Trading API) endpoints

Host: `https://trade-api.gateway.uniswap.org/v1`

Interactive schemas: https://developers.uniswap.org/docs/api-reference

| Method | Path | Purpose |
| --- | --- | --- |
| GET or POST | `/check_approval` | Whether Permit2 / router has allowance; may return an approval tx |
| POST | `/quote` | Best route across AMM v2/v3/v4 and UniswapX |
| POST | `/swap` | Build classic (gasful) swap calldata for the integrator to submit |
| POST | `/order` | Submit a UniswapX (gasless-for-user) order for a filler to execute |
| GET | `/swappable_tokens` | Tokens the API will route |

llms-full.txt also lists LP verbs (`/lp/create`, `/lp/increase`, `/lp/decrease`, `/lp/claim`) on this ingest. **Do not use those as the LP host.** The LP integration guide is explicit: LP endpoints live on `https://liquidity.api.uniswap.org` with **no version prefix**. Treat the `/lp/*` lines in llms-full.txt as a headline list, not a URL.

### Quote to swap flow

1. `/check_approval` — if allowance is missing, sign and submit the returned approval tx first.
2. `/quote` with token in/out, amount, chain, recipient, optional `protocols` (V2, V3, V4, UNISWAPX_V2, UNISWAPX_V3). Default mixes AMM + UniswapX and returns the better effective output.
3. Classic route then `/swap` then sign + broadcast. UniswapX route then `/order` (filler pays gas).
4. UnaBot only needs classic AMM on Base. Do not depend on UniswapX for LP rebalance legs unless a later spec says so.

UniswapX V2 is listed on Ethereum, Arbitrum, and Base. UniswapX V3 is listed on Arbitrum only. Submitting UniswapX on an unsupported chain fails. UniswapX quotes have a minimum notional (getting-started page currently says 300 USDC-equivalent on all supported chains; llms-full.txt still says 300 on Ethereum and 1000 on L2s). **Treat the live getting-started page as current; mark the L2-1000 figure stale until confirmed.**

### Integrator fees

Two generations exist. Do not mix them up.

1. **Legacy API-key fee.** A static take configured on the key by Uniswap Labs, always from the output token. Requires a Labs contact. Quoted input/output amounts do **not** include the take; inspect `portionBips` / `portionAmount`.
2. **Per-request integrator fee (live 17 Mar 2026).** `/quote` accepts an `integratorFee` (changelog) / `integratorFees[]` (OpenAPI) object: `bips` in (0, 500] and a 0x recipient. The fee is encoded into `/swap` calldata. Fractional bips (two decimals) need `x-universal-router-version: 2.1.1`. Only one fee entry is supported. Labs recommends moving off the key-static fee.

**UnaBot product decision:** no extra swap take. Rebalance swaps pay the pool fee only. If a later version adds an integrator fee, send it to treasury `0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42` and never exceed 500 bips.

## 3. LP API endpoints

Host: `https://liquidity.api.uniswap.org` — no `/v1` prefix. Example: `https://liquidity.api.uniswap.org/lp/create`.

| Endpoint | Purpose | Protocols |
| --- | --- | --- |
| `POST /lp/check_approval` | Approval txs and/or Permit2 / v3 NFT permit typed data | V2, V3, V4 |
| `POST /lp/create` | Mint a concentrated position (one independent token amount; API computes the other) | V3, V4 |
| `POST /lp/create_classic` | Mint a full-range v2 position | V2 |
| `POST /lp/increase` | Add liquidity to an existing position (`nftTokenId` for v3/v4) | V2, V3, V4 |
| `POST /lp/decrease` | Remove `liquidityPercentageToDecrease` 1-100 | V2, V3, V4 |
| `POST /lp/claim_fees` | Collect uncollected fees | V3, V4 only |
| `POST /lp/pool_info` | Live pool state | V2, V3, V4 |

`MIGRATE` is a valid `action` on `/lp/check_approval`. There is **no** standalone `/lp/migrate` endpoint.

v2 fees are embedded in the LP token. `/lp/claim_fees` with `protocol: "V2"` is a validation error — realize v2 fees via `/lp/decrease`.

Native ETH address in LP requests: `0x0000000000000000000000000000000000000000`. The API may wrap a multicall with `refundETH`.

### Approval / permit

Always call `/lp/check_approval` before an LP write.

- v4 may return `v4BatchPermitData` (Permit2 typed data). Sign EIP-712 and pass `batchPermitData` + `signature` into create/increase. `generatePermitAsTransaction: true` returns an on-chain permit tx instead.
- v3 may return `v3NftPermitData` for the NonfungiblePositionManager. Same sign-and-pass pattern.
- Empty `transactions` array means allowances are already in place.

### Create parameters (v3/v4)

Provide exactly one of `existingPool` (token0Address, token1Address, poolReference = pool address on v3, pool ID on v4) or `newPool` (tokens, fee, tickSpacing, optional v4 hooks, initialPrice as sqrtRatioX96).

Provide exactly one of `priceBounds` (minPrice, maxPrice decimals — API snaps to tick spacing and returns adjustedMinPrice / adjustedMaxPrice) or `tickBounds` (tickLower, tickUpper).

Always show the **adjusted** prices to the user, not the raw input.

`simulateTransaction: true` adds a `gasFee` string. Calldata `data` must be a non-empty hex string. Never modify API calldata.

v3 `/lp/decrease` already collects uncollected fees via the SDK removeCallParameters. A separate `/lp/claim_fees` is not required on a full or partial v3 exit.

v4 `/lp/claim_fees` is a zero-liquidity decrease on PositionManager plus TAKE_PAIR.

## 4. Official Base (8453) addresses

Pulled 29 Aug 2026 from https://developers.uniswap.org/deployments.json and cross-checked against the v2 / v3-Base / v4 deployment pages. Checksum as published. **Do not assume the same address on another chain.**

### Tokens UnaBot uses

| Token | Address | Note |
| --- | --- | --- |
| WETH | `0x4200000000000000000000000000000000000006` | Official wrapped native on Base / Base Sepolia |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Native Circle USDC. Not from deployments.json. |
| USDbC | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` | Bridged USDC. Never treat as USDC. |

### v2

| Contract | Address |
| --- | --- |
| UniswapV2Factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` |
| UniswapV2Router02 | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` |

### v3 (core + periphery UnaBot actually calls)

| Contract | Address |
| --- | --- |
| UniswapV3Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| NonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |
| TickLens | `0x0CdeE061c75D43c82520eD998C23ac2991c9ac6d` |
| UniswapV3Staker | `0x42bE4D6527829FeFA1493e1fb9F3676d2425C3C1` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| UniversalRouter (v2.0, current default) | `0x6fF5693b99212Da76ad316178A184AB56D299b43` |

v3 fee tiers and tick spacing (protocol constants, not chain-specific): 100/1, 500/10, 3000/60, 10000/200.

### v4

| Contract | Address |
| --- | --- |
| PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| PositionManager | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` |
| PositionDescriptor | `0x25D093633990DC94BeDEeD76C8F3CDaa75f3E7D5` |
| V4Quoter | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` |
| StateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` |
| ReservesLens | `0x0000001b173C3bbF3984D417d8614E3eed34865B` |
| UniversalRouter 2.1.1 | `0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Checksums differ slightly between the docs HTML tables (often lower-case) and deployments.json (mixed). They are the same 20 bytes. Prefer the JSON feed when writing constants.

Universal Router on Base (from deployments.json):

| Alias in feed | Address |
| --- | --- |
| UniversalRouter / #v2.0 | `0x6fF5693b99212Da76ad316178A184AB56D299b43` |
| #v2.1 | `0xF3A4F4094BD2c6C06cA2F61789d8727B8d1e7259` |
| #v2.1.1 | `0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7` |
| #v1.2 | `0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD` |

v1 signer allowlist (from product code): NFPM, Permit2, Universal Router v2.0, treasury. Position tokens are added only for the fee/approval action in flight.

## 5. v2 / v3 / v4

Official v4-vs-v3 table (Uniswap AI v4-sdk-integration skill + protocol docs):

| Aspect | v3 | v4 |
| --- | --- | --- |
| Pool architecture | One contract per pool | Singleton PoolManager |
| Position NFT | NonfungiblePositionManager, one function per op | PositionManager.modifyLiquidities() multicall |
| Fee collection | Explicit collect() | Side effect of a zero-liquidity decrease + TAKE_PAIR |
| Position discovery | On-chain enumeration (tokenOfOwnerByIndex) | Off-chain event indexing |
| Approvals | Approve NFPM / router | Permit2 required |
| Native ETH | Wrap to WETH | Native pairs supported |
| Customization | Fixed fee tiers | Hooks + any static or dynamic fee |
| Addresses | Often reused across L2s, **not** a rule | Different per chain — always look up |

**Product: v2, v3, and v4 on Base.** Engineering facts:

1. The LP API already speaks `protocol: "V2"`, `"V3"`, and `"V4"`. Adapters, not a rewrite.
2. v3 positions are enumerable on-chain (`tokenOfOwnerByIndex`). A keeper can list tokenIds without a subgraph.
3. v4 needs event indexing. Hooks are untrusted code until reviewed (Uniswap v4 Security Framework). Refuse unknown hooks.
4. v2 fees are embedded in the LP token; realize them via `/lp/decrease`, not `/lp/claim_fees`.
5. Revert production automators that UnaBot copies (compound / range / exit) are v3 NFT operator flows. v4 automators exist at Revert (V4Utils on Base `0x209E399ac7FC8747c3821F9376E4eb6Ce105DbA8`) but are a different surface.

**speculation:** a v4 path should start with unhooked ETH/USDC-style pools and refuse unknown hooks.

## 6. MCP / skills / CLI landscape

Official Uniswap AI (https://github.com/Uniswap/uniswap-ai, docs /docs/uniswap-ai/skills):

Install: `npx skills add Uniswap/uniswap-ai`

Installer catalog (docs page, 29 Aug 2026): configurator, copy-trade, dca-bot, deployer, index-bot, liquidity-planner, pay-with-any-token, swap-integration, swap-planner, v4-security-foundations, viem-integration.

A later uniswap-ai commit (a5de459, PR #115) adds an lp-integration skill for the LP REST API. If the installer page has not listed it yet, install from the repo path packages/plugins/uniswap-trading/skills/.

There is **no official Uniswap MCP server** in the developer docs as of this note. Third-party vocab files mention a uniswap-defi-trading-mcp — **not official**. UnaBot ships its own stdio MCP (see product.md).

Uniswap does **not** ship a first-party "uniswap CLI" for LP ops. Builder CLIs that matter: Skills CLI above; Foundry for hooks / v4 contracts; UnaBot own `unabot` CLI.

## 7. LP primitives UnaBot implements against

These are Uniswap v3 facts, not product inventions:

1. A position is an ERC-721 minted by NFPM. Owner = whoever holds the NFT.
2. Fees accrue *outside* the pool reserves, per position, and do not auto-compound.
3. In-range vs out-of-range is a tick comparison: in-range iff tickLower <= currentTick < tickUpper.
4. Mint / increase require the token ratio implied by the current price vs the range. The LP API computes the dependent amount.
5. Decrease + collect (or decrease alone on v3) returns principal + uncollected fees.
6. Re-range is not a protocol primitive. It is decrease + (optional swap) + mint a new NFT with a new tick range. The old tokenId dies; the new one is a new NFT.
7. Divergence / IL vs HOLD is real. Uniswap does not claim "no IL". Neither does UnaBot.

Tick bounds: MIN_TICK = -887272, MAX_TICK = 887272, snapped to the pool tickSpacing.

## 8. Marketing notes (facts, for GTM later)

From Uniswap Labs public posts, not UnaBot claims:

- Developer Platform is live; thousands of API keys issued; MetaMask and Privy listed as integrators (Labs blog).
- Same routing stack is described as serving Uniswap apps, OKX, Fireblocks, Talos, Anchorage Digital.
- Labs markets "~200ms routing, >97% fill rates, 10M+ assets, 18 chains" — **their** numbers; do not repeat as UnaBot SLOs.
- API is positioned as free (no subscription, no per-call charge) with dashboard analytics (quote volume, fill rate).
- Builder support pages exist for grants, co-marketing, and security (audits, safe harbor): /docs/ecosystem/builder-support/*.
- Liquidity Launchpad / CCA is a v4 bootstrap product. Out of v1 scope.
- Smart Wallet (Calibur, EIP-7702) preserves the EOA address. Interesting for a later "no new address" signer, not v1.

**Do not** imply Uniswap endorsement. **Do** say "built on the official Uniswap LP API and v3 contracts on Base."

## 9. Open items

- Confirm whether `integratorFee` (singular, changelog) or `integratorFees` (array, OpenAPI) is the live field name. Send a dry `/quote` against the playground before wiring.
- Confirm UniswapX minimum notional on Base (300 vs 1000 USDC-equivalent).
- Re-fetch deployments.json before any mainnet allowlist change.
