# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Una is for crypto-native consumers who want to earn meme-market trading fees without becoming LP technicians. They understand deposits, fees, positions, and withdrawals. Una owns the pool selection, chain routing, asset balancing, liquidity ranges, gas reserves, and rebalancing mechanics.

## Product Purpose

Una is the one-click market maker for memes. The MVP is one ranked, versioned Robinhood Chain index. A user signs in with Privy, chooses where their ETH is coming from, enters one amount, and Una opens every market that amount supports. The user owns every resulting position in their Privy-controlled wallet and can monitor fees or withdraw without learning concentrated-liquidity mechanics.

## Positioning

Una turns “be the market maker” into a consumer action. It should feel as direct as a swap: one index, one amount, one primary action. The internal ambition is the “Wintermute of memes” or “Wintermeme”; public copy must not imply affiliation with Wintermute, Robinhood, Uniswap, Meteora, Privy, Relay, or any listed token project.

## Operating Context

- Privy creates and manages the user's self-custodial EVM and Solana wallets under one identity.
- There is no public allocation builder, destination-network selector, pool selector, range editor, bridge picker, or portfolio-split control. “Pay from” is a checkout choice only: Relay moves ETH from a supported source network into the single Robinhood Chain product.
- Una publishes one Robinhood index at launch. Each viable 0.05 ETH unit adds the next curator-ranked market, up to the full six-market index; users never choose the count or allocation.
- Initial inclusion requires at least 30 days of pool history, at least $75,000 in live liquidity, a WETH quote, and a verified Uniswap v3 execution path. An active market that later crosses a monitoring threshold moves to review; security failures or a liquidity collapse trigger a pause recommendation. Pool status and weights remain code-reviewed curator policy.
- Relay moves ETH from the selected supported source network to Robinhood Chain. Una selects the reviewed pool and liquidity range for every market.
- The product vocabulary is deposit, earn fees, your liquidity, collect, and withdraw. Protocol mechanics belong in receipts and disclosures, not the primary action.
- Portfolio state should be derived from wallets, LP positions, chain events, and live market data. Avoid a database where onchain or version-controlled state is authoritative.
- “Markets” is the single home for current positions and the live Robinhood index. Existing Base and Solana positions remain readable and withdrawable without promoting those networks in the launch product.
- The agent is internal index machinery: it scouts inclusion candidates, monitors pool risk, and helps operators review allocation and range policy. It is not a public chat or transaction surface. Deterministic transaction and risk rules remain authoritative.

## Capabilities and Constraints

- Launch one network-specific index on Robinhood Chain (chain ID 4663). Keep the existing Base, Robinhood, and Solana engines intact for later per-network products; do not present a blended multi-chain index in the MVP.
- Maintain an operator-controlled, code-reviewed allowlist for every asset and pool.
- The active launch set is CASHCAT, PONS, AI, CHUMP, STONKBROKER, and PONSGUY against WETH on reviewed Uniswap v3 pools.
- Base uses reviewed Uniswap v3 and Aerodrome Slipstream pools; Solana uses Meteora DLMM. Those engines and paused markets remain readable and withdrawable for later network-specific launches.
- Minimize approvals and confirmations with wallet batching, Relay, Privy embedded wallets, and direct single-token liquidity zaps. Never claim one cryptographic signature when destination networks require additional approvals.
- The consumer initiates one Una action. The review state explains that Privy will request the network approvals needed to preserve self-custody.
- The launch fee is 0.15% of deposits, withdrawals, and rebalances, plus 2% of fees compounded. Show Una, Relay, network, and DEX costs in the relevant review or receipt before approval, not as idle-page positioning.
- Never invent yield. Show “Fee APR” as a simple annualization of the trailing 24-hour pool-fee pace. Use “APY” only when an actual auto-compound policy is active and the calculation accounts for compounding frequency, gas, and product fees.
- Manual compounding remains a direct, wallet-approved position action. Do not expose manual or automatic rebalancing until the consumer wallet path can safely build and execute it across the supported venue.
- Users own the EVM LP NFTs and Solana DLMM positions. Una is not a custodian or discretionary asset manager.

## Brand Commitments

- Product name: Una.
- Category claim: “The meme market maker” and “one-click market maker for memes.”
- Primary action: “Make markets.”
- Personality: bullish, direct, and financially literate without becoming reckless or juvenile.
- Complexity is absorbed by the product, not pushed onto the consumer.
- Risk, variable fees, self-custody, and wallet approvals stay explicit.

## Product Principles

1. One product, not a toolkit: one Robinhood index, one amount, one action. Deposit size changes the number of markets without exposing a builder.
2. Consumer language first: deposit, earn fees, collect, withdraw.
3. Self-custody stays honest: the user owns positions and approves required wallet actions.
4. Onchain by default: public state and version-controlled policy are authoritative.
5. Fee APR stays precise: it is annualized trailing pool fees, not APY or a promised return.
6. Technical detail appears on demand, never as a prerequisite for participation.

## Evidence on Hand

- The repository contains Base and Robinhood definitions, Uniswap and Aerodrome Slipstream planning and calldata, Privy authentication/signing, Relay routing, treasury fee logic, position hydration, agent tools, and tests.
- Robinhood launch statistics and token imagery come from GeckoTerminal's keyless onchain pool API; each market exposes its pool page and a Uniswap trade deep link. Fomo is a discovery surface, not a liquidity venue or product endorsement.
- The Solana path uses Privy Solana wallets, Relay native SOL delivery, and Meteora's maintained DLMM zap SDK.
- No audited proprietary contracts, verified performance history, testimonials, legal opinion, or third-party endorsements are present. Future work must not fabricate them.

## Accessibility & Inclusion

The web product must support keyboard navigation, visible focus, reduced motion, readable numerical contrast, responsive mobile use, and plain-language explanations alongside optional protocol detail.
