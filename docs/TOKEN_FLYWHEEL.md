# Wizzy token and index plan

Decision recorded: 30 August 2026.

## Decision

Launch the Wizzy application without a Wizzy token. A token is a separate, later launch that must earn its place in the product.

| Item | Initial application launch | Earliest later state |
| --- | --- | --- |
| Wizzy token | Not launched | Separate reviewed token launch |
| Wizzy index weight | 0% | 5% related-party sleeve after every activation gate passes |
| Maximum index weight | 0% | 10% after a later expansion review |
| Protocol fees sent to token/WETH liquidity | 0% | Up to 25% of protocol revenue under a published treasury policy |
| Token-holder revenue right | None | None unless separately implemented and legally reviewed |

This sequencing preserves two clear launches. The application must prove that people want the curated index without relying on token appreciation. The token can then add community participation and liquidity without making the initial product look like a distribution mechanism for an operator-controlled asset.

## Non-negotiable boundaries

- The ordinary curator never ranks, selects, promotes, or increases the Wizzy token.
- The token's price, fee APR, or treasury-funded liquidity never determines its target weight. Genuine volume and liquidity are safety gates, not ranking signals.
- Index deposits are not a guaranteed bid. Redemptions sell the sleeve proportionally.
- Protocol-owned liquidity is two-sided liquidity, not a buyback, dividend, yield, price floor, or promise of appreciation.
- No token transaction, funding transfer, Pools signature, custody migration, or fee-routing change happens as a side effect of an application deployment.
- The product must remain useful if the token falls substantially or the sleeve is paused permanently.

## Why the token does not launch with the application

At the current 0.15% create fee, a `1 ETH` deposit produces about `0.0015 ETH` of protocol revenue. If a future 5% sleeve is active, the same deposit buys about `0.05 ETH` of the token. If half of the create fee were swapped into the token to form balanced token/WETH liquidity, that swap would buy only `0.00075 ETH` of the token.

The index-directed purchase would therefore be about 67 times larger than the fee-funded purchase at a 5% sleeve, and about 133 times larger at a 10% sleeve. The meaningful demand comes from index allocation, not from routing fees into liquidity. Launching both together would give early token holders a predictable source of exit liquidity before the product has proved independent demand.

## Staged rollout

### Stage 0 — application launch

- Launch the curated Robinhood Chain index with no Wizzy token and no related-party sleeve.
- Route all implemented product fees to the Wizzy treasury under the current fee schedule.
- Make no public promise about a token date, index inclusion, buybacks, fee support, yield, or appreciation.
- Publish the treasury address and keep a monthly inflow/outflow ledger.
- Measure deposits, withdrawals, retained wallets, realized protocol revenue, support load, execution quality, and security incidents for at least 30 days.

### Stage 1 — token decision

After at least 30 days of application evidence, make an explicit go/no-go decision. Proceed only if:

- the product has demonstrated use independent of a token;
- expected revenue can fund security, infrastructure, legal work, and runway without putting all fees into liquidity;
- the token has a concrete community or product role beyond expected price appreciation;
- independent legal advice covers the intended jurisdictions, public communications, token distribution, related-party index inclusion, and treasury policy;
- supply, allocations, vesting, contract controls, launch mode, treasury authority, and public disclosures are complete.

A no-go decision leaves the application and treasury policy unchanged.

### Stage 2 — token launch without index inclusion

- Launch the token as a separate event.
- Use a fixed-supply contract with no transfer tax, blacklist, hidden mint, or upgradeable transfer logic.
- Publish verified source, bytecode, supply, allocations, vesting contracts, creator and treasury wallets, initial liquidity, and every wallet controlling more than 1% of supply.
- Record the contract address and confirmed transaction before any public announcement.
- Build genuine, independently observable liquidity and distribution. Do not count wash trading, treasury self-trading, circular volume, or undisclosed incentives.
- Keep the index target at 0% throughout this stage.

### Stage 3 — activate a 5% sleeve

After every activation gate passes, activate the token as a fixed **5% related-party sleeve**:

