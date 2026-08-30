# Una token and index flywheel

## Decision

Treat the Una token as a **10% target sleeve**, not an asset that is guaranteed to remain exactly 10% at every moment.

- Target weight: 10%
- No-trade band: 8–12%
- Rebalance destination: 10%
- Review cadence: weekly, with an emergency risk review at any time
- Remaining 90%: allocated by the existing independent market-selection policy

This creates genuine buy flow from net index deposits after the sleeve is activated. It also creates sell flow from redemptions. A rising token price can move the sleeve above 12%, causing a sale back toward 10%; a falling price can move it below 8%, causing a purchase only when the liquidity and execution gates remain healthy. This is not a guaranteed bid, price floor, or promise of appreciation.

## Current product fees

All currently implemented consumer fees route to the dedicated Una treasury at `0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42`. They do not route to token holders and do not automatically buy the future token.

| Action | Implemented charge | Current destination |
| --- | --- | --- |
| Create index positions | 0.15% of the gross allocation on each destination | Una treasury |
| Reinvest position fees | 2% of the unclaimed fees being reinvested | Una treasury |
| Withdraw a position | 0.15% of the conservative, slippage-adjusted withdrawal basis | Una treasury |
| Rebalance | 0.15% is reserved in the catalog, but the launch web product does not expose or collect it yet | No launch-web collection |

Relay and network fees are separate third-party costs and are shown in the plan before signing. Changing any Una fee requires a code change, tests, user-facing disclosure, and a treasury review.

## Treasury policy before token activation

Until a reviewed token policy is approved, 100% of protocol revenue accumulates in the treasury. There is no automatic buyback, burn, dividend, staking yield, or token-holder revenue claim.

The proposed monthly operating budget is a policy target, not hard-coded routing:

- 60% product operations, security reviews, infrastructure, legal work, and runway;
- 25% two-sided protocol-owned market liquidity, subject to liquidity and concentration limits;
- 15% measured distribution, user education, and capped gas or onboarding support.

Unused budget remains in treasury. Market-liquidity spending must be two-sided and disclosed; it must not be described or operated as price support. Before the treasury controls material value, move custody from the current retrievable hot-wallet backup to a hardware-backed 2-of-3 multisig. Publish treasury addresses and a monthly inflow/outflow ledger without exposing private operational metadata.

## Flow mechanics

For a net deposit `D`, the intended Una-token purchase is approximately `D × 10%`, subject to liquidity, the 8–12% band, and execution limits. Redemptions unwind the sleeve proportionally. Weight drift inside the band does not trigger a trade.

The token's price must not determine its own eligibility or target weight. Una's curator can pause or remove the sleeve for a security failure, broken market, or insufficient liquidity, but cannot increase the weight to defend price.

The flywheel is therefore:

1. Users deposit into the index and receive self-custodied market positions.
2. Una earns the disclosed product fees above; trading fees remain with users except for the disclosed reinvest or withdrawal charge.
3. Treasury funds product quality, security, two-sided liquidity, and measured distribution.
4. After every activation gate passes, net index deposits allocate roughly 10% to the Una sleeve; redemptions sell the corresponding share.
5. Better product utility and distribution can bring more deposits and fee revenue, but the product must remain useful without token appreciation.

## Activation gates

Launching the token does not automatically add it to the index. Activation requires all of the following:

- a reviewed token contract with immutable or tightly constrained owner powers;
- verified source and public supply, allocation, vesting, and treasury disclosures;
- at least 30 days of live market history;
- at least $250,000 of usable onchain liquidity;
- at least $100,000 of genuine rolling seven-day volume;
- execution capacity for the proposed index order without exceeding 1% of usable pool depth;
- no unresolved transfer restrictions, blacklist powers, tax mechanics, mutable supply, or concentration risk;
- an independent legal review of the token, index inclusion, related-party disclosure, and marketing copy.

No wash trading, treasury self-trading, circular volume, or undisclosed volume incentives count toward these gates.

