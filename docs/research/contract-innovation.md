# Contract-level innovation for Wizzy — open-source survey (2026-09-01, v2)

Exercise: what could Wizzy build at the contract layer that a UI-over-Morpho cannot claim? This version is grounded in a survey of the actual open-source landscape rather than memory. The survey changed the recommendation.

## 1. Security records, honestly

The prompt's reference point cuts the other way: **Harvest Finance lost ~$24M in October 2020** to a flash-loan curve-price manipulation of its stablecoin vaults. Yearn v1's DAI vault (~$11M, 2021), Compound's distribution bug (~$80M, 2021), Euler v1 (~$197M, 2023, recovered), and Curve's Vyper reentrancy (2023) round out the lesson: **strategy zoos and complex cores are the attack surface; tiny immutable cores (Uniswap, Morpho Blue, Maker's savings core) are the clean ones.**

## 2. The vault-framework landscape (verified)

| Framework | License | What it is | Relevant facts |
| --- | --- | --- | --- |
| **Morpho Vaults V2** ([repo](https://github.com/morpho-org/vaults-v2)) | GPL-2.0-or-later | Curated 4626 meta-vault | Roles: owner / curator / allocator / **sentinel** (rapid de-risk). **Id-based absolute + relative caps**, timelockable config, **in-kind redemptions + permissionless `forceDeallocate`**, adapters including a **Morpho Vault V1 adapter** — i.e. it can allocate across the exact four vaults our index holds today. Audits in-repo. |
| **BoringVault / Veda** ([Se7en-Seas repo](https://github.com/Se7en-Seas/boring-vault), [architecture](https://docs.veda.tech/architecture-and-flow-of-funds)) | check repo (unstated in docs) | The ether.fi Liquid stack; widely forked (Paxos et al.) | **ManagerWithMerkleVerification**: every action a strategist may take is a leaf in a merkle tree (target, selector, sanitized args). Call-space whitelisting — the strategist literally cannot construct an unapproved call. Teller/Accountant split for deposits and share pricing. |
| **Yearn V3 Tokenized Strategy** ([repo](https://github.com/yearn/tokenized-strategy), [docs](https://docs.yearn.fi/developers/v3/overview)) | AGPL-3.0 | Single-strategy 4626 framework via immutable proxy | Purpose-built for third parties to ship strategies; clean V3 record; AGPL is viral for closed forks. |
| **Lagoon (Hopper Labs)** ([repo](https://github.com/hopperlabsxyz/lagoon-v0), [Nethermind review](https://www.nethermind.io/blog/securing-lagoons-asynchronous-erc-7540-vaults-as-the-protocol-scaled-from-v1-to-v5)) | check repo | ERC-7540 async vault infra for curators | ~$129M TVL across 120+ vaults, 18+ chains; curator-approved NAV settlement; the institutional async pattern. |
| **Euler Vault Kit** ([docs](https://docs.euler.finance/creator-tools/vaults/evk/introduction/), [OZ audit](https://www.openzeppelin.com/news/euler-vault-kit-evk-audit)) | see repo | Credit-vault construction kit | For building lending markets — adjacent, not our lane. |
| **Brahma ConsoleKit** ([repo](https://github.com/Brahma-fi/console-kit)) | open SDK | Agent execution platform on Safe sub-accounts | Modular **policy engine at the smart-account level**: each sub-account governed by a policy defining permitted actions; orchestration/simulation offchain. |

## 3. The agent-yield wave (what we would be differentiating against)

Per the [Cambrian Q1 2026 agentic-finance landscape](https://www.cambrian.org/blog/agentic-finance-landscape-q1-2026): **20+ yield agents live**, mostly rule-based, per-user smart accounts, guardrails asserted offchain. [Giza's ARMA](https://finbold.com/gizas-autonomous-yield-optimization-agent-arma-goes-live-on-the-base-network/) optimizes $30M+ of stablecoins on Base across lending venues; [Axal ships "Autopilot Yield + Guardrails"](https://axal.substack.com/p/introducing-autopilot-yield-guardrails); Kamino, Lulo, Superform automate adjacent lanes. Two consistent gaps in the reporting: **guardrails are marketing language, not verifiable contract invariants**, and institutional writers ([RockawayX 2026 vault guide](https://www.rockawayx.com/insights/defi-vaults-explained-2026-guide)) name auditability as the adoption blocker. The market pull for a *verifiable* leash is real.

## 4. Honest revision: most of the "policy leash" already exists

The first draft of this document proposed a policy-enforced vault with caps, drift limits, and timelocks. The survey shows **Morpho Vaults V2 already ships most of that**: absolute/relative caps, timelocked config, a sentinel role for rapid de-risk, and forced deallocation for exits. BoringVault solves the call-space version. Brahma solves the account-level version. Forking any of them to rebuild caps would be redundant work with a worse security story.

What genuinely does not exist anywhere in the survey:

1. **A deterministic sentinel.** In every framework the sentinel/guardian is a trusted human or multisig. Nobody has shipped a sentinel whose alarm conditions are *code*: permissionless `derisk()` callable by anyone when an onchain-checkable predicate holds — venue TVL collapse (checkpointed `totalAssets` deltas), underlying depeg (oracle bound), cap breach persistence.
2. **An allocator dead-man's switch.** No framework distinguishes "the agent chose this allocation" from "the agent stopped showing up." A heartbeat the allocator must refresh, with expiry making de-risk permissionless, converts agent liveness into a verifiable property.
3. **Rate-limited allocation drift.** V2 caps bound *where* funds sit, not *how fast* they move. A max-drift-per-epoch wrapper bounds a compromised or hallucinating agent's damage radius.

## 5. Revised recommendation: don't fork a vault — build the missing roles

Deploy a standard **Morpho Vaults V2** vault (GPL, audited, adapters already reach our four venues) and write two small original contracts that hold its roles:

- **PolicySentinel** — holds the sentinel role. Encodes the dappnode curator's gates (TVL floor, collapse rate, depeg bound, heartbeat expiry) as onchain predicates with permissionless triggers. *Anyone can pull the alarm; the alarm conditions are law.* This is the leash-made-visible, in a few hundred auditable lines.
- **PolicyAllocator** — holds the allocator role, wraps the dappnode agent key with per-epoch drift limits and the heartbeat the sentinel watches.

The dappnode curator loop stays exactly what it is — but its gates compile into contract predicates, and its authority becomes inspectable. The pitch survives from v1, sharpened: *the first vault where the AI's leash is not a promise but a predicate.* Deposit-seconds (the loyalty primitive feeding the [token flywheel](morpho-curator-and-token.md)) survives unchanged as the second, weekend-sized build.

Effort estimate: PolicySentinel + PolicyAllocator ≈ 300–600 lines of Solidity total plus tests and one audit pass — an order of magnitude smaller than any vault fork, on top of the most-audited curated-vault core in the category.
