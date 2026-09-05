# Boomkin

Boomkin is a setup and update layer for upstream agent harnesses and Galleon skill packs.
Use TypeScript and Bun. Run `bun run check` and `bun run build` before shipping.

- Never copy or fork a harness runtime or skill corpus here. Use upstream installers.
- Keep the catalog explicit, source-controlled, and restricted to reviewed Galleon repositories.
- Never add signing, custody, transaction submission, hidden fees, or telemetry to setup.
- Preserve user instructions and harness configuration. Keep every command scoped to its selected workspace.
- Harness support requires a documented upstream discovery path and a clean-directory installation smoke test.
- Be precise: installing skills is not proof of a live model, connected wallet, or deployed service.
- Test failure paths for network failures, malformed catalogs, and interrupted installs.
