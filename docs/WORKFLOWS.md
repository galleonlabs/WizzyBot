# Choose a DeFi workflow

Boomkin's packs are independently installed and loaded as needed. Run `bun run boomkin catalog` for the exact reviewed versions and available skill names. A workflow can use an existing official provider tool; no all-provider connection step is required.

[Onboarding](../README.md#get-started) · [Connections](CONNECTIONS.md) · [Pack selection](UPDATES.md#select-your-packs)

| Task | Start with | Expected output |
| --- | --- | --- |
| Establish available RPC, data and wallet tools | `galleon-defi-infra`, `galleon-defi-data` | Observed capabilities, identity, freshness and missing access |
| Assess a liquidity position | `lp-setup`, `lp-analyze` | Position and pool evidence, constraints and an unsigned plan when requested |
| Review a Hyperliquid account | `hyperliquid-setup`, `hyperliquid-monitor` | Reconciled account state and venue-specific risk |
| Compare lending markets or repay debt | `galleon-defi-lending` | Collateral/debt evidence, rates, liquidation constraints and plan |
| Understand staking or restaking exits | `galleon-defi-staking` | Receipt ownership, slash/withdrawal conditions and queue state |
| Assess a vault or tokenized yield product | `galleon-defi-yield`, `galleon-defi-tokenized-assets` as relevant | Yield source, claim structure, eligibility and redemption constraints |
| Move capital across venues/chains | `galleon-defi-routing` | Fresh quote, total costs, dependencies and settlement checks |
| Assess derivative exposure | `galleon-defi-derivatives` | Margin, notional, liquidation/funding and venue constraints |
| Explain holdings and performance | `galleon-defi-portfolio` | Gross assets, debt, net equity, flows and coverage gaps |
| Investigate an EVM token or changes since a prior review | `galleon-defi-security-token-diligence` | Pinned identity, control and launch evidence, liquidity/exit constraints and coverage changes |
| Review a transaction or typed signature | `galleon-defi-security` | Exact asset/authority changes, simulation evidence and unknowns |
| Evaluate a paid agent service | `galleon-defi-payments` | Payment challenge, spending limits and settlement/delivery evidence |
| Review a governance proposal | `galleon-defi-governance` | Proposal content, voting/delegation rights and execution stage |

## First report

> Use galleon-defi-portfolio to report the holdings and debt for these accounts and chains: [scope]. Use existing read tools and identify missing coverage. Separate external deposits from investment performance. Keep all proposed changes unsigned.

A portfolio total should not count a receipt token and its underlying claim twice. A price mark does not establish an executable exit. Missing prices, private-account access and unsupported protocols remain visible gaps.

## A focused lending setup

```bash
bun run boomkin onboard --directory "$HOME/boomkin-lending" \
  --pack defi-infra-skills --pack defi-data-skills \
  --pack defi-lending-skills --pack defi-security-skills
```

> Use galleon-defi-lending to compare the specified markets for [asset and chain]. Show collateral rules, current debt costs, withdrawal constraints and source times. Use galleon-defi-security to review any proposed approval or transaction before I decide whether to authorize it.

## From plan to execution

Research, reports, quotes and unsigned plans do not authorize trades or payments. A separately authorized execution workflow must bind the exact account, chain, assets, counterparties, limits and current payload to that authority. Re-quote and review changed proposals; reconcile actual receipts afterward. A simulation, source-chain receipt or collected Safe signatures alone do not prove the intended outcome.

For recurring work, ask Boomkin to use native Hermes scheduling with your chosen scope and delivery destination. Pack installation itself starts no monitor or background service.

## Token diligence and repeat reviews

> Use galleon-defi-security-token-diligence to investigate [token address] on chain [ID]. Assess control rights, launch concentration, removable liquidity, a sell of [amount], and treasury claims. Use the existing provider connections and state what remains unknown.

For a follow-up, supply the previous structured report and ask what changed. The skill includes optional Bun helpers for a bounded RPC identity snapshot, evidence consistency checks and semantic comparison. Lost coverage or an omitted prior finding is not a resolved risk. Helpers do not sign or broadcast, and a validated report is not a safety certificate.

The Security pack installs both token diligence and transaction review. Token diligence can also be installed independently through the monorepo's skills installer; the full pack is not required.