- target weight: 5%;
- no-trade band: 3–7%;
- rebalance destination: 5%;
- review cadence: weekly, with an emergency risk review at any time;
- remaining 95%: allocated by the independent market-selection policy.

This creates buy flow from net index deposits and sell flow from redemptions. A rising token price can move the sleeve above 7%, causing a sale toward 5%. A falling price can move it below 3%, causing a purchase only while every liquidity and execution gate remains healthy.

### Stage 4 — optional expansion to a 10% maximum

The sleeve can move from 5% to a maximum 10% only after:

- at least 90 days of stable 5% operation;
- no unresolved security, disclosure, execution, concentration, or market-integrity incident;
- published evidence that deposits and retention remain healthy after sleeve activation;
- a fresh liquidity, treasury, conflict, and legal review;
- a reviewed product change and advance public notice.

At 10%, use an 8–12% no-trade band and rebalance toward 10%. Ten percent is a hard maximum, not the default next step.

## Current product fees

All currently implemented consumer fees route to the dedicated Wizzy treasury at `0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42`. They do not route to token holders and do not automatically buy a future token.

| Action | Implemented charge | Current destination |
| --- | --- | --- |
| Create index positions | 0.15% of the gross allocation on each destination | Wizzy treasury |
| Reinvest position fees | 2% of the unclaimed fees being reinvested | Wizzy treasury |
| Withdraw a position | 0.15% of the conservative, slippage-adjusted withdrawal basis | Wizzy treasury |
| Rebalance | 0.15% is reserved in the catalog, but the launch web product does not expose or collect it yet | No launch-web collection |

Relay and network fees are separate third-party costs and are shown in the plan before signing. Changing a Wizzy fee requires a code change, tests, user-facing disclosure, and a treasury review.

## Treasury and liquidity policy

Until Stage 3 is activated, 100% of protocol revenue accumulates in the treasury. There is no automatic buyback, burn, dividend, staking yield, token-holder revenue claim, or token/WETH liquidity route.

After Stage 3, the proposed monthly allocation is:

- 60% for product operations, security, infrastructure, legal work, taxes, and runway;
- up to 25% for disclosed, treasury-owned, two-sided token/WETH liquidity;
- up to 15% for measured distribution, user education, and capped onboarding support.

These are policy ceilings, not automatic contract routes. Unused budget remains in treasury. Liquidity spending pauses when operations or security reserves fall below their published minimum.

The treasury keeps the LP position; it is not burned or irreversibly locked by default. Treasury reports must distinguish:

- product fees received;
- tokens purchased, if any, and realized execution price;
- treasury tokens paired rather than purchased;
- WETH contributed;
- LP positions, fees, withdrawals, and realized divergence;
- operating and distribution spending.

Calling liquidity provision a buyback is inaccurate unless the treasury actually buys tokens on the market. No public communication may imply that 25% of revenue produces 25% of equivalent token-buying pressure.

## Sleeve activation gates

Launching the token does not add it to the index. Stage 3 requires all of the following:

- a reviewed token contract with immutable or tightly constrained owner powers;
- verified source and public supply, allocation, vesting, and treasury disclosures;
- at least 30 days of live token-market history;
- at least $250,000 of usable onchain liquidity;
- at least $100,000 of genuine rolling seven-day volume;
- execution capacity for the proposed index order without exceeding 1% of usable pool depth;
- no unresolved transfer restrictions, blacklist powers, tax mechanics, mutable supply, or concentration risk;
- an independent legal review of the token, index inclusion, related-party disclosure, treasury policy, and marketing copy;
- a product release that shows the sleeve target, current weight, band, realized slippage, last review, next review, and any pause reason.

No wash trading, treasury self-trading, circular volume, or undisclosed volume incentives count toward these gates.

## Rebalance execution

- Trade only after the observed weight closes outside the active sleeve's band.
- Return toward the active target using time-weighted orders.
- Cap a day's index order at the lower of 1% of usable pool depth or 10% of genuine average daily volume.
- Enforce a 24-hour cooldown between index-directed trades.
- Pause rather than force a rebalance when slippage, oracle quality, market integrity, or liquidity is outside policy.
- Redemptions unwind the sleeve proportionally even when ordinary rebalancing is paused, unless execution cannot be performed safely.
- Publish the target, band, last review, next review, realized slippage, and pause reason.

