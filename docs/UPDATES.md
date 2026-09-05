# Updates and recovery

## Release channel

WizzyBot 0.2.0 uses catalog schema 2. Every pack records its npm release version,
full source commit, source repository, and expected skill names. Installation uses
a temporary checkout of that exact commit, verifies its revision, then passes the
local checkout to `skills@1.5.23`. All sources are verified before any installation
begins. Moving tags or branches cannot change the selected revision. Temporary
checkouts are removed afterwards; trust still rests with the source repository
and installer. Use `wizzy update` to refresh these managed installations: the
upstream installer sees local sources, while Wizzy tracks their release provenance.

`setup` uses the catalog in the checkout. `update` fetches the current public Wizzy
catalog, validates it, and installs its pinned revisions. New pack versions enter
this catalog after publication and verification. It can grow without users editing
workspace configuration. `--offline-catalog` uses the checked-out catalog instead;
GitHub access is still needed to download the pinned skills.

`check` compares the last successful sync with the current published catalog. If
revisions match, it also checks expected skill files and their declared versions.
This is not a byte-for-byte integrity audit of local edits. `status` lists skills
through the upstream installer. Neither command updates skill files.

## Upgrade from WizzyBot 0.1.0

Update the CLI first:

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run wizzy update --directory "$HOME/wizzy"
```

Old CLI copies reject schema 2 rather than silently interpreting release pins as
branch-head installs. Existing `.wizzy/config.json` stays compatible. A successful
update writes the new versioned sync record. Current releases are LP Skills 0.4.0
and Hyperliquid Skills 0.2.0.

| Previous skill | Current skill |
| --- | --- |
| `lp-research` | `lp-analyze` |
| `lp-operate` | `lp-execute` |
| `hyperliquid-research` | `hyperliquid-analyze` |
| `hyperliquid-operate` | `hyperliquid-execute` |

Both packs add a `*-setup` skill. Saved prompts and agent instructions should use
the new names. Wizzy preserves existing instructions and reports legacy folders;
it does not delete potentially edited skills. Compare those folders with your backup,
then use the upstream `skills remove` command scoped to the actual workspace and
harness. For example, from an Eve workspace, after reviewing local edits:

```bash
/path/to/WizzyBot/node_modules/.bin/skills remove lp-research lp-operate hyperliquid-research hyperliquid-operate --agent eve
```

For Hermes, set `HERMES_HOME` to the intended profile and use `--global --agent
hermes-agent`. Never remove unrelated skills. Restart the harness after migrating;
rebuild and redeploy an Eve project to update its deployed copy.

## State and failures

- `.wizzy/config.json` binds one harness to one canonical workspace.
- `.wizzy/state/` scopes upstream global update records to that workspace.
- `.wizzy/last-sync.json` records only a fully completed install and its catalog.
- Existing instruction files are preserved; a missing file receives the starter identity.
- Managed skill files can be replaced by the upstream installer. Back up custom edits.
- Removed packs are reported by `check`; their installed files are preserved.

A failed catalog fetch or validation changes no packs. Installation is sequential,
not transactional: one pack may succeed before the next fails. The command exits
nonzero and keeps retry configuration, but leaves the last successful sync record
unchanged. Fix the cause and rerun. A version mismatch also prevents a success record.
The sync record is replaced atomically. If it is corrupt, `check` reports the issue;
`setup` or `update` rebuilds it after a successful installation.

Concurrent Wizzy installs in one workspace are blocked by `.wizzy/operation.lock`.
After a hard crash, verify no installer is running before removing that directory.

## Automatic refresh (opt in)

Wizzy does not register a background service or restart an active session. Review
pack sources before enabling unattended instruction updates. Adapt this cron entry
to your machine, with absolute paths and Git available:

```cron
17 4 * * * cd /home/alice/WizzyBot && /home/alice/.bun/bin/bun run wizzy update --directory /home/alice/wizzy >> /home/alice/wizzy-updates.log 2>&1
```

Monitor errors. Restart the harness in a maintenance window; redeploy Eve. This
updates the catalog and skills, not the harness or Wizzy CLI. Use their native
update procedures separately.

## Rollback

Before updating, back up the workspace's skills, lockfiles, instructions and `.wizzy/`.
Restore that snapshot with the harness stopped when rollback is required. For a
frozen deployment, retain installed skills and lockfiles in your private deployment
repository, review the diff, and deploy that exact revision. Never commit credentials.
