# Contributing to Boomkin

Bug reports, documentation improvements, provider fixes and focused pull requests are welcome. You do not need a funded wallet or a paid model account to work on Boomkin.

[Get started](README.md#get-started) · [Report a bug](https://github.com/galleonlabs/boomkin/issues) · [Security policy](SECURITY.md)

## Find the right home

Boomkin handles onboarding, profiles and verified skill installation. Protocol knowledge belongs in [crypto-defi-skills](https://github.com/galleonlabs/crypto-defi-skills); Hermes owns the agent loop, model adapters, memory and scheduling.

For a larger addition, open an issue describing the user need and proposed scope. Small fixes and clearer documentation can go straight to a pull request.

## Work locally

Use Bun 1.3.12 and Git:

```bash
git clone https://github.com/galleonlabs/boomkin.git
cd boomkin
bun install --frozen-lockfile
bun run check
bun run build
```

| Change | Additional validation |
| --- | --- |
| Installer, catalog or harness adapter | `bun run smoke` checks fresh installs, updates and independent pack selection |
| Native Hermes integration | Run `scripts/hermes-native-smoke.py --hermes /absolute/path/to/hermes` with Python; CI exercises the reviewed runtime |
| Documentation | Check commands against CLI help, relative links and the rendered Markdown |

The native smoke uses a temporary profile and local mock MCP. Its optional `--public` flag adds keyless CoinGecko discovery. Validation must not authenticate paid services, call a model, create a wallet or submit a financial action.

## Add or update a skill pack

Update [catalog/skills.json](catalog/skills.json) with the published npm identity and version, immutable monorepo source revision, package path and expected skills. Follow the existing entries, including the foundation packs' distinct package and skill names.

Verify the public release and a clean installation before proposing a pin. Packs need an open-source license, valid Agent Skills files, self-contained references, documented prerequisites and explicit limits on financial actions. Keep each pack independently selectable.

## Add a provider or harness

Reuse official tools and native authentication. Document the primary source, supported versions, configuration location and permission scope. For a harness adapter, include its upstream installer agent ID and verified discovery directory.

Use fixtures or temporary profiles to exercise failures without real credentials. Preserve user instructions and unrelated settings. File installation, tool discovery, authenticated access and transaction execution are different outcomes; report only what the checks establish.

## Send a pull request

Describe the user-visible change, why it is needed and the checks you ran. For a bug, include a small reproduction and expected behavior. Add regression coverage when behavior or a failure boundary changes; documentation fixes need proportionate checks.

Keep secrets, private profiles and generated artifacts out of commits. Report vulnerabilities through the [security policy](SECURITY.md), rather than a public issue.

Boomkin is [MIT licensed](LICENSE). Contributions are provided under the same license.

## Credit and reuse

Retain existing authorship and license notices in contributions and derived work. [ATTRIBUTION.md](ATTRIBUTION.md) explains MIT notice requirements and offers an optional visible credit line.
