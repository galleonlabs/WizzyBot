# Boomkin

Boomkin is a Hermes-first DeFi agent onboarding product with four independent Galleon skill packs. Other harness adapters preserve existing skill-only installations.
Use TypeScript and Bun. Run `bun run check` and `bun run build` before shipping.

- Never copy or fork a harness runtime or skill corpus here. Use upstream installers.
- Keep the catalog explicit, source-controlled, and restricted to reviewed Galleon repositories.
- Never add signing, custody, transaction submission, hidden fees, or telemetry to setup.
- Preserve user instructions and harness configuration. Keep every command scoped to its selected workspace.
- Harness support requires a documented upstream discovery path and a clean-directory installation smoke test.
- Be precise: installing skills is not proof of a live model, connected wallet, or deployed service.
- Test failure paths for network failures, malformed catalogs, and interrupted installs.

- Use native Hermes setup, profiles, SOUL, MCP, model authentication and agent loop. No runtime fork.
- Keep default data connections keyless; optional provider OAuth, wallet credentials and spending choices stay explicit.
- Test against the pinned native Hermes contract with scripts/hermes-native-smoke.py; no model or financial action belongs in validation.
