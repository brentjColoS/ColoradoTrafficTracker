# Windows 10 off-site database backups

This process keeps database recovery copies on a Windows 10 computer without
adding an object-storage subscription. The server creates one validated custom
PostgreSQL dump each day. A scheduled PowerShell task checks every six hours and
at logon; when the computer and server are both reachable, it pulls the newest
snapshot, verifies its SHA-256 checksum, and records a success receipt on the
server.

Application code does not depend on the Windows computer. If it is offline, the
site keeps running and the task tries again later. The server keeps seven daily
snapshots, while Windows keeps the newest 90 by default.

The platform-neutral server scripts live in `scripts/backups`. The Windows-only
client is deliberately segregated in `operations/windows-backup`.

## 1. Prepare the server

Run these commands as `root` on the VPS:

```bash
adduser --disabled-password --gecos '' ctt-backup
install -d -m 0750 -o root -g ctt-backup /var/backups/colorado-traffic-tracker/database
install -d -m 0750 -o ctt-backup -g ctt-backup /var/lib/colorado-traffic-tracker/backups
chmod 0600 /opt/colorado-traffic-tracker/.env.cloud
chmod +x /opt/colorado-traffic-tracker/scripts/backups/*.sh
```

Create `/etc/colorado-traffic-tracker/database-backup.env`:

```dotenv
DATABASE_BACKUP_READ_GROUP=ctt-backup
DATABASE_BACKUP_RETENTION_COUNT=7
```

Keep that file owned by `root` with mode `0600`.

Install and start the daily timer:

```bash
cp /opt/colorado-traffic-tracker/deploy/systemd/colorado-traffic-tracker-database-backup.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now colorado-traffic-tracker-database-backup.timer
systemctl start colorado-traffic-tracker-database-backup.service
systemctl status colorado-traffic-tracker-database-backup.service
```

The service runs after the 02:15 retention window, at 03:30 with up to ten
minutes of random delay. A completed dump is not published until `pg_restore`
can read its catalog and its checksum has been written.

## 2. Create the restricted backup login

On Windows, install the OpenSSH Client from **Settings > Apps > Optional
features**, then open PowerShell:

```powershell
ssh-keygen.exe -t ed25519 -f "$env:USERPROFILE\.ssh\colorado-traffic-backup" -C 'colorado-traffic-backup'
Get-Content "$env:USERPROFILE\.ssh\colorado-traffic-backup.pub"
```

Copy only the displayed public key. On the server, add it to
`/home/ctt-backup/.ssh/authorized_keys` with the `restrict` option:

```text
restrict ssh-ed25519 AAAA... colorado-traffic-backup
```

Then set ownership and permissions:

```bash
chown -R ctt-backup:ctt-backup /home/ctt-backup/.ssh
chmod 0700 /home/ctt-backup/.ssh
chmod 0600 /home/ctt-backup/.ssh/authorized_keys
```

This account has no Docker or database access. It can read the group-owned dump
files and update only its receipt directory. The key cannot open tunnels,
forward an agent, or allocate a terminal. Keep `.env.cloud` readable only by
`root` as shown above.

## 3. Configure Windows

Keep a checkout of this repository in a stable location. In
`operations\windows-backup`, copy the settings template:

```powershell
Copy-Item .\backup-settings.example.psd1 .\backup-settings.psd1
notepad .\backup-settings.psd1
```

Set these values:

- `RemoteHost`: the VPS hostname or IP address;
- `RemoteUser`: normally `ctt-backup`;
- `RemoteBackupDirectory`: keep the provided server path unless it was changed;
- `RemoteReceiptCommand`: the deployed receipt script path;
- `SshKeyPath`: the private key created above;
- `DestinationDirectory`: a dedicated folder on the one-terabyte drive;
- `MaximumBackups`: the maximum complete dumps to retain locally.

`backup-settings.psd1` is ignored by Git. Do not put the private key, an API
credential, or a password in the repository.

Test one pull manually:

```powershell
.\Sync-ColoradoTrafficBackup.ps1
Get-Content 'D:\ColoradoTrafficTracker\database-backups\last-success.json'
```

The first SSH connection asks you to verify the server fingerprint. Compare it
with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server before
accepting it.

## 4. Register the reconnecting task

From PowerShell in `operations\windows-backup`:

```powershell
.\Install-ColoradoTrafficBackupTask.ps1
Start-ScheduledTask -TaskName 'Colorado Traffic Tracker Backup'
Get-ScheduledTaskInfo -TaskName 'Colorado Traffic Tracker Backup'
```

The task runs at logon and every six hours. An unreachable server is treated as
a normal offline condition, so no manual intervention is required; the next
trigger retries. A checksum failure, configuration error, or receipt failure is
reported as a task failure.

## 5. What proves success

Every completed cycle provides four pieces of evidence:

1. a `.dump` file in the Windows destination;
2. its matching `.sha256` manifest;
3. `last-success.json` beside the Windows copies;
4. `/var/lib/colorado-traffic-tracker/backups/offsite-last-success` on the VPS.

The external monitoring setup reads the VPS receipt and warns only after seven
days without a verified Windows copy. Until the Windows task is operational,
leave the off-site-backup monitor disabled so setup work is not reported as an
outage.

At least quarterly, restore a copy into a disposable PostgreSQL database. A
checksum proves that transport did not corrupt the file; a restore drill proves
that the backup can actually recover the application.

## Removing the task

```powershell
Unregister-ScheduledTask -TaskName 'Colorado Traffic Tracker Backup' -Confirm:$false
```

Removing the task does not delete downloaded backups or the SSH key.
