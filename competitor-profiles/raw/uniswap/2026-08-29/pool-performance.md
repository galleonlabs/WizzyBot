# Uniswap pool performance source capture

- Source: https://support.uniswap.org/hc/en-us/articles/7423194619661-How-to-add-liquidity-to-Uniswap-v3
- Captured: 2026-08-29
- Product evidence: pool discovery surfaces TVL, volume, token prices, fee tier, and the selected range before liquidity is added.
- Source: https://support.uniswap.org/hc/en-us/articles/20901935681677-What-is-a-liquidity-provider-LP-fee
- Product evidence: liquidity-provider fees accrue only while a concentrated-liquidity position is active and in range.

Una implication: use pool metrics as the proof layer, keep the primary action simple, and keep range state visible on owned positions.
