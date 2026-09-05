# Boomkin

**A Hermes agent wired for DeFi.**

Boomkin brings the native [Hermes Agent](https://github.com/NousResearch/hermes-agent) runtime together with four independently published Galleon skill packs, public market data and optional infrastructure and wallet connections. It gives you a dedicated DeFi profile, then hands model login, tool authentication and the agent loop to Hermes.

[Get started](#get-started) · [Skill packs](#four-skill-packs) · [Connections](docs/CONNECTIONS.md) · [Contribute](CONTRIBUTING.md)

[![CI](https://github.com/galleonlabs/boomkin/actions/workflows/ci.yml/badge.svg)](https://github.com/galleonlabs/boomkin/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Get started

Use macOS or Linux, [Bun](https://bun.sh), Git and a terminal. For Windows, use WSL2 or install Hermes with its official Windows flow first. Optional Coinbase tooling requires Node.js 22+; Agentic Wallet's current guide requires Node.js 24+.

```bash
git clone https://github.com/galleonlabs/boomkin.git
cd boomkin
bun install --frozen-lockfile
bun run boomkin onboard
bun run boomkin doctor --live
bun run boomkin start
```

`onboard` prepares `~/.boomkin/hermes`, installs the reviewed official Hermes runtime if none is available, installs the four skill packs, creates Boomkin's SOUL and instructions, configures public CoinGecko MCP, and opens native Hermes model setup. Choose your provider and sign in there. `start` launches the native Hermes chat in that same profile.

Hermes remains the runtime: its tools, sessions, memory, model adapters, MCP support and scheduling are not forked. A new runtime installation uses reviewed Hermes v0.21.0 source; the native installer also manages the user-level `hermes` command and dependencies. Browser/computer-use dependencies are skipped initially and can be added through native Hermes setup. An existing working Hermes installation at 0.21.0 or newer is reused, not downgraded.

Model authentication requires your account or local model configuration. Optional providers can require subscriptions, OAuth or scoped credentials. Onboarding makes no model call, pays for no data, creates or funds no wallet, and starts no background service.

Useful options:

```bash
bun run boomkin onboard --directory "$HOME/defi-agent" --dry-run
bun run boomkin onboard --directory "$HOME/defi-agent" --skip-model-setup
bun run boomkin onboard --directory "$HOME/defi-agent" --no-install
bun run boomkin model --directory "$HOME/defi-agent"
```

Use the same `--directory` for subsequent commands. `--skip-model-setup` is for preparing a profile before interactive login; it does not mark the model authenticated. Existing SOUL, instructions and unrelated settings are preserved. A conflicting named MCP configuration is reported for review instead of overwritten.

## Four skill packs

| Pack | Version | Role |
| --- | --- | --- |
| [Infrastructure](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/infra) | 0.1.0 | RPC, Alchemy, Coinbase account/wallet access, permissions and readiness |
| [Data](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/data) | 0.2.0 | DeFiLlama, CoinGecko and AIXBT research, asset identity, freshness and risk diligence |
| [LP](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/lp) | 0.4.2 | Uniswap and Aerodrome analysis, planning and position workflows; Revert and VFAT guidance |
| [Hyperliquid](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/hyperliquid) | 0.2.1 | Market analysis, planning, execution, monitoring and performance review |

The catalog contains **15 skills**. Start with `galleon-defi-infra` and `galleon-defi-data`, then use `lp-setup` or `hyperliquid-setup` for the chosen protocol. The foundation skills use a Galleon prefix to avoid upstream name collisions.

Each pack is independently versioned and published from [crypto-defi-skills](https://github.com/galleonlabs/crypto-defi-skills). Boomkin's [catalog](catalog/skills.json) records the npm identity, version, immutable source commit, package directory and expected skills. Downloads and installed metadata are checked before a successful sync is recorded.

Fresh onboarding includes all four. Select fewer with repeated `--pack` options:

```bash
bun run boomkin onboard --pack defi-infra-skills --pack defi-data-skills
```

Updates preserve your selection. Future packs are opt-in. To expand an older two-pack installation deliberately:

```bash
bun run boomkin onboard --directory "$HOME/your-existing-hermes-profile" --all-packs
```

Other harnesses can still install the portable skills through [advanced compatibility setup](docs/HARNESSES.md). Boomkin's end-to-end product flow is Hermes-first.

## Connect your tools

```bash
bun run boomkin providers
bun run boomkin connect --provider aixbt
bun run boomkin connect --provider alchemy
bun run boomkin connect --provider defillama
bun run boomkin connect --provider coinbase
```

| Connection | Setup and scope |
| --- | --- |
| CoinGecko | Public, keyless MCP configured during onboarding. Its reviewed tools are `execute` and `search_docs`; hosted execution is restricted to the provider's data SDK. |
| Alchemy | Native Hermes OAuth and explicit tool selection. Select the intended Alchemy app; data/RPC access and wallet/admin actions have different scopes. |
| AIXBT | Optional crypto intelligence through native Hermes MCP; the key stays in `AIXBT_API_KEY`. Discovery is public; protected research reads require account access. |
| DeFiLlama | Native Hermes OAuth with an API subscription. Queries consume credits; connecting another client can disconnect the previous client. |
| Coinbase account | Official local MCP through a pinned CLI, with six read tools and a profile-specific configuration/keychain environment. Account credentials remain a separate step. |
| Agentic Wallet | Separate official `awal` CLI flow for managed wallet and x402 use. Login, wallet creation, funding and spend limits require your choices; see the connection guide. |

For Coinbase, supply a scoped key file to the native CLI through Boomkin:

```bash
bun run boomkin connect --provider coinbase --key-file /absolute/path/to/scoped-key.json
```

The command uses the OS keychain and does not opt into plaintext secret storage. It configures credentials; it does not check balances, trade or approve payments. Coinbase's remote account MCP currently restricts custom harnesses, so Boomkin uses its supported local server. Coinbase for Agents and Agentic Wallet have different custody and payment capabilities.

Read [the connection guide](docs/CONNECTIONS.md) for exact prerequisites, diagnostics and limits. Restart Hermes after changing MCP settings. MCP tool selection controls that connection; it is not a sandbox around Hermes's terminal or a substitute for provider-enforced account and spending limits.

## First useful task

> Use galleon-defi-infra to report my available RPC and wallet tools without changing permissions. Use galleon-defi-data to read a public ETH price with its source, timestamp and limitations. Then use lp-analyze to assess this pool: [chain and pool address]. Keep any proposed transaction unsigned.

Boomkin loads only the relevant skills and provider references. It separates infrastructure readiness, data evidence, analysis, planning and execution. It uses Hermes's native memory and scheduling when appropriate; a scheduled task retains the same authorization and freshness requirements as an interactive task.

`doctor` reports configuration and installed versions. `doctor --live` additionally verifies keyless CoinGecko MCP initialization and tool discovery, plus credential-free AIXBT discovery when connected. Neither is proof of a successful model response, authenticated paid data, wallet authority or an executed transaction. Use the data pack's public diagnostic for a first market observation, and the infrastructure pack's RPC diagnostic for a configured chain.

## Updates and recovery

```bash
bun run boomkin check --directory "$HOME/.boomkin/hermes"
bun run boomkin update --directory "$HOME/.boomkin/hermes"
bun run boomkin doctor --live
bun run boomkin start
```

Pull this repo and run `bun install --frozen-lockfile` when updating Boomkin itself. `update` refreshes the reviewed skill catalog, not the Hermes runtime. Use native Hermes updates separately and rerun the readiness checks afterward. The reviewed runtime pin and installer checksum are in [src/hermes.ts](src/hermes.ts).

Onboarding can be rerun after a failed install or interrupted login. Completed skill installs and existing instructions remain intact. Review any reported operation lock before removing it. Provider failure does not change the approved route or cause an automatic retry of a financial action.

See [updates and recovery](docs/UPDATES.md) for pack selection, backups and troubleshooting. Keep credentials, private evidence and generated profiles outside this repository.

## Contributing

Bug reports, clearer guides, new workflows and focused pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the checks relevant to your change. Report a reproducible problem in [GitHub Issues](https://github.com/galleonlabs/boomkin/issues); use [private reporting](SECURITY.md) for security concerns.

### Local development

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run smoke
```

The compatibility smoke checks fresh setup/update and independent pack selection. [Native Hermes smoke](scripts/hermes-native-smoke.py) additionally checks the actual runtime's profile, SOUL, MCP configuration and tool filtering in a temporary home, using a local mock MCP. `--public` adds a keyless CoinGecko discovery check. No model or wallet action is part of these checks.

Built by [Galleon Labs](https://galleonlabs.io). [MIT licensed](LICENSE).
