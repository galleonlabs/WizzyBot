# Base smoke — 2026-08-29

Read-only. No spend. No secrets.

## pool — WETH/USDC 0.05%

```
unabot pool --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --fee 500
```

```
{
  "pool": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
  "sqrtPriceX96": "3910055749083347602024308",
  "tick": -198341,
  "fee": 500
}
```

## list

`0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42` — Wizzy treasury; no positions at creation.

Public LP `0x7E80D84DacF9b6E9B1dCD99bC572395A7ABB8f19` (via `https://base.publicnode.com`):

```
5878759  USDC/GOOGLc  fee=10000  OOR
5879567  USDC/GOOGLc  fee=10000  in-range
5889145  WETH/Basecat  fee=10000  in-range
5896891  USDC/Basecat  fee=3000  in-range
5896925  USDC/Basecat  fee=3000  OOR
5896950  USDC/Basecat  fee=3000  OOR
5897106  USDC/Basecat  fee=3000  in-range
5897398  USDC/Basecat  fee=3000  in-range
5897308  USDC/Basecat  fee=3000  OOR
```

## status 5897308

Empty position. HOLD `source=first-seen-import` (not silently treated as the mint bag).

## LP API

`UNISWAP_API_KEY` set locally (not committed). `POST /lp/create` with `simulateTransaction=true` returned 200 and calldata to NFPM `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1`. No broadcast.
