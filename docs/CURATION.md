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

The curator is the decision-maker. A `review` incumbent remains until an eligible candidate earns a policy-valid replacement; it is not an operator approval queue. A `pause` recommendation stops all new registry-backed deposits immediately. Eligible replacements inherit the outgoing market's weight and range width, preserving a 10,000-basis-point snapshot without exposing arbitrary model-generated calldata.

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
bun run registry:sync -- --report=~/.local/state/unabot-curator/latest.json
```

The dappnode timer persists:

- `history.jsonl` — 30 days of observations.
- `latest.json` — machine-readable calls and replacements.
- `latest.md` — the operator review.

Candidate addresses and thresholds live in `src/config/curator.json`. Once deployed, `UnaIndexRegistry` is authoritative for Robinhood membership and weights. `registry:sync` is dry-run by default; the dappnode service adds `--live` only when a registry address and the single Una private key are present in its restricted environment file.
