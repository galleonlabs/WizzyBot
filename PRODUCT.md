# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Una is for crypto-native users who want to put idle capital to work as a liquidity provider across leading meme markets without manually selecting pools, calculating ranges, or managing each position one at a time.

## Product Purpose

Una is self-custodial portfolio-management software for meme liquidity. A user signs in with Privy, chooses Base, Robinhood Chain, or both, funds a curated portfolio, and can later monitor, compound, rebalance, or withdraw it from one coherent interface. Success means the user can understand what they own, why each position exists, what it has earned, what risks it carries, and execute the intended portfolio action in the fewest safe wallet confirmations the protocols allow.

## Positioning

Una is the “market maker of memes”: a consumer-accessible portfolio layer that turns a curated set of meme liquidity pools into an understandable, ownable, and manageable onchain portfolio. The internal ambition is to become the “Wintermute of memes” or “Wintermeme”; public copy must not imply affiliation with Wintermute, Robinhood, or Uniswap.

## Operating Context

- Users authenticate with the existing Una Privy app and retain control of their embedded or connected EVM wallet.
- Users select Base, Robinhood Chain, or both, then choose or accept an allocation across curated meme LPs.
- Portfolio actions include deposit/allocation, withdraw, compound, and later policy-driven automation with explicit user control.
- Positions and portfolio state should be derived from wallets, LP tokens or NFTs, chain events, and live market data. Avoid a database where onchain or version-controlled state is authoritative.
- Una may use agents and AI to explain choices, surface risks, recommend actions, and prepare transaction plans. Deterministic transaction and risk rules remain authoritative.

## Capabilities and Constraints

- Support Base (chain ID 8453) and Robinhood Chain (chain ID 4663).
- Support the Uniswap v2, v3, and v4 LP paths already implemented where the selected chain and allowlisted pool support them.
- Keep a curated, operator-controlled asset and pool allowlist easy to review and change in version control.
- Minimize approvals and wallet confirmations through permit and multicall or batch-capable protocol paths where safely available; show the exact transaction plan before signing.
- Users hold their position NFT or LP token and remain in control of funds. Una is not a custodian or discretionary asset manager.
- Show position-level and portfolio-level value, fees, APR, range state, performance versus holding, impermanent loss, chain allocation, and risk context without inventing returns.
- Projections and gamification must be clearly labeled, use defensible inputs, and never present uncertain returns as guaranteed.
- Una's launch fee schedule is 0.15% of allocations, withdrawals, and rebalances, plus 2% of fees compounded. Fees are explicit transfers inside the reviewed wallet batch; Relay and DEX fees are shown separately.
- The launch set is versioned in `src/config/markets.json`: TOSHI, BRETT, DEGEN, and BASECAT on Base, plus CASHCAT on Robinhood Chain. Pool addresses, weights, ranges, status, and risk labels are code-reviewed configuration.
- A one-chain allocation uses one atomic wallet batch. A both-chain allocation starts from Base, combines the Base allocation with a Relay deposit, then requests a second Robinhood Chain batch after the intent fills. Do not advertise a one-confirmation cross-chain path until production smart-account and sponsorship behavior is proven.
- Do not imply endorsement by Robinhood, Uniswap, Privy, Wintermute, or any listed token project.

## Brand Commitments

- Product name: Una.
- Category claim: “The market maker of memes.”
- Personality: bullish, sharp, playful, and financially literate without becoming reckless or juvenile.
- Make complex LP mechanics feel legible and rewarding while keeping risk and custody facts explicit.
- Existing product truth to preserve: dry-run first, explicit confirmation for writes, and user ownership of the NFT or LP token.

## Evidence on Hand

- The repository contains working Base and Robinhood chain definitions, Uniswap v2/v3/v4 planning and calldata, Privy authentication/signing, treasury fee logic, position hydration and economics, agent tools, tests, and a production Vercel app.
- Existing research in `docs/research/` covers product behavior, Bankr, Uniswap LP APIs, and adjacent automation.
- No audited proprietary contracts, verified performance history, testimonials, legal opinion, or third-party endorsements are present. Future work must not fabricate them.

## Product Principles

1. Self-custody is visible, not buried: the user owns positions and approves every material action.
2. Portfolio first: users think in goals and allocations; Una handles the per-pool mechanics transparently.
3. Onchain by default: derive state from public, inspectable sources and keep configuration reviewable.
4. Bullish does not mean blind: make upside legible while quantifying range, liquidity, contract, and divergence risk.
5. AI advises and orchestrates; deterministic policy, simulation, and user consent govern execution.
6. Trailing data stays trailing: recent fee pace, young-position annualization, and scenario projections are visibly distinguished from realized returns.

## Accessibility & Inclusion

The web product must support keyboard navigation, visible focus, reduced motion, readable numerical contrast, responsive mobile use, and plain-language explanations alongside protocol terminology.
