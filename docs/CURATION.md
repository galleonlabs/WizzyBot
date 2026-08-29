# Index curation

Una runs one small index. The curator answers three questions every six hours:

1. Is each active pool safe and liquid enough to keep?
2. Which tracked candidate has proved it can earn more without reducing capacity?
3. How much new Una capital can each pool absorb?

## Policy

An active market is reviewed immediately when its selected pool falls below $100,000 TVL, $50,000 daily volume, loses 50% of its liquidity in 24 hours, or returns a security flag. A security flag or liquidity collapse is a pause call.

A candidate must have a reviewed identity, clean token controls, a pool at least 30 days old, $250,000 median TVL, $50,000 median daily volume, and one week of well-covered observations. It can replace a same-chain market in the same or a higher risk tier when that market is under review or the candidate's median fee APR is at least 1.5 times higher.

Pool capacity is capped at 1% of median TVL. Social data helps discover and verify candidates; it never overrides pool safety or capacity.

Catalog changes remain code-reviewed because they alter new deposits. Paused markets stay in the catalog so existing positions remain visible and withdrawable.

## Current index

The 2026-08-30 review reduced the index from eight markets to five:

- Base: BRETT 70%, BASECAT 30%.
- Robinhood Chain: CASHCAT 100%.
- Solana: FARTCOIN 60%, USELESS 40%.

TOSHI, DEGEN, and the selected PENGU/SOL pool are paused for new deposits after weak pool turnover. CATE and ANSEM remain on the Solana candidate bench; CATE's identity is reviewed, while ANSEM still needs concentration review.

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
