# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web.

## Users

Wizzy is for crypto-native people who want to earn pool fees without managing swaps, ranges, routers, or position math by hand. They understand wallets, fees, and withdrawals. Wizzy handles the LP mechanics.

## Purpose

Wizzy makes meme-market liquidity feel as simple as a swap. Connect an external EOA, choose a reviewed market on Base or Robinhood Chain, enter one ETH amount, review the costs, and approve the plan in the wallet. The wallet owns every LP position. Wizzy never creates an embedded wallet, holds a key, or signs for the user.

## Product model

- Base and Robinhood Chain are equal product surfaces. Neither is a legacy or secondary network.
- The main action is "Make market." One amount becomes the token swap, approvals, liquidity position, gas reserve, and disclosed Wizzy fee.
- The portfolio reads the connected EOA on both chains and groups positions by market and protocol.
- Collect, rebalance, and withdraw are direct wallet-approved actions. Scheduled agents may monitor and recommend, but cannot sign or broadcast.
- The version-controlled catalog decides which markets Wizzy promotes. Onchain positions remain readable even when a market is paused or removed from the catalog.
- Public state, wallet ownership, chain events, and versioned policy are authoritative. Do not invent a parallel custody ledger.

## Protocol requirement

The finished product must support Uniswap-style V2, V3, and V4 positions on both chains wherever the required canonical deployments exist. That means creation, discovery, fee collection, liquidity changes, range management where applicable, and full withdrawal. Protocol differences belong in the planner and position detail, not in three separate products.

Current support includes reviewed creation routes, position discovery, and wallet action plans for V2, V3, and V4 on both chains. V2 fees stay inside the LP token, so there is no separate collect or compound action; withdrawal realizes the position. Pool availability still depends on the reviewed catalog, and every transaction remains subject to user review and wallet approval.

## Curation

The curator ranks meme pools using live liquidity, volume, fee generation, age, token and pool integrity, price concentration, holder risk, and execution viability. Every inclusion needs evidence. A market moves to review when its data deteriorates and pauses immediately for a security failure or liquidity collapse.

The curator can change the catalog through the tested Git release path. It cannot move user funds, approve a transaction, or override deterministic pool and target validation.

## Money

Wizzy charges 0.15% when liquidity is added, withdrawn, or rebalanced, and 2% of fees when they are compounded. Show the Wizzy fee, network cost, bridge cost, and DEX impact before wallet approval. Never describe fee APR as guaranteed yield.

## Brand

- Product: Wizzy.
- Category: the meme market maker.
- Primary action: Make market.
- Voice: playful, direct, and financially literate.
- UI: Uniswap-style simplicity with stronger curation, position charts, and liquidity management.
- Complexity stays behind the review state. Risk, variable costs, self-custody, and wallet approvals stay visible.

## Product rules

1. The connected EOA is the only consumer signer.
2. One view covers Base and Robinhood Chain.
3. One primary action per state.
4. Consumer language first; protocol detail on demand.
5. Fee APR is a trailing rate, not APY or a promise.
6. Users can always inspect, collect from, and withdraw supported positions they own.
7. No token launch or buyback claim without a separate explicit release.

## Evidence and limits

- The repository has Base and Robinhood chain definitions, V2/V3/V4 creation planners, position readers and action calldata, Aerodrome support, Relay funding, fee logic, curation policy, and wallet-plan tests.
- Market statistics and imagery come from onchain reads and GeckoTerminal. Fomo is a discovery link, not a liquidity venue or endorsement.
- There is no audited proprietary liquidity contract, verified performance history, legal opinion, or third-party endorsement. Do not imply otherwise.

## Accessibility

Support keyboard navigation, visible focus, reduced motion, readable contrast, mobile use, 200% zoom, and plain-language explanations alongside protocol detail.
