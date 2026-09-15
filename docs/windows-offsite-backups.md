# Windows 10 off-site database backups

This process keeps database recovery copies on a Windows 10 computer without
adding an object-storage subscription. The server creates one validated custom
PostgreSQL dump each week. A scheduled PowerShell task starts daily at 09:00
local time and five minutes after the backup computer's user logs on. When the
computer and server are both reachable, it pulls every server snapshot that is
missing locally, verifies all
available snapshots against their SHA-256 manifests, and records a success
receipt on the server.

Application code does not depend on the Windows computer. If it is offline, the
site keeps running and the next scheduled run or logon retries. The production
server keeps 13 weekly snapshots, or about three months. Windows never removes completed
snapshots automatically.

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
DATABASE_BACKUP_RETENTION_COUNT=13
```

Keep that file owned by `root` with mode `0600`.

Install and start the weekly timer:

```bash
cp /opt/colorado-traffic-tracker/deploy/systemd/colorado-traffic-tracker-database-backup.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now colorado-traffic-tracker-database-backup.timer
systemctl start colorado-traffic-tracker-database-backup.service
systemctl status colorado-traffic-tracker-database-backup.service
```

The service is anchored to Sunday at 03:30 in the VPS timezone, with up to ten
minutes of random delay. A delayed or persistent catch-up run does not shift
the next Sunday schedule. A completed dump is not published until `pg_restore`
can read its catalog and its checksum has been written. Retention count `0`
disables server pruning when an operator deliberately wants unlimited server
retention; production uses `13`.

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
- `DestinationDirectory`: a dedicated folder on the one-terabyte drive.

`backup-settings.psd1` is ignored by Git. Do not put the private key, an API
credential, or a password in the repository.

Test one pull manually:

```powershell
.\Sync-ColoradoTrafficBackup.ps1
Get-Content 'D:\ColoradoTrafficTracker\database-backups\last-success.json'
Get-ChildItem 'D:\ColoradoTrafficTracker\database-backups' -Filter '*.dump'
```

Run the synchronization twice. The second run must verify existing copies
without downloading them again. Neither run deletes completed Windows backups.

### Short traffic-range names and migration

Windows names dumps using the actual earliest/latest retained traffic dates in
**America/Denver**, for example `4-9_9-14-26.dump`. These are full snapshots, not
the interval between backups. The range comes from every `polled_at` value in
the dump's `public.traffic_sample` and `public.traffic_sample_archive` COPY data
(the application's combined traffic history). Snapshot and receipt times are
not used to infer coverage. Cross-year ranges include the starting year, e.g.
`12-31-25_1-1-26.dump`. Matching ranges get `-2`, `-3`, etc.; existing files and
reserved pending names are never overwritten.

Install a current PostgreSQL **client** capable of reading the server's dump
format and set optional `PgRestorePath` in the ignored settings to its absolute
`pg_restore.exe` path (otherwise it must be on PATH). No database service is
required. The [official Windows download page](https://www.postgresql.org/download/windows/)
links portable binaries. The reader streams selected COPY data from
[pg_restore's script-output mode](https://www.postgresql.org/docs/current/app-pgrestore.html);
it never executes SQL or connects to a database. Missing, empty, incomplete, or
unsupported traffic data is reported, not given a guessed range. Range extraction
happens once for a newly received or migrated snapshot.

Each short dump has a `.sha256` file naming that actual local dump. Its metadata
is named by canonical identity, e.g. `traffic-20260915T024906Z.dump.receipt.json`.
Metadata retains the local filename, SHA-256, original receipt timestamp/timezone
and provenance, actual traffic range in UTC and Denver dates, and publication
state. Repeated syncs reuse canonical identity without renaming or redownloading.
The VPS receipt still receives the canonical server filename and checksum,
so snapshot-age monitoring is unchanged.

Before upgrading a live checkout, disable its scheduled task and wait for any
running instance to finish. Run sync twice and re-enable/test the existing task
without reinstalling it; preserve its principal and customized time (such as
23:00 local). An exclusive `.sync.lock` prevents overlapping manual and scheduled
runs. Do not delete its empty coordination file.

Checksum-verified canonical-name and former receipt-time files migrate in place,
without full-dump duplication. Original receipt metadata is retained; legacy
filesystem timestamps remain explicitly `filesystem-last-write-estimate`.
Canonical metadata reserves the new name before moving bytes. Interrupted moves
resume with that name, and local checksum manifests are rewritten to match.
Do not manually rename dumps or remove metadata. Update any local
`BASE-ARCHIVE.md` to point to the new name; future snapshots are still full backups.

### Routine catch-up versus full integrity audit

Routine catch-up reads local metadata/manifests and checks sizes and modification
times. It hashes **only snapshots still listed on the server**, plus one-time
migration/publication. It does not rehash the indefinitely retained collection.
Older snapshots absent from the server remain retained but are **not counted as
verified** by routine catch-up. Silent corruption preserving size and mtime
requires the separate full audit below.

Damage or invalid metadata is isolated per snapshot: preserve the affected file,
report its exact name/problem, and continue downloading/verifying unrelated
snapshots. `last-run.json` records problems and exact `verifiedSnapshots`.
A successful server receipt updates `last-success.json`; if other snapshots had
problems, its status is `partial-success`, not an all-clear. The server receives
only the newest snapshot actually verified that run, never a damaged one.
The task exits nonzero after completing useful work when problems need attention.

Run the independent, local-only integrity audit periodically or after a storage
incident. It takes the same lock, checks every completed archive against its
receipt and local manifest, and writes `integrity-report.json`:

```powershell
.\Test-ColoradoTrafficArchive.ps1 -ConfigPath .\backup-settings.psd1
```

It performs no downloads or database restore and never replaces damaged dump
bytes. Preserve failed files for investigation; repair is a separate operator
decision. A checksum audit does not replace a full restore drill. Neither
routine catch-up nor the audit prunes completed Windows backups.

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

The task runs daily at 09:00 local time and five minutes after the current user
logs on. The daily trigger also covers a computer left logged in for weeks.
An unreachable server is treated as a normal offline condition, so no manual
intervention is required; the next scheduled run or logon retries.
A checksum failure, configuration error, or receipt
failure is reported as a task failure.

## 5. What proves success

Every completed cycle provides four pieces of evidence:

1. a `.dump` file in the Windows destination;
2. its matching `.sha256` manifest;
3. `last-success.json` beside the Windows copies;
4. `/var/lib/colorado-traffic-tracker/backups/offsite-last-success` on the VPS.

The external monitoring setup reads the newest verified backup filename from
the VPS receipt and warns when that backup is more than 192 hours old: the
seven-day backup interval plus one day of grace. Re-verifying an older copy does
not reset its age. The systemd backup schedule itself remains anchored to
Sunday 03:30 rather than being calculated from the previous run. Until the
Windows task is operational, leave the off-site-backup monitor disabled so
setup work is not reported as an outage.

At least quarterly, restore a copy into a disposable PostgreSQL database. A
checksum proves that transport did not corrupt the file; a restore drill proves
that the backup can actually recover the application.

## Removing the task

```powershell
Unregister-ScheduledTask -TaskName 'Colorado Traffic Tracker Backup' -Confirm:$false
```

Removing the task does not delete downloaded backups or the SSH key.
