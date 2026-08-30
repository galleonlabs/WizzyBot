# Virtuals option research — not the current token plan

Last verified: 29 Aug 2026.

Sources (official):

- Capital Formation Layer: https://whitepaper.virtuals.io/about-virtuals/capital-formation-layer
- Builder / launch FAQ (as of 14 Aug 2026): https://whitepaper.virtuals.io/info-hub/virtuals-builder-and-agent-token-launch-faq
- ACP overview: https://os.virtuals.io/acp/overview
- ACP CLI: https://github.com/Virtual-Protocol/acp-cli
- Older IAO page (historical split; superseded for the 70/30 figure): https://whitepaper.virtuals.io/about-virtuals-1/the-protocol/virtual-agents-as-programmable-decentralized-entities/initial-agent-offering-iao-for-ai-agent-token-launches

A Virtuals token is **not part of the initial Wizzy application release**, and Virtuals is not the selected launch provider. This file preserves provider-specific research only. Any token decision must first pass [the token and index plan](../TOKEN_FLYWHEEL.md); do not execute the steps below merely because they are documented.

## 1. What a tokenized agent is

Virtuals Launchpad turns an agent into a financeable on-chain asset: bonding curve in VIRTUAL, then a Uniswap v2 pool, with a 1% trading tax and a 10-year LP lock. Universal infrastructure (Capital Formation Layer, these apply to every launch):

- Free to create an agent, except some modules (Capital Formation module 10 VIRTUAL; SOL launches 10 VIRTUAL)
- Bonding curve, paired with VIRTUAL
- Graduation at **42,000 VIRTUAL**
- Auto-migration to a **Uniswap v2** pool
- **1% trading fee, 70% creator / 30% Virtuals Treasury**
- **10-year LP token lock**

Optional modules (anti-sniper decaying tax, 60-day trial, Capital Formation, airdrop, fee delegation, existing-token import, pre-buy, robotics) are toggles. Do not turn them on unless a later launch brief says so.

## 2. Tax: 1%, 70 / 30

Current universal line, 29 Aug 2026: 1% trading fee (70% creator, 30% Virtuals Treasury). Fee Delegation docs use the same 70% as the creator share of trading fees.

**Historical (do not use for a new launch):** the older IAO page split post-graduation tax 30% creator / 20% affiliates / 50% Agent SubDAO, and sent 100% of pre-graduation tax to the protocol. That page is still on the whitepaper. The Capital Formation Layer + FAQ (updated Aug 2026) are the current source.

FAQ nuance: distribution is triggered when an agent token trading tax accumulates to >= 1 VIRTUAL. FAQ body also says the system then swaps it into USDC and distributes it to token owners — that sentence sits next to Tax Manager distributes fees directly in VIRTUAL to the creator and the platform. **speculation:** the USDC wording may describe a dashboard/claim path or a later hop; on-chain Tax Manager transfers observed on Basescan are in VIRTUAL. Confirm on the Tax Checker dashboard before promising a claim asset.

## 3. Graduation and lock

1. Create the agent on the Launchpad; trading opens on the bonding curve immediately.
2. At **42,000 VIRTUAL** of curve liquidity the agent graduates.
3. Protocol migrates into a Uniswap v2 pool paired with VIRTUAL.
4. LP tokens are staked/locked for **10 years**. Creator retains ownership of the staked LP but cannot withdraw the liquidity. FAQ: creator-owned but protocol-secured.
5. Older IAO text said the creator paid 100 VIRTUAL to open the curve and graduated near 41.6k. Current page says most launches are free and graduation is 42,000. Use 42,000 / free-unless-module.

Anti-sniper (optional): dynamic tax starting at 99%, decaying to 1% over a chosen window, buys and/or sells.

## 4. Tax Manager and related contracts (Base)

From the official FAQ Trace Through Contracts:

| Role | Address |
| --- | --- |
| Tax Swapper | 0x8e0253dA409Faf5918FE2A15979fd878F4495D0E |
| Tax Manager | 0x7e26173192d72fd6d75a759f888d61c2cdbb64b1 |

