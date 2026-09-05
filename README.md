# Boomkin

**An open-source crypto agent for research, trading, and DeFi.**

Your harness runs the agent. Galleon skills give it the domain knowledge.
Boomkin brings them together and keeps the skill catalog current. The name nods to the
moonkin meme; the project is an independent Galleon Labs agent setup layer.

[![CI](https://github.com/galleonlabs/boomkin/actions/workflows/ci.yml/badge.svg)](https://github.com/galleonlabs/boomkin/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Get started

You need [Bun](https://bun.sh), Git, and an agent harness.

```bash
git clone https://github.com/galleonlabs/boomkin.git
cd boomkin
bun install --frozen-lockfile
bun run boomkin harnesses
```

Choose [Hermes, Eve, OpenClaw, Codex, Claude Code, or OpenCode](docs/HARNESSES.md).
Complete its native setup, then install the skills. For a dedicated Hermes profile:

```bash
HERMES_HOME="$HOME/boomkin" hermes setup
bun run boomkin setup --harness hermes --directory "$HOME/boomkin"
HERMES_HOME="$HOME/boomkin" hermes
```

Use `--dry-run` to preview an installation. No model account, wallet, or paid hosting
is required to install skills. Running the harness may incur provider costs.

## What can Boomkin help with?

- Compare liquidity pools and make a sourced research case.
- Plan Uniswap and Aerodrome positions with explicit assumptions and risk limits.
- Inspect Hyperliquid positions, funding, orders, and exposure using connected tools.
- Prepare trade plans, monitor positions, and review completed activity.
- Build and review integrations with the same operational guidance.

Start with a prompt such as:

> Use lp-analyze to compare these two pools. Separate verified facts from missing
> data, explain the risks, and give me a plan to review before I commit capital.

Skills guide the agent; they do not provide live market data or a signer by
themselves. Connect tools through your harness. Financial actions require explicit
authority and a suitable execution tool. Boomkin has no custody or transaction code.

## The catalog

| Pack | Version | Coverage | Source |
| --- | --- | --- | --- |
| LP Skills | 0.4.1 | Setup, analysis, planning, execution, monitoring, engineering | [lp-skills](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/lp) |
| Hyperliquid Skills | 0.2.1 | Setup, analysis, planning, execution, monitoring, performance review, engineering | [hyperliquid-skills](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/hyperliquid) |

The catalog contains 13 skills across these two packs. Start with `lp-setup` or
`hyperliquid-setup` to discover your agent's tools and complete its first read.
New published versions and reviewed packs are added to
[`catalog/skills.json`](catalog/skills.json). The corpora live in the modular
[crypto-defi-skills monorepo](https://github.com/galleonlabs/crypto-defi-skills),
with independently versioned npm packages (`galleon-lp-skills` and
`galleon-hyperliquid-skills`).

Install only what you need, or omit `--pack` at first setup to install both:

```bash
bun run boomkin setup --harness codex --directory "$HOME/boomkin-codex" --pack lp-skills
# Add another pack by naming the full desired selection:
bun run boomkin update --directory "$HOME/boomkin-codex" --pack lp-skills --pack hyperliquid-skills
```

Updates preserve your saved selection. Newly added catalog packs are opt-in.
Changing the selection preserves deselected skill files; review local edits before
removing them with your harness or the upstream skills CLI.

## Stay current

```bash
bun run boomkin check --directory "$HOME/boomkin"
bun run boomkin update --directory "$HOME/boomkin"
bun run boomkin status --directory "$HOME/boomkin"
```

`update` fetches the current Boomkin catalog, then installs each published version
from a temporary checkout of its exact recorded commit through the pinned
[Agent Skills CLI](https://github.com/vercel-labs/skills). The catalog records versions,
revisions, package paths, package identities, and expected skill names. Setup verifies
each checkout and its selected package metadata before installation,
then checks installed skill versions before recording success.
`check` compares your last successful sync with the current release catalog.

Existing installations migrate their saved state to Boomkin. Existing instructions
are preserved. If upgrading older skill releases, replace `*-research` with
`*-analyze` and `*-operate` with `*-execute` in saved prompts, and review old skill
folders using the [migration guide](docs/UPDATES.md).
Updates are explicit. For automatic refresh, schedule the same command using your
own [cron or systemd setup](docs/UPDATES.md). Restart the harness afterwards; redeploy
Eve projects. Update Boomkin itself with `git pull --ff-only && bun install --frozen-lockfile`.

## How it fits together

```text
Boomkin                 Upstream harness              crypto-defi-skills
catalog + setup/update → Hermes / Eve / OpenClaw …  ←  LP + Hyperliquid + future packs
                         models, tools, memory,
                         permissions, deployment
```

Boomkin contains no agent loop, copied harness, vendored skill corpus, exchange
adapter, signer, or hosted trading service. Harness releases remain upstream.
There is no required Boomkin account, subscription, platform fee, or token.

## Contribute

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

See [contributing](CONTRIBUTING.md), [harness support](docs/HARNESSES.md),
[update behaviour and recovery](docs/UPDATES.md), and [security](SECURITY.md).
Propose a pack or adapter through an issue or pull request. Improve domain guidance
in the corresponding monorepo package so every consumer benefits.

Built by [Galleon Labs](https://galleonlabs.io). MIT licensed.
