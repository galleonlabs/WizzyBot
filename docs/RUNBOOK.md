# Production runbook

How to run Wizzy. The consumer app presents reviewed meme markets on Base and Robinhood Chain. The operator CLI covers EVM position primitives. Users keep every LP position in their connected wallet.

**Never commit `.env`.** Copy `.env.example` locally. `.env` is gitignored. Do not paste secrets into git, Vercel project settings screenshots, or this file.

## Current release scope

The application does not automatically buy, bundle, or allocate to WIZZY. Direct LP actions are fee-free because their wallet-confirmed transaction sequences cannot enforce a product fee atomically.

No application, curator, CLI, keeper, or ordinary deployment path may:

- create or announce a Wizzy token;
- add a related-party market without the same explicit review and opt-in listing used for other markets;
- treat user assets or pool fees as treasury revenue;
- describe treasury revenue as a buyback, yield, price floor, or token-holder entitlement.

Token graduation and any later opt-in market listing are separate releases governed by the [token and treasury plan](TOKEN_FLYWHEEL.md).

## Pool activity

The public rail under the navigation is labelled **Pool activity**. It reports Uniswap V3 `Mint` and `Burn` events from the reviewed Robinhood pools; it does not imply that Wizzy vaults user funds.

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

`--protocol v2|v3|v4` (default v3) on list, status, mint, compound, range, exit. `--config <path>` merges over `~/.unabot/config.json`. Direct LP actions have no Wizzy fee.

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

Hosted chat is operator infrastructure behind Vercel OIDC. It can inspect positions and prepare transaction plans, but it cannot sign for a consumer. See [Vercel](#vercel).

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

Hosted keeper is the observe-only eve schedule `*/15 * * * *` (`agent/schedules/keeper.ts`). It skips cleanly until `UNABOT_KEEPER_OWNER` names the EOA to scan. It can recommend actions but never signs or broadcasts them.

## Env

Set these in `.env` locally or in the Vercel project `wizzy`. Values here are public or empty on purpose.

| Variable | Role |
| --- | --- |
| `BASE_RPC_URL` | Base RPC. Default `https://mainnet.base.org`. Use a dedicated provider in production. |
| `ROBINHOOD_RPC_URL` | Robinhood RPC. Default `https://rpc.mainnet.chain.robinhood.com`. Use a dedicated provider in production. |
| `ROBINHOOD_ACTIVITY_RPC_URL` | Optional server-only archive RPC for the shared Pool activity scan. It must accept a 1,000-block `eth_getLogs` range; the scan remains fixed at two requests per cache fill. |
| `SOLANA_RPC_URL` | Server-only endpoint retained for the dormant Solana planner and position reader. Never expose a credentialed RPC URL through a `NEXT_PUBLIC_` variable. |
| `UNISWAP_API_KEY` | Optional. Write paths use Uniswap LP + Trading APIs when set. Never commit. |
| `UNABOT_PRIVATE_KEY` | CLI `--live` signer. `0x` + 32-byte hex. Never commit. Hosted agent does **not** use this. |
| `UNABOT_TREASURY` | Optional legacy treasury override. Direct LP actions do not route fees here. |
| `UNA_TREASURY_PRIVATE_KEY` | Legacy-compatible key name for the Wizzy EVM treasury and future token-creation wallet. The app does not read it. Never expose it to client code or logs. |
| `UNA_TOKEN_CREATOR_ADDRESS` | Legacy-compatible key name for the public address reserved for a future Wizzy token launch. |
| `UNABOT_ETH_USD` | Optional USD/ETH fallback for skip math. |
| `TELEGRAM_BOT_TOKEN` | Telegram surface. Never commit. |
| `UNABOT_KEEPER_OWNER` | Wallet address the hosted keeper scans. Unset, the schedule logs a skip and does nothing. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway. Or link the Vercel project and use `VERCEL_OIDC_TOKEN`. |
| `EVE_ALLOW_ANON` | Set to `1` to admit anonymous eve HTTP in production. Default fail-closed. |

Never log env values.

Production EVM authority: Vercel stores the public address and the retrievable production-only private key reserved for treasury and future token-creation work. The application and dappnode curator do not read the key. Centralized curation requires no signing key and spends no chain gas.

Robinhood market membership comes from `src/config/markets.json`. Metadata for tracked candidates remains version-controlled so existing positions stay readable and withdrawable.

The persistent workflow is documented in `docs/CURATION.md`. The dappnode timer collects evidence, runs a read-only web-research agent, validates its structured decision against deterministic policy, and ships only tested centralized catalog changes. Registry contract tooling is deferred and is not part of the production workflow.

## Dry-run vs live

| Surface | Dry-run (default) | Live |
| --- | --- | --- |
| CLI / chat / telegram | Plan only. Prints `dry-run: no broadcast`. | `--live` + type `yes` on a TTY. CLI signs with `UNABOT_PRIVATE_KEY`. |
| MCP / hosted tools | `live` omitted or false. | `live=true` **and** `confirm=true` prepares an EOA wallet plan. Hosted code never signs or broadcasts it. |
| Hosted keeper | Observe-only scans and recommendations. | No unattended execution path. |

Hosted plans are allowlisted to the relevant position manager, Permit2, router, and pair tokens. The connected EOA remains the only consumer signer.

## Vercel

Project name: **`wizzy`**.

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
