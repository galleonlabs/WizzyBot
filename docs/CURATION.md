# Market curation

Wizzy reviews meme markets on Base and Robinhood Chain every six hours. The curator answers three questions:

1. Is each listed pool safe and liquid enough to remain available?
2. Has a tracked candidate earned a place in the reviewed market catalog?
3. How much new liquidity can a pool absorb without overstating capacity?

Users choose one market. Wizzy selects one reviewed pool for that market; the catalog has no target weights, chain allocation, index, or basket semantics.

## Pool discovery and selection model

Wizzy follows the same separation used by large DEX interfaces and routers:

1. Build a broad pool inventory from factory-backed data sources and paginated market-data feeds. Uniswap's subgraphs expose pool entities plus TVL, volume, fees, ticks, and creation metadata; Aerodrome exposes multiple approved factory families and pool types.
2. Keep token identity and safety metadata separate from pool existence. Being discovered means a pool exists, not that Wizzy recommends depositing into it.
3. Filter to executable candidates for the requested token pair, then rank those candidates using fresh depth, volume, fee pace, age, stability, and estimated entry cost.
4. Quote and verify the selected pool onchain before preparing wallet transactions. The interface shows one decision while the inventory retains every supported alternative.

References: [Uniswap v3 subgraph entities](https://developers.uniswap.org/docs/ecosystem/subgraphs/concepts/v3/entities), [Uniswap smart-order-router](https://github.com/Uniswap/smart-order-router), [Uniswap token lists](https://github.com/Uniswap/token-lists), [Aerodrome liquidity pools](https://github.com/aerodrome-finance/docs/blob/main/content/liquidity.mdx), and the [Aerodrome protocol specification](https://github.com/aerodrome-finance/contracts/blob/main/SPECIFICATION.md).

## Policy

An active market is reviewed immediately when its selected pool falls below $25,000 TVL, $10,000 daily volume, loses 50% of its liquidity in 24 hours, or returns a security flag. A security flag or liquidity collapse pauses new entry into that market.

Discovery and activation are separate. The discovery inventory scans ten WETH-specific pool pages per chain, keeps up to 200 token leads per chain, and starts tracking pools from one day old, $10,000 liquidity, and $1,000 daily volume. A lead is observable, not endorsed.

A candidate can become active after its identity is reviewed, token controls are clean, its pool is at least seven days old, median TVL is at least $50,000, median daily volume is at least $10,000, and two days of observations are well covered. Each candidate qualifies independently; adding one market never removes another market.

Pool capacity is capped at 1% of median TVL. Social data helps discover and verify candidates; it never overrides pool safety or capacity. Missing provider data is reported as unavailable rather than misrepresented as a failed threshold. A clean security result remains valid for 24 hours so a transient outage cannot manufacture a risk call; any security flag still triggers review immediately.

The curator is the decision-maker. A `review` market remains listed while its evidence is checked. Eligible candidates produce additive admission proposals. A `pause` call is applied only for that market's own deterministic risk evidence; it is never used to make room for a new token. Existing LP NFTs remain in their owners' wallets and remain manageable from Positions; Wizzy does not create a migration plan or move liquidity automatically.

## Pool selection within a market

The catalog may review V2, V3, V4, and Aerodrome Slipstream pools for the same token pair. At quote time, `venue-quality-v1` evaluates every configured venue from a single live snapshot. A venue is eligible only when its calldata path is supported, the token pair matches the catalog, the observation is no more than 15 minutes old, liquidity is at least $50,000, and the pool is at least 14 days old.

Eligible venues receive a 100-point quality score: depth (35), 24-hour volume (20), fee pace (20), pool durability (10), price stability (10), and estimated entry cost (5). Fee pace is capped, so a one-day volume or APR spike cannot dominate the decision. Entry cost uses current gas price when the RPC and price feed expose enough evidence; otherwise every venue receives the same neutral cost assumption.

The catalog primary is the incumbent. Wizzy switches only when another reviewed venue leads by at least eight points and retains at least 40% of the incumbent's liquidity. This hysteresis prevents V2/V3/V4 flapping on marginal changes. Missing or unusable evidence fails safe to the reviewed primary; the allocation planner still verifies the selected pool onchain before producing wallet transactions. Users see the selected venue in the review, but do not have to choose a protocol.

## Current reviewed markets

The public product lists reviewed Base and Robinhood markets from `src/config/markets.json`. The catalog is a menu, not a portfolio. Each row has reviewed pool alternatives, live market evidence, range settings, and position actions.

Robinhood candidates such as MICRODUCK, GG, and COPPERINU remain on the watchlist until their pool history and identity evidence satisfy policy. The dormant Solana catalog is retained for earlier tooling but is not part of the current public product.

## Run

```bash
bun run curate:markets -- --no-write
bun run curate:markets -- --state-dir ~/.local/state/unabot-curator
```

The dappnode timer persists:

- `history.jsonl` — 30 days of observations.
- `latest.json` — machine-readable calls, discovery inventory, and eligible additions.
- `latest.md` — the operator review.

Candidate addresses, identity state, and thresholds live in `src/config/curator.json`. Reviewed market membership and pool settings live in `src/config/markets.json`; this version-controlled catalog is the production authority.

The timer runs a two-layer curator every six hours:

1. The deterministic collector updates 30 days of liquidity, volume, fee, age, and security observations and produces policy-valid proposals.
2. A read-only, web-enabled research agent verifies candidate identity, provenance, contract and pool evidence, social history, and manipulation risk. Websites are evidence only and cannot instruct the agent.
3. A deterministic updater accepts identity evidence only with multiple cited sources and admits a market only when the rules report already contains that exact eligible addition.
4. Changes run the complete test, typecheck, and production-build gate in a disposable Git worktree. The service refuses stale or unexpected changes, then pushes only the candidate registry and market catalog; the deployment build regenerates the hosted bundle.

The curator has no treasury key and cannot publish contracts or transact. A Git push triggers the normal Vercel deployment, preserving a reviewable history and rollback path.