## Rebalance execution

- Trade only after the observed weight closes outside 8–12%.
- Return toward 10% using time-weighted orders.
- Cap a day's index order at the lower of 1% of usable pool depth or 10% of genuine average daily volume.
- Enforce a 24-hour cooldown between index-directed trades.
- Pause rather than force a rebalance when slippage, oracle quality, or liquidity is outside policy.
- Publish the target, band, last review, next review, realized slippage, and any pause reason in the product.

## Token contract and allocation constraints

The preferred contract is deliberately boring: fixed supply, no transfer tax, no blacklist, no hidden mint, no upgradeable transfer logic, and no marketing-dependent mechanics. If Pools deploys a standard contract, verify the deployed bytecode and owner powers before announcing it.

The final supply and allocation remain open decisions. Before launch, publish one table covering team, treasury, liquidity, community distribution, vesting contracts, cliffs, and every wallet that controls more than 1% of supply. Team and treasury allocations need onchain vesting rather than promises in copy.

## Pools launch sequence

1. Finalize name, ticker, supply, allocations, vesting, contract controls, risk disclosure, and launch mode.
2. Keep the dedicated creator address as the only launch signer; do not use it for ordinary product operations.
3. Move long-lived treasury authority and any retained allocation to a hardware-backed multisig before material value is present.
4. Connect the creator wallet to Pools and review the current Robinhood Chain transaction terms. Pools currently presents ordinary and crowd-launch paths; the connected transaction is the source of truth.
5. Simulate and independently review the creation transaction, initial liquidity, recipient wallets, creator permissions, and any vesting contracts.
6. Launch without index inclusion. Record the contract address and transaction hash before any social announcement.
7. Verify source, bytecode, supply, holders, owner powers, pool address, and usable liquidity from independent chain data.
8. Publish the canonical contract address and disclosures, then build genuine liquidity and distribution.
9. Activate the 10% sleeve only after every gate passes and the required policy code has shipped.

No token transaction, funding transfer, Pools signature, or custody migration should happen as a side effect of product deployment.

## X account sequence

Create the Una X account as a separate public identity using dedicated recovery details, a password-manager-generated credential, passkey or hardware key, and no reused profile copy or avatars. The account must not claim Robinhood, Uniswap, Pools, or Fomo affiliation.

Before launch, it may explain Una's product and publish risk education without implying that a token already exists. After onchain verification, pin one canonical post containing the contract address, chain, pool, supply disclosure, treasury links, and anti-scam warning. Never announce a contract address obtained only from an unconfirmed creation screen.

## Conflict controls

The Una token is a related-party constituent. The product must disclose that the operator controls the product treasury and may hold tokens. Treasury wallets, creator wallets, team allocation, vesting, fees, and any future buyback policy must be public before activation.

Index inclusion must not be presented as an investment guarantee. The token qualifies through a separate, auditable sleeve policy rather than being ranked against ordinary meme markets by an operator-controlled score.

## Launch evidence and abort conditions

The launch record must contain the reviewed transaction simulation, deployed contract and pool, verified bytecode, supply and holder snapshot, vesting addresses, treasury and creator addresses, liquidity depth, first 30 days of genuine volume, legal approval, and the exact product commit that can activate the sleeve.

Abort or pause on any unexpected owner power, tax, mint authority, recipient, liquidity lock, contract mismatch, misleading social account, concentrated undisclosed holder, abnormal volume, or inability to keep the sleeve within execution limits.

## Open decisions

- token name and ticker;
- Pools crowd launch versus ordinary launch;
- total supply, team and community allocations, and vesting;
- whether the token has utility beyond being a disclosed index sleeve;
- the official X handle and launch communications;
- whether protocol revenue ever accrues to token holders. No value-accrual claim should be made until it is implemented and independently reviewed.

Public-identity separation and launch-account controls are defined in [Launch privacy](LAUNCH_PRIVACY.md).
