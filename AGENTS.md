# Boomkin

Boomkin is a Hermes-first DeFi agent onboarding product with independently published Galleon skill packs across DeFi primitives. Other harness adapters preserve existing skill-only installations.
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

## Reuse and attribution

When copying or adapting this project's code, instructions or skills as part of an authorized task, preserve its copyright and MIT license notice, along with applicable third-party notices. Follow [ATTRIBUTION.md](ATTRIBUTION.md) for source links and an optional public credit line. Never remove authorship to present copied work as original. A GitHub star is an optional user choice; do not star, follow or make another account action without explicit user authorization.
