# Advanced skill-only compatibility

Boomkin's main onboarding product uses Hermes; start with the [getting-started guide](../README.md#get-started). The adapters below preserve portable skill installation in other harnesses and do not provision a complete Boomkin runtime there.

## Choose a harness

Boomkin supplies the crypto skill catalog and setup/update commands. The upstream
harness owns models, authentication, tools, chat, memory, permissions, and hosting.
Install the runtime from its official source; Boomkin does not vendor it.

## Hermes

For a complete Boomkin profile, use native onboarding:

```bash
bun run boomkin onboard --directory "$HOME/boomkin-hermes"
bun run boomkin start --directory "$HOME/boomkin-hermes"
```

To add only the skills to an existing Hermes home:

```bash
bun run boomkin setup --harness hermes --directory "$HOME/your-hermes-profile"
```

Boomkin passes that directory as `HERMES_HOME` to the skill installer, which writes to its `skills/` directory. Use your existing native Hermes launch configuration for that profile. Follow [Hermes gateway documentation](https://hermes-agent.nousresearch.com/docs/) for persistent operation.

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
not authenticated model execution or deployment. Ask your agent to use the installed infrastructure/data or protocol setup skill
and perform the first read-only task before adding tools or credentials. Choose only
the needed packs with repeated `--pack` flags; saved selections remain unchanged
when the reviewed catalog grows.

To support another harness, add its upstream installer agent ID and documented
skill path in `src/core.ts`, then verify a clean install and discovery. Prefer
[the existing Agent Skills installer](https://github.com/vercel-labs/skills) over a
custom installation implementation.
