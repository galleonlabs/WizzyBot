# Boomkin connections

Hermes owns authentication, tools and execution. Boomkin prepares an isolated profile and selected official connections; skill instructions do not create financial authority. Reviewed September 5, 2026; recheck current provider capabilities before granting access.

## Model and runtime

`bun run boomkin onboard` runs the official pinned Hermes installer when needed and opens `hermes setup model` with the selected `HERMES_HOME`. Use `bun run boomkin model` to revisit setup, and `bun run boomkin start` for native chat. Model keys, OAuth and local models use Hermes's facilities. A configured model name or CLI version is not proof of authentication.

Hermes v0.21.0 at [the reviewed source](https://github.com/NousResearch/hermes-agent/tree/2e24e06e5513fa425ccf935d2e41991cb11ff383) was tested. Boomkin pins the official installer and runtime for a fresh install. Existing installations are preserved. Native setup supports optional browser, tools and messaging features; configure those through Hermes rather than a second runtime.

The selected directory holds `config.yaml`, `.env`, `SOUL.md`, `skills/` and native state. Boomkin stores its own records under `.boomkin/`. Commands explicitly select the root profile so a sticky Hermes profile preference cannot redirect them elsewhere. Do not move a configured profile without reviewing saved paths and credentials.

## Public data

CoinGecko public MCP is `https://mcp.api.coingecko.com/mcp`. Onboarding adds only `execute` and `search_docs`, the two tools returned during the live review, with `trust: untrusted` and resource/prompt utilities disabled. `execute` runs code against CoinGecko's hosted data SDK; it is not arbitrary local code execution. Use bounded queries with explicit asset IDs, currency and timestamps. Pricing, limits and tool discovery can change.

`bun run boomkin doctor --live` checks initialization and tool discovery without calling a model or a paid service. A separate market read is available from the installed data skill:

```bash
node "$HOME/.boomkin/hermes/skills/galleon-defi-data/scripts/price-check.mjs" --provider coingecko --id ethereum
```

The helper accepts `--provider`, `--id` and `--max-age`; it always returns JSON. See its installed `references/diagnostic.md`. Public REST access and MCP access are different paths; one passing does not prove the other works. See [CoinGecko's official guide](https://docs.coingecko.com/docs/ai-agents-llm-apps).

## Alchemy and RPC

```bash
bun run boomkin connect --provider alchemy
```

The command hands OAuth and tool selection to native Hermes at `https://mcp.alchemy.com/mcp`, then marks the resulting server untrusted. Select the intended app before RPC/data calls. Start with the necessary read tools; app administration and wallet session/transaction tools are separate choices. API-key access through the official CLI is distinct from hosted MCP OAuth. See [Alchemy agent tools](https://www.alchemy.com/ai-agents).

For the infrastructure diagnostic, configure `DEFI_RPC_URL` through the selected profile's secret facilities. Do not paste the endpoint key in chat or put it in a command argument. The diagnostic verifies chain ID and fresh head using two reads; it does not prove pool state, wallet authority or complete historical coverage. Use its documented CLI/help from the [infrastructure pack](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/infra).

## DeFiLlama

```bash
bun run boomkin connect --provider defillama
```

The official endpoint `https://mcp.defillama.com/mcp` requires OAuth and an API subscription. Requests consume credits. Its single-client restriction can disconnect an existing MCP client; choose the intended agent before authorizing. Boomkin does not authenticate this paid provider during default onboarding. The data pack also documents bounded public REST alternatives with separate coverage. See [the official MCP page](https://defillama.com/mcp).

## Coinbase account

```bash
bun run boomkin connect --provider coinbase
bun run boomkin connect --provider coinbase --key-file /absolute/path/to/scoped-key.json
```

This uses `@coinbase/coinbase-cli@0.0.7`, Node.js 22+ and the native `coinbase mcp` stdio server. Its remote account MCP restricts supported harnesses, so Boomkin uses the local path. The configuration initially exposes only balance, portfolio listing/details, product listing/details and fee reads. It grants no trading or transfer tool through this MCP connection.

Each profile receives both a distinct `COINBASE_CONFIG_DIR` and a unique `live-boomkin-...` environment. Both matter: the OS keyring indexes the secret by environment name, not configuration directory. The optional key-file command invokes the native `coinbase env` workflow under those exact settings. If the OS keychain is unavailable, resolve that issue; Boomkin never enables `--allow-plaintext-secrets`. npm lifecycle scripts are disabled for the configured MCP process to avoid the CLI postinstall copying a separate skill corpus.

Credential setup does not establish the permitted portfolio, actual funds or read success. Verify the selected portfolio and provider-enforced limits through the native tools before use. Hermes terminal access remains a separate capability and may run other CLI commands; MCP filtering alone does not enforce a financial policy. Never check in key files or copy secrets into a model prompt.

See [Coinbase for Agents](https://docs.cdp.coinbase.com/x402/agentic-accounts/coinbase-for-agents). Its isolated Coinbase portfolio and Agentic Wallet below are different products. The reviewed Coinbase account guide labels x402 payments coming soon; do not advertise that capability as available through this connection.

## Agentic Wallet and x402

The [Agentic Wallet guide](https://docs.cdp.coinbase.com/x402/agentic-accounts/agentic-wallet) provides the official `awal` CLI and separate payment MCP. The reviewed CLI is `awal@2.12.1`; current setup documentation requires Node.js 24+.

```bash
npx --yes awal@2.12.1 --help
npx --yes awal@2.12.1 status --json
```

Login can create a Coinbase-managed wallet and send an OTP. Do it only when deliberately choosing that wallet, using the native flow and approved contact/account. Funding, transfers, trading and x402 purchases require separate terms and spending limits. A paid HTTP request is a financial action, not a harmless data-read retry.

No portable `AWAL_HOME` isolation setting was verified; its OS-level session may be shared. Do not assume that choosing a Boomkin directory isolates that wallet. The payments MCP npm package is an installer for another runtime bundle, not a command to register as a stdio server. Use its documented setup if choosing that distinct path; Boomkin does not invent a server command.

## Readiness and recovery

- Restart the selected Hermes profile after changing MCP settings.
- Configuration present, tool discovery, successful data reads, authenticated accounts and signing authority are separate milestones.
- Native `hermes mcp test` can exit successfully even when its output reports a connection failure. Inspect positive evidence instead of treating exit code zero as readiness.
- Missing environment references, authentication, quotas or stale observations leave that capability unavailable. Do not turn failures into zero balances or zero TVL.
- Unknown transaction or payment outcomes require reconciliation, not an automatic resend.

Provider-specific instructions and source pins live in the infrastructure and data packs; the onboarding wrapper does not duplicate their SDKs or runtimes.
