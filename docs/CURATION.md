# Index curation

Una launches with one Robinhood Chain index. The curator answers three questions every six hours:

1. Is each active pool safe and liquid enough to keep?
2. Which tracked candidate has proved it can earn more without reducing capacity?
3. How much new Una capital can each pool absorb?

## Policy

An active market is reviewed immediately when its selected pool falls below $75,000 TVL, $50,000 daily volume, loses 50% of its liquidity in 24 hours, or returns a security flag. A security flag or liquidity collapse is a pause call.

A candidate must have a reviewed identity, clean token controls, a pool at least 30 days old, $250,000 median TVL, $50,000 median daily volume, and one week of well-covered observations. It can replace a same-chain market in the same or a higher risk tier when that market is under review or the candidate's median fee APR is at least 1.5 times higher.

Pool capacity is capped at 1% of median TVL. Social data helps discover and verify candidates; it never overrides pool safety or capacity.

Missing provider data is reported as unavailable, not as a failed liquidity or volume threshold. A clean security result remains valid for 24 hours so a transient provider outage cannot manufacture a risk call; any security flag still triggers review immediately.

Catalog changes remain code-reviewed because they alter new deposits. Paused markets stay in the catalog so existing positions remain visible and withdrawable.

## Robinhood launch index

The 2026-08-30 launch review selected six Robinhood Uniswap v3 WETH markets with at least 30 days of pool history:

- CASHCAT 35%.
- PONS 22%.
- AI 17%.
- CHUMP 12%.
- STONKBROKER 9%.
- PONSGUY 5%.

MICRODUCK, GG, and COPPERINU are tracked as Robinhood candidates but are too new and still need identity review. The Base and Solana catalogs remain available for existing positions and later per-network launches; they are not part of the public MVP index.

## Run

```bash
bun run curate:index -- --no-write
bun run curate:index -- --state-dir ~/.local/state/unabot-curator
```

The dappnode timer persists:

- `history.jsonl` — 30 days of observations.
- `latest.json` — machine-readable calls and replacements.
- `latest.md` — the operator review.

Candidate addresses and the thresholds live in `src/config/curator.json`. Active weights live in `src/config/markets.json` and `src/config/solana-markets.json`.
