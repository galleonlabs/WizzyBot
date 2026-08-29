# Revert pool performance source capture

- Source: https://docs.revert.finance/revert/initiator/start-providing-liquidity
- Captured: 2026-08-29
- Product evidence: pool rows display TVL, volume, fees, fees/TVL, fee APR, and rewards APR. Revert defines fee APR as the annual percentage rate derived from trading fees.
- Source: https://docs.revert.finance/revert/auto-compounder/performance-improvement
- Product evidence: fee APR and projected auto-compound APY are separate metrics; APY depends on an actual compounding model and must include gas and protocol costs.
- Source: https://docs.revert.finance/revert/position-management
- Product evidence: action-specific costs are disclosed in the relevant transaction path rather than promoted as an idle-page feature.

Una implication: label the live simple annualization “Fee APR”; reserve “APY” for a functioning, cost-aware auto-compound product.
