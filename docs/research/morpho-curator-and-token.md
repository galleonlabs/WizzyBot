# Becoming a Morpho curator, and where a token fits (2026-09-01)

Two strategy questions, one answer: the index-of-vaults shipped on 2026-08-31 is the v0 interface; the natural v1 is a **Wizzy-curated Morpho vault**, and the token attaches to the loyalty and revenue layer — never to the deposit assets.

## Part 1 — run our own vault instead of indexing others

### What "being a curator" means

Morpho vault deployment is permissionless. A vault has an owner, a curator (approves markets/venues and caps, behind a timelock), an allocator (moves liquidity between approved venues — bounded authority, cannot withdraw user funds), and a guardian/sentinel (veto). The vault takes a performance fee on interest (protocol-capped) to a fee recipient. Morpho Vaults V2 additionally allocates through adapters into Morpho V1 **vaults** as well as markets — meaning a Wizzy vault can allocate across the exact four venues the index already holds (Gauntlet Prime, Spark, Steakhouse, Grove). Verify current V2 factory/adapters on Base before building; the strategic picture does not change between V1.1 and V2, only the plumbing.

### Why this is better than what we shipped

| | Today: index of vaults | Wizzy-curated vault |
| --- | --- | --- |
| User position | 4 share balances | 1 vault token (ERC-4626) |
| Revenue | None | Recurring performance fee on yield (aligned: we earn only when users earn) |
| Rebalancing | User-signed batches | Allocator reallocates for everyone at once — the curator loop finally *acts* |
| Distribution | wizzy.meme only | Listed on Morpho's own app, DefiLlama, aggregators — free discovery |
| Risk surface | The same four venues | The same four venues, via caps we set |
| The story | "Agents pick vaults" | "The agent **is** the curator" — literal, verifiable onchain |

The dappnode curator loop becomes the **allocator**: same gates (TVL, timelock, rate, collapse) now drive real cap and allocation changes through a bounded onchain role instead of catalog JSON. The allocator key lives on dappnode; its authority is limited to moving funds between curator-approved venues — it cannot touch custody. Curator (cap/venue) changes go behind the vault timelock with the treasury as owner and a guardian for veto.

### Costs and duties

Real risk-manager responsibility (we set caps, we answer for allocations), multisig/timelock hygiene, a deployment + seeding step, and the cold-start problem (new vault, zero TVL — our UI solves distribution day one by pointing deposits at it). Fee texture: users pay our performance fee *plus* underlying vault fees when allocating into V1 vaults — same double-layer the index has today, so no regression.

### Verdict

This was a superseded stablecoin-vault proposal. Any future vault performance fee would require its own implementation, review, and release; the current direct LP product charges no Wizzy fee.

## Part 2 — where a token fits a stablecoin yield product

Hard boundary first: **the token can never be an asset in the product.** Users deposit USDC precisely to avoid alt exposure; a token sleeve here would break the thesis the way it couldn't in the meme index. So the flywheel attaches to the layers around the deposits:

### The flywheel

1. **XP is the distribution engine.** The quest system shipped 2026-08-31 is the missing half of a points program: deposits × size × time already accrue server-verified, onchain-proven XP. A future WIZZY generation event allocates against that record. This makes TVL growth and token distribution the same motion — the quests are suddenly load-bearing.
2. **Revenue makes the token respectable.** The curator vault's performance fee is recurring cash flow to the treasury. A token over a cash-flowing product is a fundamentally different object from a meme launch.
3. **Staking closes the loop.** Stake WIZZY → fee discounts and XP multipliers → deeper deposits → more fee revenue → treasury seeds disclosed WIZZY/USDC liquidity on Base (Aerodrome) under the existing treasury policy caps. Utility first; any revenue-share design waits for the legal review the original TOKEN_FLYWHEEL demanded.
4. **Governance garnish**: WIZZY signals on venue onboarding — thin, but exactly on-brand for "the curator's token."

### Sequencing and the old rules that still hold

Stage A: grow TVL with XP quietly accruing (announce nothing about a token — the TOKEN_FLYWHEEL comms rules survive the pivot: no promises, no schedules, no yield claims). Stage B: curator vault live, fee revenue real. Stage C: token generation against the XP record, staking utility, treasury liquidity. The shelved WIZZY-on-Robinhood machinery stays shelved; a yield-era token would launch on Base where the product lives.

### The one-line version

The meme flywheel made deposits buy the token. The yield flywheel makes deposits **earn** the token — and the product's own revenue is what makes the token worth earning.
