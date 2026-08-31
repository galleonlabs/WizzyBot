# Pivot: Base stablecoin yield index

Decision recorded 2026-08-31: the product pivots entirely to **curated stablecoin yield on Base**. The Robinhood meme-LP index becomes a legacy surface (existing positions stay readable and withdrawable forever; no new deposits). The WIZZY token flywheel and sleeve machinery are shelved intact. Domain/brand change pending (operator).

## Thesis

One USDC deposit, spread across Base's best stablecoin yield venues, self-custodial, curated by an agent loop. No alt exposure, no impermanent loss, no ranges. "Avoid alts — allocate to the chain's yield."

## Product shape: ERC-4626 vault index (decided by data)

DefiLlama, 2026-08-31, Base stable pools >$3M TVL: lending vaults dominate — Morpho Blue vaults (Steakhouse USDC $449M @ 4.4% APY, Gauntlet USDC Prime $425M @ 4.4%, Sirloin 5.6%, cbUSDC 6.1%, Spark 4.0%, BBQ 5.1%), Aave v3 USDC $26M @ 3.4%, Fluid $9M @ 5.3%. Stable-pair LP pools are marginal by comparison. The product is therefore a **vault index**, not an LP index:

- Deposit: USDC approve + `deposit()` into each constituent vault, weighted, in one wallet_sendCalls batch (same batching rail as today).
- Position: ERC-4626 share balances; value = `convertToAssets(shares)`; yield = share-price appreciation (no claiming, no compounding actions — it auto-compounds).
- Withdraw: proportional `redeem()` batch back to USDC.
- Fees: same schedule shape as today (create/withdraw bps to treasury), collected in USDC.

## Day-one candidate universe (subject to curator gates)

| Venue | Vault | TVL | APY (base) | Curator |
| --- | --- | --- | --- | --- |
| Morpho Blue | Steakhouse USDC | $449M | 4.4% | Steakhouse Financial |
| Morpho Blue | Gauntlet USDC Prime | $425M | 4.4% | Gauntlet |
| Morpho Blue | Spark USDC | $290M | 4.0% | SparkDAO |
| Morpho Blue | Moonwell Flagship USDC | $5M+ | 4.3% | Block Analitica/B.Protocol |
| Aave v3 | USDC pool | $26M | 3.4% | Aave DAO |
| Fluid | USDC lending | $9M | 5.3% | Instadapp |

Launch index: 4–6 constituents, weighted by TVL band and risk tier, honest blended ~4–5% APY. Reward-token APYs (emissions) are display-only; the curator never counts them as ranking signals.

## Curator repurposing

Same two-layer loop, new policy:

- Deterministic gates: vault TVL floor, vault age, utilization band, rate history (median 7d/30d), timelock + guardian configuration, underlying market concentration (for Morpho: allocation across markets, collateral quality), depeg sentinel on underlying assets.
- Research agent: verifies the vault curator's identity and track record, audits, incident history, allocation policy — same evidence-cited JSON contract, same worktree ship gate.
- Pauses/replacements: same catalog mechanics (status, weight redistribution, migrations) — machinery just shipped and tested.

## What survives unchanged

Privy onboarding + embedded wallet, wallet_sendCalls batching, relay cross-chain funding (now targeting USDC on Base), portfolio shell, telemetry, fee take, curator service on dappnode, catalog/versioning/ship gate, hermetic test discipline.

## What changes

1. **Catalog**: new market type `vault` (chain base, ERC-4626 address, underlying USDC, curator name, venue) alongside legacy LP markets.
2. **Allocation**: new thin vault path (approve+deposit batch, weighted by bps — `weightedBudgets` reused; no swaps, no mint quoting).
3. **Positions**: share-balance reader + share-price history for yield display (no NFTs, no ranges).
4. **Denomination**: deposits and display in USDC, not ETH. Relay funding quotes to USDC.
5. **Curator config/policy**: vault gates replace pool gates.
6. **UI**: yield-first reframe (APY, earned-to-date, venue cards); range-health UI retired from the main surface; meme index moves behind a legacy route for existing holders.
7. **Brand/domain**: operator call, pending. Copy stays fun — the curator character survives the pivot.

## What is shelved (not deleted)

- Robinhood meme index: legacy read/withdraw only. Catalog stays for position readability.
- WIZZY token + sleeve machinery + graduation kit: intact in-repo, dormant.
- Pool-activity rail: Robinhood-specific; retires with the meme surface.

## Build phases

1. **Vault core**: 4626 adapter (deposit/redeem/convert, share accounting), vault catalog schema + day-one config, tests.
2. **Deposit flow**: USDC funding (Relay to Base USDC), batch planner, fee take, portfolio reader.
3. **Curator**: vault policy gates + research prompt + config; wire into the existing dappnode loop.
4. **UI**: yield surface, legacy meme route split.
5. **Ship**: full gate, deploy, live verification with a real small deposit.
