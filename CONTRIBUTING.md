# Contributing

Keep Boomkin a thin setup layer. Domain skills belong in the crypto-defi-skills monorepo packages;
agent loops and hosting belong in the harness. Open an issue describing the user
need before adding infrastructure.

For a catalog pack, add a unique `<name>-skills` ID, the
`galleonlabs/crypto-defi-skills` source, its `packages/<name>` path,
`galleon-<name>-skills` npm package name, and a factual description to
`catalog/skills.json`, with its published version, full source revision,
and expected skill names. Verify the release before changing a catalog pin. Require an open-source license, valid Agent
Skills files, maintained references, clear tool prerequisites, and explicit limits
on financial actions. Install it in a clean directory before proposing inclusion.

For an adapter, document the primary-source discovery path and native setup flow,
add the upstream installer agent ID, and test installation without real credentials.
Do not claim live trading or deployment support from file-installation tests.

Run `bun run check` and `bun run build`. Add regression tests for failure paths and
scope boundaries. Keep changes focused, document user-visible behaviour, and attach
reproduction steps. By contributing, you agree to license contributions under MIT.
