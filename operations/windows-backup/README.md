# Windows backup client

This directory contains only the Windows 10 side of the off-site database
backup process. Copy `backup-settings.example.psd1` to `backup-settings.psd1`
and follow the complete setup in
[Windows off-site backups](../../docs/windows-offsite-backups.md).

The real settings file, private keys, downloaded dumps, partial downloads, and
status files must remain outside Git.
