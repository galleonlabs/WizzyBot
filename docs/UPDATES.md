# Updates and recovery

Keep Boomkin, its skill packs and the Hermes runtime up to date separately. Use the same profile directory you chose during onboarding.

[Onboarding](../README.md#get-started) · [Connections](CONNECTIONS.md) · [Contributing](../CONTRIBUTING.md)

## Everyday updates

From your Boomkin checkout:

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run boomkin check --directory "$HOME/.boomkin/hermes"
bun run boomkin update --directory "$HOME/.boomkin/hermes"
bun run boomkin doctor --live
bun run boomkin start
```

Replace the directory above if you use another profile, and pass it to `doctor` and `start` too. Back up customized skill files before updating; the upstream installer can replace them. Restart an active Hermes session to load changed instructions and tools.

| Component | How it updates |
| --- | --- |
| Boomkin CLI and guides | Pull this repository and install its locked dependencies |
| Selected skill packs | Run `boomkin update` against the chosen profile |
| Hermes runtime | Use Hermes's native update procedure, then rerun `doctor --live` |
| Provider credentials and tools | Use the native setup paths in the [connection guide](CONNECTIONS.md) |

`doctor` checks configuration; `--live` also checks public CoinGecko tool discovery. Confirm a successful first task through Hermes before relying on the updated setup. These checks do not establish wallet or trading authority.

## Select your packs

Fresh onboarding includes all four packs. Updates preserve the saved selection, and future packs are opt-in. Use repeated `--pack` options to set the full desired selection:

```bash
bun run boomkin update --directory "$HOME/.boomkin/hermes" \
  --pack defi-infra-skills --pack defi-data-skills
```

Deselected pack files are preserved so that local edits are not deleted. To include every pack currently in Boomkin's checked-out catalog:

```bash
bun run boomkin onboard --directory "$HOME/.boomkin/hermes" --all-packs
```

Onboarding preserves existing SOUL and instruction files. It opens native model setup unless you pass `--skip-model-setup`. Configurations written before pack selection was recorded retain LP and Hyperliquid until you explicitly expand them.

## Verified releases

The [catalog](../catalog/skills.json) records each pack's npm package, published version, full source commit, package path and expected skills. `setup` and `onboard` use the checked-out catalog; `update` fetches the current public Boomkin catalog. New pins enter that catalog after publication and verification.

Before installation, Boomkin verifies every selected source revision, package identity, version, skill metadata and path containment. Packages containing symlinks are rejected. Only the selected package paths and skill names reach the upstream installer, and temporary source checkouts are removed afterward.

`--offline-catalog` uses the checked-out catalog for an update. It still requires GitHub access to download the pinned sources.

`check` compares the last successful sync with the published catalog and, when the revisions match, checks installed skill names and declared versions. It is not a byte-for-byte audit of local edits. `status` lists installed skills. Neither command updates files.

## Profile files

| Path within the profile | Purpose |
| --- | --- |
| `SOUL.md`, `AGENTS.md` | Agent identity and instructions; existing files are preserved |
| `config.yaml`, `.env` | Native Hermes configuration and secrets |
| `skills/` | Installed skill packs and supporting files |
| `.boomkin/config.json` | Selected packs and the canonical profile/harness binding |
| `.boomkin/state/` | Upstream installer records scoped to this profile |
| `.boomkin/last-sync.json` | Catalog and provenance from the last completed installation |
| `.boomkin/operation.lock` | Prevents concurrent installations in one profile |

Keep profiles, credentials and private observations outside public repositories. Review saved paths and credentials before moving a configured profile.

## Recover an interrupted update

A failed catalog fetch or validation changes no packs. Installation is sequential: one pack may finish before another fails. Boomkin exits with an error, keeps the retry configuration and leaves the last successful sync record unchanged. Fix the reported cause and rerun the command.

A version mismatch also prevents a success record. If the sync record is incomplete, `check` reports it; a successful `setup` or `update` rebuilds it atomically.

After a hard crash, verify that no installer is running before removing `.boomkin/operation.lock`. An existing lock is not permission to interrupt another process.

For renamed skills, follow the [LP update guide](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/lp#updates-and-migration) or [Hyperliquid update guide](https://github.com/galleonlabs/crypto-defi-skills/tree/main/packages/hyperliquid#updates-and-migration). Boomkin reports retired directories and preserves their contents for review.

## Back up and restore

Before updating, back up your profile's skills, lockfiles, instructions, Hermes configuration and `.boomkin/` records. Stop the runtime before restoring a snapshot. Treat backups containing credentials as private.

For a reproducible deployment, retain the reviewed source revisions and installed skill versions. Use the same native deployment procedure after restoring; restoring local files does not change an already running remote agent.

## Scheduled updates

Unattended instruction updates are optional. Review pack sources first, use absolute paths and explicitly select the profile in your scheduler. Monitor failures and restart Hermes during a maintenance window. Boomkin does not create a background service or restart a session automatically.
