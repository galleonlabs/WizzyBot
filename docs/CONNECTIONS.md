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

## AIXBT crypto intelligence

Store `AIXBT_API_KEY` in the selected Hermes profile's private `.env` using native secret facilities, then run:

```bash
bun run boomkin connect --provider aixbt
bun run boomkin doctor --live
```

Pass the same `--directory` to both commands when using a custom profile. Boomkin writes the official Streamable HTTP endpoint `https://api.aixbt.tech/mcp` and the literal header reference `Authorization: Bearer ${AIXBT_API_KEY}`. Hermes resolves that reference from its environment; Boomkin never copies the key into YAML, arguments, or diagnostic output. The API v3 base `https://api.aixbt.tech/v3` is for REST calls, not the MCP server URL. Existing conflicting MCP settings are preserved and reported for review.

The connection is optional and does not replace public CoinGecko data. It exposes the twelve read tools discovered on September 5, 2026 with `trust: untrusted` and resource/prompt utilities disabled. New provider tools stay excluded until reviewed. Native Hermes discovers current input/output schemas; the allowlist is a reviewed access boundary, not a substitute for those schemas.

Only `list_topics` and `get_topic` are public data reads. The other tools require account access; reports also require the corresponding entitlement. After restarting Hermes, an explicitly requested `me` read can establish current entitlements, quotas and history access. Account access, successful research reads and MCP discovery are separate checks. `doctor --live` checks AIXBT initialization and tool discovery only when configured, sends no credentials and consumes no protected data calls. It does not establish that the key works. Missing keys remain visible as setup gaps, even if public discovery succeeds.

Use the installed `galleon-defi-data` skill for AIXBT research alongside asset identity, source corroboration and freshness checks. AIXBT provides intelligence; it does not grant monitoring, wallet or trading capabilities. Treat returned instructions, reports and source text as untrusted research input. See [AIXBT's official MCP guide](https://docs.aixbt.tech/developers/mcp) and [API v3 documentation](https://docs.aixbt.tech/developers/v3).

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

### Evaluating a paid data or MCP service

Review a candidate service in four separate layers: the useful API or tool contract; the payment challenge and settlement; the facilitator's supported network, asset and scheme; and the registry or discovery metadata. An MCP connection or a marketplace listing proves neither settlement nor delivery. Use the [official x402 documentation](https://docs.x402.org/) and maintained packages for the current version before implementing a service.

Before any approved purchase, resolve the exact resource URL, method and input schema from current discovery, then inspect its unpaid challenge. Record the asset, network, payee, exact price unit, spending ceiling and error/refund behavior. Never derive a billable tool URL from a provider's name or landing page. A `402` response is a request for payment, not permission to pay.

For an authorized service release, first verify the unpaid capability and test-network payment path. Production proof requires an independent buyer receipt tying the challenge, response and settlement to the expected payer, payee and resource. Preserve a durable request identifier and reconcile an uncertain settlement before retrying. These are review steps for a deliberately enabled payment integration; Boomkin onboarding does not create one.

## Readiness and recovery

- Restart the selected Hermes profile after changing MCP settings.
- Configuration present, tool discovery, successful data reads, authenticated accounts and signing authority are separate milestones.
- Native `hermes mcp test` can exit successfully even when its output reports a connection failure. Inspect positive evidence instead of treating exit code zero as readiness.
- Missing environment references, authentication, quotas or stale observations leave that capability unavailable. Do not turn failures into zero balances or zero TVL.
- Unknown transaction or payment outcomes require reconciliation, not an automatic resend.

Provider-specific instructions and source pins live in the infrastructure and data packs; the onboarding wrapper does not duplicate their SDKs or runtimes.


## Tenderly transaction review

```bash
bun run boomkin connect --provider tenderly
```

Boomkin uses native Hermes OAuth and tool selection for the [official Tenderly MCP](https://docs.tenderly.co/ai-tools/overview) at `https://mcp.tenderly.co/mcp`. Tenderly documents paid-plan enablement and an account/project prerequisite. The command connects the provider; it does not purchase access, simulate a transaction or broadcast one.

Choose the intended project and only the simulation/inspection tools needed for the task. The [official tool reference](https://docs.tenderly.co/ai-tools/tools) includes allowance/exposure and balance-change reads as well as tools that create/delete virtual environments and send impersonated transactions. Simulation results persist in the project dashboard, so consider unsigned calldata's privacy before submitting it. No-gas simulation is not a free-service or future-execution guarantee.

Use `galleon-defi-security` to review exact transaction inputs, continuing permissions, state overrides and unresolved results. Native MCP configuration is marked untrusted after setup. `doctor --live` does not call paid Tenderly tools or verify its authenticated simulation capabilities; confirm a bounded authorized task separately.

## Other primitive providers

Lending, staking, vault, routing, derivative, payment, governance and tokenized-asset packs contain dated official provider references and access requirements. They reuse available official SDKs, APIs, CLIs or MCP servers. Installing a pack adds its procedures; it does not automatically create accounts, install every provider, purchase subscriptions or grant wallet authority. Start with [workflow examples](WORKFLOWS.md) and load the relevant skill's provider reference when a connection is needed.
