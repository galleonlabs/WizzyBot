# Index curation

Una should optimize for durable, capacity-aware LP earnings, not the highest number in a 24-hour APR column. The curator is an evidence service. It cannot change index membership, weights, ranges, or sign transactions.

## Operating cadence

Run the snapshot collector hourly on dappnode. Hourly data is frequent enough to catch liquidity failures and retain useful price and fee history without turning short-lived noise into portfolio churn.

- Every hour: record pool liquidity, volume, fee pace, price movement, market cap, holder distribution, venue safety fields, and identity links.
- Every day: inspect hard failures and newly breached gates. A failed security check or a 50% 24-hour liquidity collapse receives an immediate pause review.
- Every week: review sustained constituent underperformance and replacement studies. Membership and weights only change in a reviewed catalog commit.
- Every quarter: recalibrate thresholds against realized LP results, index capacity, range uptime, divergence loss, compounding cost, and rebalance cost.

The service retains 30 days of hourly snapshots. A maintained market needs at least 7 days of well-covered history for an economic call. A candidate needs 14 tracked days and must be at least 30 days old before it can become eligible.

## Decision stack

Hard gates come first. Social attention never overrides them.

1. **Identity and contract safety**: exact token and pool addresses, reviewed identity, no honeypot or sell restriction, no mutable supply or balances, no dangerous pause/freeze capability, and no venue blacklist.
2. **Market capacity**: $250,000 median pool TVL for candidates, $150,000 maintenance floor, $50,000 median daily volume, $5 million market cap, 5,000 holders, and no externally owned address above 20% of supply.
3. **LP economics**: median fee pace, liquidity available to absorb deposits, price volatility, observation coverage, and pool durability. Extreme one-day APR is capped by the score and cannot bypass the proof window.
4. **Social durability**: official web/social identity and human review. Paid DEX boosts are not treated as organic demand. Follower or mention velocity can be added through a reviewed data adapter, but remains a soft signal because it is cheap to manipulate.
5. **Replacement hysteresis**: an eligible candidate must beat the weakest same-chain constituent by at least 15 points after its 14-day proof window. The service proposes a study; it does not make the swap.

New index capital should not exceed 1% of the selected pool's median TVL. The report exposes that estimated capacity per market so rapid product growth cannot silently turn a healthy pool into an unsafe allocation.

## What the first snapshot says

The first run is evidence, not a membership decision. It cannot satisfy the 7- or 14-day windows.

- CASHCAT, USELESS, and FARTCOIN currently clear the main liquidity and volume gates.
- BASECAT has strong fee activity but is about 14 days old and has fewer than 5,000 holders. Its four-digit 24-hour fee APR is not accepted as a durable return rate.
- DEGEN is old, liquid, open-source, non-mintable, and not flagged as a honeypot. The selected pool is economically weak at roughly $17,000 daily volume against roughly $955,000 of TVL, so it belongs in sustained-performance review rather than a rug/dead-token bucket.
- TOSHI currently has similar low turnover and should be reviewed by the same rule.
- PENGU is an asset/venue mismatch: the selected SOL pool has roughly $75,000 TVL and $4,000 daily volume. Meteora also reports a much larger PENGU/USDC pool, but Una's current Solana deposit path only supports SOL quote pools. The curator should flag the venue and product capability, not declare PENGU itself failed.
- CATE and ANSEM currently show strong Solana pool activity, but remain watch candidates until their identities, social history, and 14-day performance proof are complete.

## Files and outputs

Run once without writing:

```bash
bun run curate:index -- --no-write
```

Run with persistent state:

```bash
bun run curate:index -- --state-dir ~/.local/state/unabot-curator
```

The service writes private files outside the repository:

- `history.jsonl`: rolling hourly snapshots, pruned to the configured 30-day window.
- `latest.json`: machine-readable evaluations and replacement studies.
- `latest.md`: human review packet.

Candidate identities and exact executable pools live in `src/config/curator.json`. Broad discovery should only add a token to that watch file after address and meme identity review. It must never promote a pool found from a symbol search alone.

## Shipping a catalog change

1. Read the latest 14- and 30-day history, not just `latest.json`.
2. Validate the exact pool, fee, tick/bin spacing, quote token, venue adapter, and zap route.
3. Compare the candidate with the weakest same-chain constituent using realized fee capture, range uptime, divergence loss, and execution costs where available.
4. Mark an old market `watch` or `paused`; do not delete it while users may still own positions.
5. Reweight the chain to exactly 10,000 basis points, test, review, ship, and monitor new deposits.

Existing user positions remain self-custodial. A catalog update only changes new deposits. Users choose when to rebalance or withdraw an older position.
