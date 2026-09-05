# Choose a harness

Boomkin supplies the crypto skill catalog and setup/update commands. The upstream
harness owns models, authentication, tools, chat, memory, permissions, and hosting.
Install the runtime from its official source; Boomkin does not vendor it.

## Hermes

[Install Hermes](https://hermes-agent.nousresearch.com/docs/getting-started/installation/)
using its upstream installer, then create a dedicated profile directory:

```bash
HERMES_HOME="$HOME/boomkin" hermes setup
# From your Boomkin checkout:
bun run boomkin setup --harness hermes --directory "$HOME/boomkin"
HERMES_HOME="$HOME/boomkin" hermes
```

Keep `HERMES_HOME` set on every launch, including a gateway/service. Boomkin passes it
through to the skill installer, which writes to that profile's `skills/` directory.
Follow [Hermes gateway documentation](https://hermes-agent.nousresearch.com/docs/)
for persistent operation. Credentials and service management remain with Hermes.

## Eve

[Create an upstream Eve project](https://vercel.com/eve):

```bash
bunx eve@latest init "$HOME/boomkin-eve"
# From your Boomkin checkout:
bun run boomkin setup --harness eve --directory "$HOME/boomkin-eve"
cd "$HOME/boomkin-eve"
bunx eve dev
# When ready to deploy using your Vercel account:
bunx eve deploy
```

Skills are copied into `agent/skills/`, including their references and scripts.
Existing `agent/instructions.md` is preserved: merge [the Boomkin identity](IDENTITY.md)
into it. Update skills before building/deploying; an existing cloud deployment does
not change when local files change. Redeploy through Eve after reviewing updates.

## OpenClaw

[Install and onboard OpenClaw](https://docs.openclaw.ai/start/getting-started).
Use the actual workspace selected during onboarding:

```bash
openclaw onboard
# From your Boomkin checkout (change the path if your workspace differs):
bun run boomkin setup --harness openclaw --directory "$HOME/.openclaw/workspace"
openclaw skills list
```

Boomkin uses workspace `skills/`, not shared global skills. Preserve your existing
`AGENTS.md`; merge the identity if wanted. Follow upstream guidance for a gateway
or remote deployment. Skills alone do not configure an exchange connection.

## Codex, Claude Code, and OpenCode

Install/sign in using the native upstream installer, then:

```bash
bun run boomkin setup --harness codex --directory "$HOME/boomkin-codex"
bun run boomkin setup --harness claude --directory "$HOME/boomkin-claude"
bun run boomkin setup --harness opencode --directory "$HOME/boomkin-opencode"
```

Launch the corresponding agent from its directory. Codex and OpenCode use
`.agents/skills/`; Claude Code uses `.claude/skills/`.

## Support contract

These adapters install the same upstream Agent Skills files in each harness's
documented discovery location. They do not promise identical tool availability,
wallet support, or model behaviour. A successful setup proves file installation,
not authenticated model execution or deployment. Ask your agent to use `lp-setup` or `hyperliquid-setup`
and perform the first read-only task before adding tools or credentials.

To support another harness, add its upstream installer agent ID and documented
skill path in `src/core.ts`, then verify a clean install and discovery. Prefer
[the existing Agent Skills installer](https://github.com/vercel-labs/skills) over a
custom installation implementation.
