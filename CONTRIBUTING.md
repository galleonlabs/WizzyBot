# Contributing

Keep WizzyBot a thin setup layer. Domain skills belong in their upstream repositories;
agent loops and hosting belong in the harness. Open an issue describing the user
need before adding infrastructure.

For a catalog pack, add a unique ID, matching `galleonlabs/<id>` source, and factual
description to `catalog/skills.json`. Require an open-source license, valid Agent
Skills files, maintained references, clear tool prerequisites, and explicit limits
on financial actions. Install it in a clean directory before proposing inclusion.

For an adapter, document the primary-source discovery path and native setup flow,
add the upstream installer agent ID, and test installation without real credentials.
Do not claim live trading or deployment support from file-installation tests.

Run `bun run check` and `bun run build`. Add regression tests for failure paths and
scope boundaries. Keep changes focused, document user-visible behaviour, and attach
reproduction steps. By contributing, you agree to license contributions under MIT.