The curator can pause or remove the sleeve for a security failure, broken market, or insufficient liquidity. It cannot add the sleeve, restore it, increase its weight, or trade to defend its price.

## Token launch sequence

1. Complete the Stage 1 go/no-go record.
2. Finalize name, ticker, supply, allocations, vesting, contract controls, risk disclosure, jurisdictions, and launch mode.
3. Keep the dedicated creator address as the only launch signer; do not use it for ordinary product operations.
4. Verify the creator/treasury address and recovery path before material value is present.
5. Review the current Pools or alternative launch-provider terms using the connected transaction as the source of truth.
6. Simulate and independently review creation, initial liquidity, recipient wallets, creator permissions, and vesting contracts.
7. Launch without index inclusion and record the confirmed contract and pool addresses.
8. Verify source, bytecode, supply, holders, owner powers, pool, and usable liquidity from independent chain data.
9. Publish the canonical contract and disclosures, then collect at least 30 days of market evidence.
10. Activate the 5% sleeve only after every gate passes and the required product code has shipped.

## Public communication

Before the token exists, Wizzy may explain the application and publish risk education without implying that a token is scheduled. After onchain verification, pin one canonical token post containing the contract address, chain, pool, supply disclosure, treasury links, related-party sleeve status, and anti-scam warning.

Never describe the flywheel as guaranteed demand, price support, revenue sharing, yield, or a floor. Never announce a contract address obtained only from an unconfirmed creation screen.

The Wizzy token is a related-party asset. Public disclosures must state that the operator controls the product treasury, may hold tokens, controls whether to propose sleeve activation, and may provide or withdraw disclosed treasury-owned liquidity under policy.

## Regulatory review scope

This plan is an operating decision, not a legal conclusion. The independent review must use the law and product facts current at the time of each later stage, including:

- the [FCA cryptoasset financial-promotion regime](https://www.fca.org.uk/publications/fg23-3-finalised-non-handbook-guidance-cryptoasset-financial-promotions), which covers websites, apps, and social communications capable of affecting UK consumers;
- the UK cryptoasset regime scheduled to come into force on 25 October 2027, including public-offer, dealing, arranging, conflict, disclosure, and market-abuse questions ([official impact assessment](https://www.legislation.gov.uk/uksi/2026/102/pdfs/uksiod_20260102_en_001.pdf));
- [MiCA Article 4](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-4-offers-public-crypto-assets-other) for any EU offer or intended admission to trading;
- the fact-specific US analysis described in the [SEC staff statement on meme coins](https://www.sec.gov/newsroom/speeches-statements/staff-statement-meme-coins), which does not cover every product labeled a meme coin and has no legal force by itself.

A disclaimer does not replace a lawful promotion route, required disclosures, product controls, or jurisdictional restrictions.

## Evidence and abort conditions

The token launch record must contain the go/no-go decision, legal review, transaction simulation, deployed contract and pool, verified bytecode, supply and holder snapshot, vesting addresses, treasury and creator addresses, and initial liquidity.

The sleeve activation record must additionally contain 30 days of genuine market history, volume and depth evidence, concentration analysis, expected and simulated index orders, the treasury policy, conflict disclosures, and the exact product commit that activates the sleeve.

Abort or pause on any unexpected owner power, tax, mint authority, recipient, liquidity lock, contract mismatch, misleading social account, concentrated undisclosed holder, abnormal volume, missing disclosure, or inability to keep the sleeve within execution limits.

## Open decisions

- token name and ticker;
- launch provider and launch mode;
- total supply, team and community allocations, and vesting;
- the token's community or product role beyond being a disclosed index sleeve;
- the official X handle and launch communications;
- the minimum operating and security reserve that must be funded before liquidity spending;
- whether protocol revenue ever accrues to token holders. No value-accrual claim may be made until it is implemented and independently reviewed.

Public-identity separation and the two distinct launch checklists are defined in [Launch privacy](LAUNCH_PRIVACY.md). Ordinary constituent selection is defined in [Index curation](CURATION.md).
