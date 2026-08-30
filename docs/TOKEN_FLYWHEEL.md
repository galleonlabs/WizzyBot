# Una token and index flywheel

## Decision

Treat the Una token as a **10% target sleeve**, not an asset that is guaranteed to remain exactly 10% at every moment.

- Target weight: 10%
- No-trade band: 8–12%
- Rebalance destination: 10%
- Review cadence: weekly, with an emergency risk review at any time
- Remaining 90%: allocated by the existing independent market-selection policy

This creates organic demand when the index has net deposits. It also creates organic supply when users withdraw. The mechanism must never be described as a guaranteed bid, price support, or perpetual buying.

## Flow mechanics

For a net deposit `D`, the intended token purchase is approximately `D × 10%`, subject to liquidity and execution limits. Redemptions unwind the sleeve proportionally. Weight drift inside the band does not trigger a trade.

The token's price must not determine its own eligibility or target weight. Una's curator can pause or remove the sleeve for a security failure, broken market, or insufficient liquidity, but cannot increase the weight to defend price.

## Activation gates

Launching the token does not automatically add it to the index. Activation requires all of the following:

- a reviewed token contract with immutable or tightly constrained owner powers;
- verified source and public supply, allocation, and treasury disclosures;
- at least 30 days of live market history;
- at least $250,000 of usable onchain liquidity;
- at least $100,000 of genuine rolling seven-day volume;
- execution capacity for the proposed index order without exceeding 1% of usable pool depth;
- no unresolved transfer restrictions, blacklist powers, tax mechanics, or concentration risk;
- an independent legal review of the token, index inclusion, related-party disclosure, and marketing copy.

No wash trading, treasury self-trading, or volume incentives count toward these gates.

## Rebalance execution

- Trade only after the observed weight closes outside 8–12%.
- Return toward 10% using time-weighted orders.
- Cap a day's index order at the lower of 1% of usable pool depth or 10% of genuine average daily volume.
- Enforce a 24-hour cooldown between index-directed trades.
- Pause rather than force a rebalance when slippage, oracle quality, or liquidity is outside policy.
- Publish the target, band, last review, next review, and any pause reason in the product.

## Conflict controls

The Una token is a related-party constituent. The product must disclose that the operator controls the product treasury and may hold tokens. Treasury wallets, team allocation, vesting, fees, and any future buyback policy must be public before activation.

Index inclusion must not be presented as an investment guarantee. The token should qualify through a separate, auditable sleeve policy rather than being ranked against ordinary meme markets by an operator-controlled score.

## Launch sequence

1. Finalize name, ticker, supply, allocations, vesting, contract controls, and public risk disclosure.
2. Move the product treasury to a hardware-backed multisig before it controls material value.
3. Choose a Pools launch mode after reviewing the connected launch form and current transaction terms. Pools currently presents Robinhood Chain token creation, crowd launches, ordinary launches, and linked X identities.
4. Launch the token without index inclusion.
5. Build genuine liquidity and distribution; publish treasury and concentration dashboards.
6. Activate the 10% sleeve only after every gate passes.
7. Measure net deposits, redemptions, sleeve turnover, realized slippage, liquidity consumed, and time spent outside the band.

## What remains undecided

- token name and ticker;
- Pools crowd launch versus ordinary launch;
- total supply, team and community allocations, and vesting;
- whether the token has utility beyond being a disclosed index sleeve;
- the official X handle and launch communications;
- whether protocol revenue ever accrues to token holders. No value-accrual claim should be made until it is implemented and reviewed.

