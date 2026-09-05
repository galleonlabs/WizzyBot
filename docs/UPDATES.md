# Hermes-first upgrade

Existing Hermes installations can run `bun run boomkin onboard --directory <existing-home> --all-packs` to explicitly add infrastructure and data. Model setup runs natively unless `--skip-model-setup` is given. Existing SOUL and instructions are preserved. Other harness installations retain their selected packs and skill-only commands.

Boomkin `update` changes skill packs; native Hermes owns runtime upgrades. New onboarding installs the reviewed runtime only when no working Hermes is available. Run `doctor --live` and perform a first task after updating.

# Updates and recovery

## Release channel

Boomkin 0.3.0 uses catalog schema 3. Every pack records its npm release version,
full source commit, monorepo repository, package path, npm package name, and expected
skill names. Installation fetches each unique source commit once, verifies its
revision, then checks each selected package's identity, version, skill metadata,
and path containment. Packages containing symlinks are rejected. Only the selected
package directory and explicit skill names reach `skills@1.5.23`.
All selected sources are verified before installation begins. Temporary checkouts
are removed afterwards. Use `bun run boomkin update` for managed installations:
the upstream installer sees local sources, while Boomkin tracks release provenance.

`setup` uses the catalog in the checkout. `update` fetches the current public Boomkin
catalog, validates it, and installs its pinned revisions. New pack versions enter
this catalog after publication and verification. The catalog can grow independently; updates
install only the saved pack selection. Repeat `--pack` on setup or update to select
the full desired set. First setup without `--pack` chooses all currently listed packs.
Deselected pack files are preserved, not deleted. `--offline-catalog` uses the checked-out catalog instead;
GitHub access is still needed to download the pinned skills.

`check` compares the last successful sync with the current published catalog. If
revisions match, it also checks expected skill files and their declared versions.
This is not a byte-for-byte integrity audit of local edits. `status` lists skills
through the upstream installer. Neither command updates skill files.

## Upgrade from WizzyBot

The repository is now [galleonlabs/boomkin](https://github.com/galleonlabs/boomkin).
Update your existing CLI checkout and saved command scripts:

```bash
git remote set-url origin https://github.com/galleonlabs/boomkin.git
git pull --ff-only
bun install --frozen-lockfile
bun run boomkin update --directory /absolute/path/to/your-existing-workspace
```

Keep your existing workspace path and harness configuration. On setup or update,
Boomkin validates and atomically renames legacy `.wizzy/` state to `.boomkin/`,
retaining its config, installer records, and last successful sync. Read-only commands
and dry runs read legacy state without moving it. If both state directories exist,
or a legacy operation lock remains, resolve the conflict before retrying; Boomkin
never merges or overwrites conflicting state. Do not run the old CLI during migration.
Existing agent instructions are preserved, including a previously customized identity.
Use [the Boomkin identity](IDENTITY.md) when updating those instructions yourself.

Schema 1/2 sync records are rebuilt on a successful update; they cannot be used as
monorepo source catalogs. Legacy configurations without a pack selection retain
the historical LP and Hyperliquid packs, then save that explicit selection; future
catalog additions remain opt-in. Current releases are
LP Skills 0.4.1 and Hyperliquid Skills 0.2.1. No old source repository is required.

### Older skill names

| Previous skill | Current skill |
| --- | --- |
| `lp-research` | `lp-analyze` |
| `lp-operate` | `lp-execute` |
| `hyperliquid-research` | `hyperliquid-analyze` |
| `hyperliquid-operate` | `hyperliquid-execute` |

Both packs add a `*-setup` skill. Saved prompts and agent instructions should use
the new names. Boomkin preserves existing instructions and reports legacy folders;
it does not delete potentially edited skills. Compare those folders with your backup,
then use the upstream `skills remove` command scoped to the actual workspace and
harness. For example, from an Eve workspace, after reviewing local edits:

```bash
/path/to/boomkin/node_modules/.bin/skills remove lp-research lp-operate hyperliquid-research hyperliquid-operate --agent eve
```

For Hermes, set `HERMES_HOME` to the intended profile and use `--global --agent
hermes-agent`. Never remove unrelated skills. Restart the harness after migrating;
rebuild and redeploy an Eve project to update its deployed copy.

## State and failures

- `.boomkin/config.json` binds one harness to one canonical workspace.
- `.boomkin/state/` scopes upstream global update records to that workspace.
- `.boomkin/last-sync.json` records only a fully completed install and its catalog.
- Existing instruction files are preserved; a missing file receives the starter identity.
- Managed skill files can be replaced by the upstream installer. Back up custom edits.
- Removed packs are reported by `check`; their installed files are preserved.

A failed catalog fetch or validation changes no packs. Installation is sequential,
not transactional: one pack may succeed before the next fails. The command exits
nonzero and keeps retry configuration, but leaves the last successful sync record
unchanged. Fix the cause and rerun. A version mismatch also prevents a success record.
The sync record is replaced atomically. If it is corrupt, `check` reports the issue;
`setup` or `update` rebuilds it after a successful installation.

Concurrent Boomkin installs in one workspace are blocked by `.boomkin/operation.lock`.
After a hard crash, verify no installer is running before removing that directory.

## Automatic refresh (opt in)

Boomkin does not register a background service or restart an active session. Review
pack sources before enabling unattended instruction updates. Adapt this cron entry
to your machine, with absolute paths and Git available:

```cron
17 4 * * * cd /home/alice/boomkin && /home/alice/.bun/bin/bun run boomkin update --directory /home/alice/boomkin >> /home/alice/boomkin-updates.log 2>&1
```

Monitor errors. Restart the harness in a maintenance window; redeploy Eve. This
updates the catalog and skills, not the harness or Boomkin CLI. Use their native
update procedures separately.

## Rollback

Before updating, back up the workspace's skills, lockfiles, instructions and `.boomkin/`.
Restore that snapshot with the harness stopped when rollback is required. For a
frozen deployment, retain installed skills and lockfiles in your private deployment
repository, review the diff, and deploy that exact revision. Never commit credentials.
