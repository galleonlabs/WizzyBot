# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Una is for crypto-native consumers who want to earn meme-market trading fees without becoming LP technicians. They understand deposits, fees, positions, and withdrawals. Una owns the pool selection, chain routing, asset balancing, liquidity ranges, gas reserves, and rebalancing mechanics.

## Product Purpose

Una is the one-click market maker for memes. A user signs in with Privy, enters one ETH amount, and makes markets through one fixed, versioned index across Base, Robinhood Chain, and Solana. The user owns every resulting position in their Privy-controlled wallets and can monitor fees or withdraw without learning the machinery behind concentrated liquidity.

## Positioning

Una turns “be the market maker” into a consumer action. It should feel as direct as a swap: one index, one amount, one primary action. The internal ambition is the “Wintermute of memes” or “Wintermeme”; public copy must not imply affiliation with Wintermute, Robinhood, Uniswap, Meteora, Privy, Relay, or any listed token project.

## Operating Context

- Privy creates and manages the user's self-custodial EVM and Solana wallets under one identity.
- There is no public allocation builder, chain selector, pool selector, range editor, bridge picker, or portfolio-split control.
- Una publishes one managed index. Its versioned chain and constituent weights are product policy, not user input.
- Relay moves the Base deposit to Robinhood Chain and Solana. Una selects reviewed Uniswap v3 or Aerodrome Slipstream concentrated-liquidity venues on EVM; Meteora DLMM zap paths create Solana positions.
- The product vocabulary is deposit, earn fees, your liquidity, collect, and withdraw. Protocol mechanics belong in receipts and disclosures, not the primary action.
- Portfolio state should be derived from wallets, LP positions, chain events, and live market data. Avoid a database where onchain or version-controlled state is authoritative.
- The agent is internal index machinery: it scouts inclusion candidates, monitors pool risk, and helps operators review allocation and range policy. It is not a public chat or transaction surface. Deterministic transaction and risk rules remain authoritative.

## Capabilities and Constraints

- Support Base (chain ID 8453), Robinhood Chain (chain ID 4663), and Solana mainnet (Relay chain ID 792703809) as one index.
- Maintain an operator-controlled, code-reviewed allowlist for every asset and pool.
- Use reviewed Uniswap v3 pools on Base and Robinhood Chain, Aerodrome Slipstream pools on Base, and Meteora DLMM pools on Solana. Venue selection is internal index policy, never a user-facing builder.
- The initial Solana set is FARTCOIN, USELESS, and PENGU against SOL, configured in `src/config/solana-markets.json`.
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

1. One product, not a toolkit: one index, one amount, one action.
2. Consumer language first: deposit, earn fees, collect, withdraw.
3. Self-custody stays honest: the user owns positions and approves required wallet actions.
4. Onchain by default: public state and version-controlled policy are authoritative.
5. Fee APR stays precise: it is annualized trailing pool fees, not APY or a promised return.
6. Technical detail appears on demand, never as a prerequisite for participation.

## Evidence on Hand

- The repository contains Base and Robinhood definitions, Uniswap and Aerodrome Slipstream planning and calldata, Privy authentication/signing, Relay routing, treasury fee logic, position hydration, agent tools, and tests.
- The Solana path uses Privy Solana wallets, Relay native SOL delivery, and Meteora's maintained DLMM zap SDK.
- No audited proprietary contracts, verified performance history, testimonials, legal opinion, or third-party endorsements are present. Future work must not fabricate them.

## Accessibility & Inclusion

The web product must support keyboard navigation, visible focus, reduced motion, readable numerical contrast, responsive mobile use, and plain-language explanations alongside optional protocol detail.
