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

Received dumps use local receipt-time filenames with an explicit UTC offset and
the original snapshot identity. Keep each dump, local-name `.sha256` manifest,
and `.receipt.json` together. Existing old-name dumps are checksum-verified and
renamed in place using last-write-time estimates; completed backups are retained
indefinitely, even after server pruning. Interrupted publication resumes using
the saved receipt. The server still receives the canonical snapshot filename.

For an existing installation, preserve its customized schedule and principal;
pause the task while upgrading/migrating and re-enable it afterwards, rather
than reinstalling it. See the migration precautions in the full guide.

Run `powershell.exe -NoProfile -File .\Test-Sync-ColoradoTrafficBackup.ps1` for
offline tests of receipt names, migration/recovery, locking, and mocked transfers.