Checksum commonly written 0x7E26173192D72fd6D75A759F888d61c2cdbB64B1. Basescan labels this Virtuals Protocol: Tax Manager.

Flow: taxed agent-token trades -> Tax Swapper -> swapped to VIRTUAL -> Tax Manager -> creator + platform.

VIRTUAL token on Base (widely labeled, FAQ-adjacent): 0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b. Confirm on Basescan / the official token list before a launch tx; it is not printed as a hex on the Capital Formation page.

Solana (not v1): tax goes from the agent wallet to the creator distribution wallet; fallback LP fee wallet 9WBoFXeAbskmi6aMK5jvyNgXVKeZrcVeFJtDBLikzdnm.

## 5. ACP path (after the token exists)

Agent Commerce Protocol is Virtuals agent-to-agent commerce layer, reference implementation of ERC-8183. Current ACP (EconomyOS):

- Hooks (beforeAction / afterAction), event-driven (agent.on entry handler)
- Non-custodial signer (OS keychain via CLI, or Privy via SDK)
- Identity = wallet + Agent Card + Agent email + optional token
- Job types: service, fund transfer, subscription
- Packages: @virtuals-protocol/acp-node-v2, @virtuals-protocol/acp-cli
- Docs: https://os.virtuals.io/acp/overview

Typical CLI path (Privy / acp-cli docs): acp configure (browser OAuth, token in OS keychain); acp agent create; acp agent add-signer (needed before any signed on-chain action); acp wallet address --json.

ACP is how a tokenized UnaBot would sell work (range advice, keeper-as-a-service) to other agents. It is not how v1 manages Uniswap NFTs. Do not wire ACP into the keeper.

## 6. Hypothetical Virtuals path — only if selected later

Goal: if/when UnaBot is tokenized, creator-fee 70% lands in the product treasury, not in a personal hot wallet.

Treasury (product constant): 0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42

Concrete steps (Launchpad + FAQ; no invented URLs):

1. Decide the launch is a later step. Do not put a token address in this repo until it exists on-chain.
2. Use a treasury-controlled wallet at https://app.virtuals.io — the same 0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42 (or a dedicated launch signer whose Fee Delegation identity is that address).
3. Create the agent. Toggle only the modules the launch brief names. Default recommendation: no Capital Formation module (avoids the 10 VIRTUAL fee and the 25% team-stack / staged-sell machinery) unless fundraising is the point.
4. If someone other than treasury clicks Launch, use Fee Delegation: launcher identifies the builder by wallet 0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42. The 70% creator share accrues to that identity; the launcher cannot claim it. Treasury then verifies the linked profile and claims.
5. Publish. Trading opens on the VIRTUAL bonding curve. Do not pre-announce a CA before the tx confirms.
6. Watch the curve through 42,000 VIRTUAL. On graduation, confirm the Uniswap v2 pair and that LP is locked/staked (FAQ: staked LP is transferred back to the creator wallet but cannot be withdrawn for 10 years).
7. Confirm Tax Manager (0x7e26173192d72fd6d75a759f888d61c2cdbb64b1) is routing the 70% leg to treasury via the Tax Checker dashboard.
8. Vested-token claims (if any module created them) are manual at app.virtuals.io — they are not auto-sent.
9. Only after the token exists: optional ACP identity for the agent, with wallet policies allowlisting treasury and the Uniswap contracts. ACP signer keys stay in the OS keychain / Privy, not in UNABOT_PRIVATE_KEY.

Do not point a Virtuals creator field at an EOA that also holds user LP NFTs.

## 7. Open items

- Confirm VIRTUAL token address from an official Virtuals deployments page at launch time.
- Confirm claim asset (VIRTUAL vs USDC) against the Tax Checker the week of launch.
- Older 30/20/50 split is still on the IAO page — screenshot the Capital Formation 70/30 line into the launch folder when we execute.
