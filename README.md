# UnaBot

Uniswap LP on autopilot.

v2, v3, and v4. You keep the position.

Compound, re-range, exit.

Base. Dry-run until you type yes. `--live` broadcasts.

```
unabot list --owner <addr> --protocol v3
unabot pool --token0 <addr> --token1 <addr> --fee 500
unabot mint --protocol v3 --token0 <addr> --token1 <addr> --fee 500 --width 10 --amount0 <raw> --amount1 <raw>
unabot compound <tokenId> --protocol v3
unabot range <tokenId> --protocol v3
unabot exit <tokenId> --protocol v3
unabot chat
unabot telegram
unabot mcp
```

Copy `.env.example`. Never commit `.env`.

```
unabot pool --token0 0x4200000000000000000000000000000000000006 \\
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --fee 500
```

`make ci` or `npx vitest run` && `npx tsc -p tsconfig.build.json`.

`--protocol v2|v3|v4` (default v3) on list, status, mint, compound, range, exit. You keep the position (v3/v4 NFT; v2 LP token).

## eve (Vercel)

Hosted chat + keeper. Node 24+ for the eve CLI. Project name `unabot`.

```
bun install
cp .env.example .env
bun run eve:dev
```

`eve deploy --project unabot` (or push to a Git-linked Vercel project). `next dev` / `next build` via `withEve()` ships the chat UI and `/eve/v1` together.

Eve tools call a pre-bundled CJS surface (`unabot-hosted-cjs` from `src/hosted-bundle.ts`) so `@uniswap/sdk-core` never loads as extensionless ESM during `eve build`.

Env for the hosted agent:

- `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_ID` — `cmte7ydie07zb0djopp7gds6m`
- `PRIVY_APP_SECRET` — required for live signing and Privy route auth. Leave empty for dry-run / stub.
- `PRIVY_AUTHORIZATION_KEY` — optional, later
- `PRIVY_WALLET_ID` — optional hosted wallet id
- `KEEPER_LIVE=1` — 15-minute keeper may broadcast (still needs the secret)
- `AI_GATEWAY_API_KEY` or a linked Vercel project (`VERCEL_OIDC_TOKEN`)
- `BASE_RPC_URL`, optional `UNISWAP_API_KEY`
- `EVE_ALLOW_ANON=1` — optional anonymous eve HTTP in production (default fail-closed)

Chat login is email only. Google stays off until OAuth credentials exist.

Dry-run is the default. Live writes need `confirm=true` and a Privy signature. The CLI still uses `UNABOT_PRIVATE_KEY`; the hosted agent does not.
