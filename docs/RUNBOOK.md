# Production runbook

How to run Wizzy. The consumer web index covers Base, Robinhood Chain, and Solana. The operator CLI covers EVM position primitives. Users keep every EVM LP NFT and Solana DLMM position.

**Never commit `.env`.** Copy `.env.example` locally. `.env` is gitignored. Do not paste secrets into git, Vercel project settings screenshots, or this file.

## Current release scope

The initial application launch does not deploy, buy, list, or include a Wizzy token. Its related-party sleeve is 0%, and all implemented product fees continue to accumulate in the Wizzy treasury.

No application, curator, CLI, keeper, or ordinary deployment path may:

- create or announce a Wizzy token;
- add or increase a related-party index sleeve;
- route product fees into token/WETH liquidity;
- describe treasury revenue as a buyback, yield, price floor, or token-holder entitlement.

A future token is a separate, manually authorized release governed by [Token and index plan](TOKEN_FLYWHEEL.md). Token launch and later sleeve activation are also separate releases.

## Pool activity

The public rail under the navigation is labelled **Pool activity**. It reports Uniswap V3 `Mint` and `Burn` events from only the active Robinhood pools in the current index; it does not imply that Wizzy vaults user funds.

`GET /api/pool-activity` has a fixed two-request RPC budget per shared cache fill: one block-number read, then one `eth_getLogs` query covering every active pool and both event types over the most recent 1,000 blocks. Do not replace this with per-pool scans or transaction, receipt, or block-detail lookups. Set `ROBINHOOD_ACTIVITY_RPC_URL` to an archive-capable endpoint that accepts the complete block range; Alchemy Free limits Robinhood `eth_getLogs` to 10 blocks, so it cannot serve this feed efficiently. If a scan fails, the same cache fill retries on the default Robinhood RPC and finally with a 250-block window, because the public RPC's load-balanced nodes enforce inconsistent range caps. The server cache refreshes at most once per 60 seconds and can serve stale data for five minutes. Browsers poll at most once per minute, pause while the tab is hidden, retain the last good result during a transient failure, and never contact the RPC directly.

## Install

```
bun install
cp .env.example .env
bun run build
```

CLI binary: `node ./bin/unabot.mjs` (or `unabot` after install). `bun run build` emits `dist/unabot.cjs`; the bin refuses to start if that file is missing.

Node 20+ for the package. Node 24+ for the eve CLI.

## CLI

Dry-run is the default. `--live` broadcasts only after you type `yes` on a TTY.

```
unabot list --owner <addr> --protocol v3
unabot status <tokenId> --protocol v3
unabot pool --token0 <addr> --token1 <addr> --fee 500
unabot mint --protocol v3 --token0 <addr> --token1 <addr> --fee 500 --width 10 --amount0 <raw> --amount1 <raw>
unabot compound <tokenId> --protocol v3
unabot range <tokenId> --protocol v3
unabot exit <tokenId> --protocol v3
unabot simulate compound|range|exit <tokenId>
unabot import --owner <addr>
unabot config
```

`--protocol v2|v3|v4` (default v3) on list, status, mint, compound, range, exit. `--no-fee` skips the take. `--fee-source fees|notional`. `--config <path>` merges over `~/.unabot/config.json`.

Live CLI writes need `UNABOT_PRIVATE_KEY`. Reads can pass `--owner` instead. Without a TTY, `--live` is refused.

Smoke (read-only):

```
unabot pool --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --fee 500
```

## Chat

Local REPL. Live writes still need `--live` and `yes`.

```
unabot chat
unabot "status 12345"
```

