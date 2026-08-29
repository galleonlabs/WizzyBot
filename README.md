# UnaBot

Uniswap LP on autopilot.

v2, v3, and v4. You keep the position.

Compound, re-range, exit.

Base. Dry-run until you type yes. `--live` broadcasts.

```
unabot list --owner <addr>
unabot pool --token0 <addr> --token1 <addr> --fee 500
unabot mint --token0 <addr> --token1 <addr> --fee 500 --width 10 --amount0 <raw> --amount1 <raw>
unabot compound <tokenId>
unabot range <tokenId>
unabot exit <tokenId>
unabot chat
unabot telegram
unabot mcp
```

Copy `.env.example`. Never commit `.env`.

```
unabot pool --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --fee 500
```

`make ci` or `npx vitest run` && `npx tsc -p tsconfig.build.json`.
