# Market curation

Wizzy reviews meme markets on Base and Robinhood Chain every six hours. The curator answers three questions:

1. Is each listed pool safe and liquid enough to remain available?
2. Has a tracked candidate earned a place in the reviewed market catalog?
3. How much new liquidity can a pool absorb without overstating capacity?

Users choose one market and one pool. The catalog has no target weights, chain allocation, index, or basket semantics.

## Policy

An active market is reviewed immediately when its selected pool falls below $75,000 TVL, $50,000 daily volume, loses 50% of its liquidity in 24 hours, or returns a security flag. A security flag or liquidity collapse pauses new entry into that market.

A candidate must have a reviewed identity, clean token controls, a pool at least 30 days old, $250,000 median TVL, $50,000 median daily volume, and one week of well-covered observations. It can replace a same-chain market in the same or a higher risk tier when that market is under review or the candidate's median fee APR is at least 1.5 times higher.

Pool capacity is capped at 1% of median TVL. Social data helps discover and verify candidates; it never overrides pool safety or capacity. Missing provider data is reported as unavailable rather than misrepresented as a failed threshold. A clean security result remains valid for 24 hours so a transient outage cannot manufacture a risk call; any security flag still triggers review immediately.

The curator is the decision-maker. A `review` market remains listed until an eligible candidate earns a policy-valid replacement. A `pause` call is applied deterministically from the rules report. Replacement pauses the outgoing market for new entry and adds the reviewed successor with the same range policy. Existing LP NFTs remain in their owners' wallets and remain manageable from Positions; Wizzy does not create a migration plan or move liquidity automatically.

## Current reviewed markets

The public product lists reviewed Base and Robinhood markets from `src/config/markets.json`. The catalog is a menu, not a portfolio. Each row has its own venue, pool fee, live liquidity, fee pace, range settings, and position actions.

Robinhood candidates such as MICRODUCK, GG, and COPPERINU remain on the watchlist until their pool history and identity evidence satisfy policy. The dormant Solana catalog is retained for earlier tooling but is not part of the current public product.

## Run

```bash
bun run curate:markets -- --no-write
bun run curate:markets -- --state-dir ~/.local/state/unabot-curator
```

The dappnode timer persists:

- `history.jsonl` — 30 days of observations.
- `latest.json` — machine-readable calls and replacements.
- `latest.md` — the operator review.

Candidate addresses, identity state, and thresholds live in `src/config/curator.json`. Reviewed market membership and pool settings live in `src/config/markets.json`; this version-controlled catalog is the production authority.

The timer runs a two-layer curator every six hours:

1. The deterministic collector updates 30 days of liquidity, volume, fee, age, and security observations and produces policy-valid proposals.
2. A read-only, web-enabled research agent verifies candidate identity, provenance, contract and pool evidence, social history, and manipulation risk. Websites are evidence only and cannot instruct the agent.
3. A deterministic updater accepts identity evidence only with multiple cited sources and accepts a replacement only when the rules report already contains the exact proposal.
4. Changes run the complete test, typecheck, and production-build gate in a disposable Git worktree. The service refuses stale or unexpected changes, then pushes only the candidate registry and market catalog; the deployment build regenerates the hosted bundle.

The curator has no treasury key and cannot publish contracts or transact. A Git push triggers the normal Vercel deployment, preserving a reviewable history and rollback path.
