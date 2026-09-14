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
