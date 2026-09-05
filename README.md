# Wizzy

**An open-source crypto agent for research, trading, and DeFi.**

Your harness runs the agent. Galleon skills give it the domain knowledge.
WizzyBot brings them together and keeps the skill catalog current.

[![CI](https://github.com/galleonlabs/WizzyBot/actions/workflows/ci.yml/badge.svg)](https://github.com/galleonlabs/WizzyBot/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Get started

You need [Bun](https://bun.sh), Git, and an agent harness.

```bash
git clone https://github.com/galleonlabs/WizzyBot.git
cd WizzyBot
bun install --frozen-lockfile
bun run wizzy harnesses
```

Choose [Hermes, Eve, OpenClaw, Codex, Claude Code, or OpenCode](docs/HARNESSES.md).
Complete its native setup, then install the skills. For a dedicated Hermes profile:

```bash
HERMES_HOME="$HOME/wizzy" hermes setup
bun run wizzy setup --harness hermes --directory "$HOME/wizzy"
HERMES_HOME="$HOME/wizzy" hermes
```

Use `--dry-run` to preview an installation. No model account, wallet, or paid hosting
is required to install skills. Running the harness may incur provider costs.

## What can Wizzy help with?

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
authority and a suitable execution tool. WizzyBot has no custody or transaction code.

## The catalog

| Pack | Version | Coverage | Source |
| --- | --- | --- | --- |
| LP Skills | 0.4.0 | Setup, analysis, planning, execution, monitoring, engineering | [lp-skills](https://github.com/galleonlabs/lp-skills) |
| Hyperliquid Skills | 0.2.0 | Setup, analysis, planning, execution, monitoring, performance review, engineering | [hyperliquid-skills](https://github.com/galleonlabs/hyperliquid-skills) |

The catalog contains 13 skills across these two packs. Start with `lp-setup` or
`hyperliquid-setup` to discover your agent's tools and complete its first read.
New published versions and reviewed packs are added to
[`catalog/skills.json`](catalog/skills.json). The corpora stay in their own repositories.

## Stay current

```bash
bun run wizzy check --directory "$HOME/wizzy"
bun run wizzy update --directory "$HOME/wizzy"
bun run wizzy status --directory "$HOME/wizzy"
```

`update` fetches the current Wizzy catalog, then installs each published version
from a temporary checkout of its exact recorded commit through the pinned
[Agent Skills CLI](https://github.com/vercel-labs/skills). The catalog records versions,
revisions, and expected skill names. Setup verifies each checkout before installation,
then checks installed skill versions before recording success.
`check` compares your last successful sync with the current release catalog.

This release renames `*-research` to `*-analyze` and `*-operate` to `*-execute`.
Existing instructions are preserved; update saved prompts and review old skill
folders using the [migration guide](docs/UPDATES.md).
Updates are explicit. For automatic refresh, schedule the same command using your
own [cron or systemd setup](docs/UPDATES.md). Restart the harness afterwards; redeploy
Eve projects. Update WizzyBot itself with `git pull --ff-only && bun install --frozen-lockfile`.

## How it fits together

```text
WizzyBot                 Upstream harness              Galleon skill repos
catalog + setup/update → Hermes / Eve / OpenClaw …  ←  LP + Hyperliquid + future packs
                         models, tools, memory,
                         permissions, deployment
```

WizzyBot contains no agent loop, copied harness, vendored skill corpus, exchange
adapter, signer, or hosted trading service. Harness releases remain upstream.
There is no required Wizzy account, subscription, platform fee, or token.

## Contribute

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

See [contributing](CONTRIBUTING.md), [harness support](docs/HARNESSES.md),
[update behaviour and recovery](docs/UPDATES.md), and [security](SECURITY.md).
Propose a pack or adapter through an issue or pull request. Improve domain guidance
in the corresponding skill repository so every consumer benefits.

Built by [Galleon Labs](https://galleonlabs.io). MIT licensed.
