# Pons launch rails and the LP index (2026-08-31)

Decision-relevant research from the abandoned Pools crowd launch and the Pons relaunch preparation. Source: docs.ponsfamily.com (v1 and v2), verified against the live create form and the deployed Robinhood v4 stack.

## Finding: Pons v2 pools pay LPs nothing, by design

Pons v2 graduates a bonding curve into a **Uniswap v4 pool whose core fee is zero**. The 1% swap fee is charged by the shared pons hook and split protocol/buyback/creator — in their own words, "rather than accruing to a liquidity provider that does not exist." The only liquidity is the pons locked full-range position; the hook does not gate third-party liquidity, but any outside position earns **zero fees forever**.

Consequences:

- **No LP-yield index can cover Pons v2 tokens** — not Wizzy's, not anyone's. This is their economic architecture, not a product gap on our side.
- Building v4 pipeline support (catalog, quoting via the deployed Robinhood v4Quoter/StateView, v4 PositionManager mint batches) only pays off for **standard v4 pools with real LP fees**. It is future-proofing, not access to Pons v2 launches.
- Covering hook-pool tokens would require a different product shape: a buy-and-hold sleeve (price exposure, no fee yield). Separate thesis, separate decision.

## Pons v1 is the rail the index runs on

Pons v1 deploys the token and its **Uniswap v3 WETH pool in one transaction**, liquidity locked, tradeable from the launch block. "Graduation" (4.2 WETH paired) is a milestone badge — nothing migrates. Every current index constituent is a Pons v1 pool, and index users' own v3 positions earn pool fees normally, pro-rata. Creator economics: 70% of the locked position's fees accrue to the creator wallet (30% protocol), claimable anytime.

For the WIZZY relaunch this means **v1 is the only rail where the flywheel functions**: the v3 pool exists immediately, the sleeve can activate the same day, and index deposits push the pool toward its graduation badge instead of waiting behind a curve.

## State as of 2026-08-31

- Pools crowd launch (token `0x9626F5491773BD28e1a1Edb91BE962264adF4F63`) stalled at 58% of its $10K FDV gate and was abandoned; supply never left the launch contracts, so no holders are stranded.
- A Pons **v1** launch form is fully configured in the operator's browser (Wizzy / WIZZY, brand image on IPFS, 0.01 ETH dev buy, description, X handle) awaiting the operator's signature. A v1 launch produces a **new token address**; update the watchers, activation command, and graduation post with it.
- The core repo already supports v2/v3/v4 position primitives (adapters, v4 calldata, Robinhood v4Quoter/StateView/PositionManager addresses). The consumer index pipeline (catalog schema, allocation quoting, activity, stats) is v3 + Aerodrome only; extending it is bounded work, scoped by the finding above.