Hosted chat is the Next/eve app (email login only; Google stays off until OAuth exists). See [Vercel](#vercel).

## Telegram

Create a bot with `@BotFather`. Set `TELEGRAM_BOT_TOKEN` in `.env` (never commit the token).

```
unabot telegram
unabot --live telegram
```

Dry-run by default. Live writes require an explicit `yes` in the chat. Without a token the process prints help and exits.

## MCP

stdio server for Cursor / other MCP hosts.

```
unabot mcp
# or
bun run mcp
```

Tools: list, status, mint, compound, range, exit, simulate, pool_info (plus aliases). Writes are dry-run unless the tool is called with `live=true`.

## Keeper

Local loop (default 30s). Plans compound / re-range / exit from `unabot.config.json`. Dry-run unless `--live`.

```
unabot run
unabot run --once
unabot run --interval 60000
unabot --live run --once
```

Hosted keeper is the eve schedule `*/15 * * * *` (`agent/schedules/keeper.ts`). It skips cleanly until `UNABOT_KEEPER_OWNER` names the wallet to scan, and stays dry-run unless `KEEPER_LIVE=1` **and** `PRIVY_APP_SECRET` is set. `UNABOT_KEEPER_LIVE=1` is accepted as an alias.

## Env

Set these in `.env` locally or in the Vercel project `wizzy`. Values here are public or empty on purpose.

| Variable | Role |
| --- | --- |
| `BASE_RPC_URL` | Base RPC. Default `https://mainnet.base.org`. Use a dedicated provider in production. |
| `ROBINHOOD_RPC_URL` | Robinhood RPC. Default `https://rpc.mainnet.chain.robinhood.com`. Use a dedicated provider in production. |
| `ROBINHOOD_ACTIVITY_RPC_URL` | Optional server-only archive RPC for the shared Pool activity scan. It must accept a 1,000-block `eth_getLogs` range; the scan remains fixed at two requests per cache fill. |
| `SOLANA_RPC_URL` | Server-only Solana endpoint used for planning, position reads, submission, and confirmation. Never expose a credentialed RPC URL through a `NEXT_PUBLIC_` variable. Privy manages wallet connectivity in the browser. |
| `UNISWAP_API_KEY` | Optional. Write paths use Uniswap LP + Trading APIs when set. Never commit. |
| `UNABOT_PRIVATE_KEY` | CLI `--live` signer. `0x` + 32-byte hex. Never commit. Hosted agent does **not** use this. |
| `UNABOT_TREASURY` | Optional override. Product fees go here. |
| `UNA_TREASURY_PRIVATE_KEY` | Legacy-compatible key name for the Wizzy EVM treasury and future token-creation wallet. The app does not read it. Never expose it to client code or logs. |
| `UNA_TOKEN_CREATOR_ADDRESS` | Legacy-compatible key name for the public address reserved for a future Wizzy token launch. |
| `UNABOT_SOLANA_TREASURY` | Public Solana fee recipient. Required to prepare Solana withdraw and reinvest actions. |
| `UNABOT_ETH_USD` | Optional USD/ETH fallback for skip math. |
| `TELEGRAM_BOT_TOKEN` | Telegram surface. Never commit. |
| `PRIVY_APP_ID` / `NEXT_PUBLIC_PRIVY_APP_ID` | Public app id: `cmtft1kti01cf0dl73c3zpuem` |
| `PRIVY_APP_SECRET` | Required for hosted live signing and Privy route auth. Leave empty for dry-run / stub. **Do not put the value in this file.** |
| `PRIVY_AUTHORIZATION_KEY` | Optional Wallet API authorization key. Later. |
| `PRIVY_WALLET_ID` | Optional hosted wallet id. |
| `KEEPER_LIVE` | Set to `1` so the 15-minute keeper may broadcast (still needs the Privy secret). |
| `UNABOT_KEEPER_OWNER` | Wallet address the hosted keeper scans. Unset, the schedule logs a skip and does nothing. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway. Or link the Vercel project and use `VERCEL_OIDC_TOKEN`. |
| `EVE_ALLOW_ANON` | Set to `1` to admit anonymous eve HTTP in production. Default fail-closed. |

Never log env values.

Production EVM authority: Vercel stores the public address and the retrievable production-only private key reserved for treasury and future token-creation work. The application and dappnode curator do not read the key. Centralized curation requires no signing key and spends no chain gas.

Production Solana treasury custody: Vercel stores only the public address. The independent private key is in the Mac login Keychain under service `unabot-solana-treasury`.

Robinhood membership and weights come from `src/config/markets.json`. Metadata for tracked candidates remains version-controlled so existing positions stay readable and withdrawable.

The dappnode timer now curates the **stable vault catalog** (`src/config/stable-vaults.json`) via `bun run curate:vaults`: deterministic Morpho-sourced gates with automatic pause and weight redistribution, shipped through the same tested worktree gate. The meme catalog (`docs/CURATION.md`) is frozen legacy for existing positions.

## Dry-run vs live

| Surface | Dry-run (default) | Live |
| --- | --- | --- |
| CLI / chat / telegram | Plan only. Prints `dry-run: no broadcast`. | `--live` + type `yes` on a TTY. CLI signs with `UNABOT_PRIVATE_KEY`. |
| MCP / hosted tools | `live` omitted or false. | `live=true` **and** `confirm=true`. Hosted signs with Privy, not a raw key. |
| Hosted keeper | Plans only. | `KEEPER_LIVE=1` + `PRIVY_APP_SECRET`. |

Without the Privy secret, hosted live writes stub and do not broadcast. Targets are allowlisted (NFPM, Permit2, Universal Router, v2 router, v4 position manager, treasury, plus the pair tokens).

## Vercel

Project name: **`unabot`**.

`vercel.json` runs `bun install` then `next build`. `withEve()` ships the chat UI and `/eve/v1` together.

```
bun install
cp .env.example .env
eve dev
eve deploy --project unabot
```

Or push to the Git-linked Vercel project. Set the env table above on the `unabot` project (Production + Preview as needed). Chat login is email only.

## When the build fails

Reproduce the same command that failed. Do not “fix” a deploy by committing `.env`.

**Vercel / web** (`next build`, project `unabot`):

1. Open the failed deployment on the `unabot` project and copy the first type/module error, not the last cascade line.
2. Reproduce: `bun install && bunx next build`.
3. App + agent typecheck uses `tsconfig.json` with `moduleResolution: "bundler"`. Do not point `next build` at `tsconfig.build.json` (NodeNext, CLI-only).
4. `next build` must not typecheck `src/` or `test/`. Those stay excluded. If a test or CLI file shows up in Vercel logs, the app tsconfig include/exclude drifted.
5. Extensionless app imports (`import { Chat } from "./chat"`) are valid under bundler resolution. Do not “fix” them by switching the app tsconfig to NodeNext.
6. Eve CLI / Node 24 issues are local (`eve dev`, `eve deploy`). Vercel itself runs `next build`.

**CLI / CI** (`tsc -p tsconfig.build.json`, `node scripts/bundle-cli.mjs`):

1. Reproduce: `make ci` or `bun run test && bun run build`.
2. CLI emit is NodeNext. `src/` imports need `.js` specifiers. Do not flip `tsconfig.build.json` to bundler to silence that.
3. `bin/unabot.mjs` exiting with `build missing` means `dist/unabot.cjs` was not bundled — run `bun run build`, not only `tsc`.
4. Typecheck without emit: `npx tsc --noEmit -p tsconfig.node.json` (src + test + agent).

If install fails on Vercel, confirm the project still uses `bun install` (`vercel.json` `installCommand`) and Bun 1.4+ locally to match CI.
