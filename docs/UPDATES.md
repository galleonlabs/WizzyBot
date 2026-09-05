# Updates and recovery

`setup` installs the catalog bundled with the checkout. `update` fetches the latest
catalog from `galleonlabs/WizzyBot` main, validates its schema and explicit Galleon
repository allowlist, and reinstalls each pack from its default branch. Both use
`skills@1.5.23`, pinned in the Bun lockfile, with copies suitable for deployment.
No pack install scripts or runtime binaries are executed by Wizzy.

The catalog is curated, not an automatic scan of all organisation repositories.
It can grow without users changing their configuration. A network failure or
invalid catalog fails before any pack is changed. `--offline-catalog` deliberately
uses the checked-out catalog instead; upstream Git access is still required.

## What changes

- All skills in every current catalog pack are refreshed, including new skills.
- Upstream installer lockfiles track sources and hashes. Do not edit them manually.
- `.wizzy/config.json` binds one harness to one canonical workspace.
- `.wizzy/last-sync.json` records the last fully completed catalog refresh.
- Existing agent instructions are preserved. The identity is written only if absent.
- Managed skill files can be replaced. Keep custom skills under different names;
  contribute pack edits upstream or back up local changes before updating.
- Removed packs/skills are not automatically deleted. Review and remove obsolete
  entries with the upstream `skills remove` command after backing up local edits.

`check` delegates to upstream `skills check`, which can also report other skills in
its project/global lockfiles. It checks installed sources; run `update` to discover
new catalog packs. It is informational and does not modify installed files.

Updates are sequential, not transactional. If the second pack fails, the first may
already be updated. The command exits nonzero, preserves retry configuration, and
does not write a new success record. Fix the cause and rerun. Concurrent Wizzy
installs in one directory are blocked by `.wizzy/operation.lock`; after a hard crash,
confirm no installer is running before removing that directory.

## Automatic refresh (opt in)

An agent's instructions are executable influence. Review the sources before opting
into unattended changes. Wizzy does not register a service or restart an active
trading session for you.

A daily cron entry, with absolute paths adapted to your machine:

```cron
17 4 * * * cd /home/alice/WizzyBot && /home/alice/.bun/bin/bun run wizzy update --directory /home/alice/wizzy >> /home/alice/wizzy-updates.log 2>&1
```

Make Git and Bun available to cron. Monitor failures. Restart your harness in a
maintenance window; rebuild/redeploy Eve. This updates skills and the catalog,
not the harness or Wizzy CLI. Use each project's native update procedure for those.

## Reproduce or roll back

Before an update, back up the harness workspace including skills, upstream
lockfiles, and `.wizzy/`. Restore that snapshot with the harness stopped if needed.
A catalog snapshot does not pin skill revisions: source heads can advance. For a
frozen deployment, retain the installed skill files and lockfile in your own private
deployment repository, review the diff, and deploy that exact revision. Do not
commit credentials. Wizzy does not silently switch an existing deployment.
