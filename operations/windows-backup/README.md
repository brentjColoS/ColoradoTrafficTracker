# Windows backup client

This directory contains only the Windows 10 side of the off-site database
backup process. Copy `backup-settings.example.psd1` to `backup-settings.psd1`
and follow the complete setup in
[Windows off-site backups](../../docs/windows-offsite-backups.md).

The real settings file, private keys, downloaded dumps, partial downloads, and
status files must remain outside Git.

The client catches up every server dump missing locally, verifies existing
copies again, and never deletes completed Windows backups. Its scheduled task
runs daily at 09:00 local time and five minutes after the current user logs on.

Dump names show actual retained traffic dates in Denver, e.g. `4-9_9-14-26.dump`;
matching ranges use numeric suffixes. A local `.sha256` names the short dump,
while canonical `traffic-...dump.receipt.json` metadata retains server identity,
receipt details, and data range. Set `PgRestorePath` to a current PostgreSQL
client; no database service is needed. Existing files migrate in place after
checksum verification. Interrupted publication resumes without new names.

Routine catch-up hashes only server-listed snapshots, not all indefinite history.
Damaged files are preserved and reported in `last-run.json` without blocking
unrelated downloads. Only actually verified snapshots enter the server receipt
and verified list. Run `Test-ColoradoTrafficArchive.ps1` separately for a full,
local-only integrity audit. Neither operation prunes completed backups.

For an existing installation, preserve its customized schedule and principal;
pause the task while upgrading/migrating and re-enable it afterwards, rather
than reinstalling it. See the migration precautions in the full guide.

Run `powershell.exe -NoProfile -File .\Test-Sync-ColoradoTrafficBackup.ps1` for
offline tests of receipt names, migration/recovery, locking, and mocked transfers.
