# Private visitor observatory

An operator-only journey feed for a low-volume site: entry source, page path,
named button actions, approximate device/browser/OS families and viewport.
This is not session replay, verified time on page, a recruiter identifier or a
count of unique people. Location is **Not resolved**; no GeoIP is connected.
Browser reports can be forged, blocked or lost; a bot can run JavaScript.

## Collection boundary

This production topic explicitly activates collection on the four /dashboard/
HTML pages with a /visitor-events marker. The lightweight script does nothing
without an exact supported marker/path pair. The existing experimental deployment
is unchanged: its page path does not match the production marker. Public intake
accepts only the configured --collection-scope; production and experimental
session identifiers and database scopes cannot mix. Use a separate file for each.
The operator viewer/database remain outside Spring's public assets, PostgreSQL and
provider schedules. Nothing here installs services or proxy routes automatically.

Enabled collection records page entries and fixed names for corridor/range/view
changes, zone finder, history navigation buttons/toggle, incident expansion,
reference band, manual sync, theme, API examples and public navigation.
See collector.py for the allowlist. Graph gestures are not instrumented.
No typed text, full URLs/query strings, mouse movement, scroll coordinates,
cookies, authorization, exact browser versions, hardware fingerprints or replay.

The only opt-out inputs are browser requests: **Global Privacy Control and
Do Not Track**. The client discards its queue/session for either; the server
independently skips Sec-GPC: 1 and DNT: 1/yes. No visible privacy toggle, prompt
or banner. About the Data has an informational disclosure, not a control.
Denied session storage stops collection, without fingerprinting fallback or
attempts to evade blocking.

One first-party session in sessionStorage spans same-tab navigation and rotates
after 30 minutes idle or 24 hours. Events batch after five seconds (up to 20),
with a final navigation/page-hide beacon. Failure stops that page's collector,
without retries or delaying the UI. This is best-effort, not an audit log.
No polling or provider reads are added.

## Sources, Home and reporting

Source links lists ?src=resume|linkedin|github|portfolio entry URLs.
source-links.js captures only those tags and removes src using replaceState,
preserving other parameters/hash/history without reload. Initial requests,
hyperlinks and network tools can still see the tag: this is address-bar cleanup,
not concealment. Enabled collection retains the entry label across the session;
only the external referrer hostname survives, not its path or query.

Home uses the server-observed IP, never a client-submitted address. Locally this
is 127.0.0.1, not your public home address. Marking moves matching retained
sessions to Home, including IP-redacted history; unmarking restores classification
without deletion. Home wins over bots and is excluded from External. Shared
NAT/VPNs can exclude other people; changed home addresses must be marked again.
At most 16 Home addresses are saved; remove an old saved address from the panel
before adding another. Removal changes classification only, never visit history.

All time (days=0) is a filter, not a retention policy. The server returns **25 visits
per page** and up to the latest 60 events per visit, with a truncation note.
Older visits remain reachable with Older visits; Newest visits resets the cursor.
Signed cursors bind the filters and freeze the collected result set at its first
request, including against later backdated events. Refresh starts a new snapshot.
Changing Home classification during pagination also requires a fresh snapshot.
Totals cover the matching time period; source/page summaries and text search cover
only the current page. Last event is not an exit. The viewer refreshes on demand, uses local
Archivo/IBM Plex Mono fonts with SIL licenses in web/fonts, and shares the
dashboard theme preference.

The UI and its data are fetched only when the operator opens it. There is no
operator preload, background refresh, adjacent-page prefetch or retained browser
history cache. Pagination replaces the current page rather than accumulating it.
Public event intake is separate: it can save events while the viewer is closed.

## Storage and access

- Collected event payloads use authenticated Fernet encryption and an external
  owner-only key. IP, page/action, source, browser and viewport are encrypted.
  SQLite structure, indexed times/daily buckets/keyed opaque IDs and saved Home
  configuration are not encrypted. This is payload, not whole-disk encryption.
- The key derives separate keyed index identities. Wrong keys or changed
  authenticated metadata fail closed. Never replace the key over existing data.
  There is no recovery backdoor; restrict the entire state directory.
- Reads mask raw IPs older than 24 hours immediately. The hourly redaction timer
  removes them from encrypted payloads in resumable batches of 200 (normally up
  to one additional hour). A 55-second maintenance budget saves its position for
  the next run; overdue maintenance appears in private status. History remains
  until deliberately removed. Proxy logs, copies and backups have separate
  protection/retention; old backups may still contain encrypted raw IPs.
- Deployed collection requires HTTPS, operator CIDRs and validated proxy forwarding.
  The selected --operator-ip-only mode requires exact globally routable /32 or /128
  host addresses; it refuses empty, private or broad allowlists. All operator
  HTML/assets/data/Home actions are protected at Caddy and the application. This
  identifies a network, not a person: anyone sharing that public IP has access.
  An address change requires an operator update over SSH; never widen automatically.
  Password authentication remains available when --operator-ip-only is omitted.
  Home writes also require exact Origin and action token. Responses are
  no-store/noindex/frame-denied.
- Public intake is write-only, exact-origin, no CORS, strict allowlisted JSON.
  Bounds: 16 KiB/request, 20 events/batch, 60 batches/IP/minute, 600 total/minute,
  500 events/session, 16 concurrent connections and a 3-second socket timeout.
  SQLite enforces a 256 MiB main-file page limit inside serialized writes, without
  deleting history. Transactions roll back whole batches at capacity. Review disk
  use before raising this limit. Rollback journals and private backups use separate
  disk space; reserve headroom, not just the main-file allowance.
- Records live in a dedicated **VPS SQLite file**, not browser storage or traffic
  PostgreSQL. The browser holds only the current response and short-lived public
  session identifier; no collected visit history is saved in local/session storage.
  Server reads aggregate indexed metadata in SQLite and decrypt only one bounded
  page. Limits: two simultaneous snapshots, five seconds per query, 1 MiB SQLite
  cache per connection, disk-backed temporary sorting and no mmap. The service
  example caps resident work at 96 MiB with 50% CPU. Maintenance uses a separate
  96 MiB / 25% CPU allowance. These are operator safeguards, not high-volume
  analytics guarantees; broad queries may return a retryable error at their budget.
- The backend binds loopback only. The proxy must overwrite X-Visitor-Client-IP
  from its verified connection address, not client-supplied forwarded headers.
  Missing, repeated or malformed verified-address headers are denied. The loopback
  backend trusts local processes; do not expose its port or give untrusted local
  accounts access. The example assumes direct traffic to Caddy; a CDN requires a
  separately validated identity boundary, not blind trust of X-Forwarded-For.
  Never publish raw exports, keys,
  credentials or populated environment files.

## Local workshop

Install requirements.txt into a disposable virtual environment; use that Python
for collection commands. A synthetic UI-only preview needs no crypto dependency:

```sh
python3 -B operations/visitor-analytics/server.py serve --demo \
  --db /private/tmp/visitor-demo/visitors.sqlite --port 8191
```

For real local clicks, use a fresh separate database and external key. The key
command creates an exclusive owner-only file without printing its contents:

```sh
python -B operations/visitor-analytics/server.py key --key-file /private/tmp/visitor-test.key
python -B operations/visitor-analytics/server.py serve --local-test --collect \
  --key-file /private/tmp/visitor-test.key --db /private/tmp/visitor-test/events.sqlite \
  --collection-scope production --port 9193 --origin http://127.0.0.1:8192
```

In another terminal:

```sh
DASHBOARD_FIXTURE_PORT=8192 VISITOR_PREVIEW_BACKEND_PORT=9193 node scripts/tests/dashboard-preview.cjs
```

Open /dashboard/?fixture=live&src=resume, click/navigate, then refresh
/operator/visitors/. The local proxy connects the production-marked fixture to
the local-test backend only; traffic is synthetic.
The viewer explicitly labels local recording. Never deploy --local-test, --demo,
or the fixture proxy.

```sh
python -B -m unittest discover -s operations/visitor-analytics -p 'test_*.py'
node --test scripts/tests/visitor-events.test.cjs
node --test scripts/tests/dashboard.test.cjs
```

## Production rollout — reviewed main change and activation approval required

1. Confirm reviewed main PR/SHA, disclosure, exact current operator public IP and
   rollback image. This topic carries only visitor changes, never the experimental
   dashboard integration. Check live readiness, flow/history continuity, provider
   state, disk/memory headroom and timers before any deployment. Use a fresh
   production collection DB; preserve local/demo/experimental files separately.
2. Install this directory under a dedicated unprivileged account and create a
   venv with requirements.txt. Use an owner-only state directory. Generate a
   new key with server.py key --key-file PATH and secure an off-host recovery
   copy separately. For the chosen IP-only mode set VISITOR_OPERATOR_IP to the
   exact current public /32 or /128 in /etc/ctt-visitors/visitor.env. Keep it private.
   No password/hash is required. The same address must be in Caddy's allowlist.
3. Adapt reserved host/IP/path placeholders in the service examples. Install the
   collector, hourly redaction and weekly verified-backup services/timers without
   .example suffixes. Working database/key/environment stay owner-only. Set up
   the dedicated read-only ciphertext group and separate Windows task below;
   neither receives working-DB or encryption-key permissions. Verify allowed and
   denied IPs, missing/forged headers, origin/token, browser privacy signals and a
   disposable encrypted backup restore before activation. Pin installed Python
   dependencies to requirements.txt; the monthly Dependabot entry belongs to main.
4. Stage and verify the visitor service/proxy/backups before merging the public
   activation: the normal main updater can rebuild automatically after merge.
   Only a separately authorized reviewed main SHA may enable production scripts.
   Use the normal updater, never leave the VPS on a feature branch. No experimental
   sidecar rebuild or other pending feature promotion is needed.
5. Validate Caddy with Caddyfile.fragment.example inside the existing site before
   catch-all dashboard handles. Validate the actual direct-client proxy topology.
   Visitor service/Caddy setup needs no ingestion restart, provider requests,
   traffic DB permissions, Flyway or traffic data writes. The public asset release
   is an ordinary reviewed production API deployment, not a sidecar workaround.
6. Verify source/image, assets/disclosure, a tagged journey with named clicks,
   source cleanup, Home, GPC/DNT, no experimental/unsupported-path telemetry,
   protected operator assets, both maintenance timers, off-site receipt age,
   disk/memory headroom and unchanged primary readiness/freshness/history.
   Keep visitor records out of GitHub artifacts.

Rollback: disable event intake route, restore the prior reviewed production image/config
and stop collector/maintenance timers if needed. Preserve DB, key, private configuration
and backups. Missing intake must not interrupt traffic pages. No rollback migration.

### Backup and recovery

```sh
python -B server.py backup --db /private/state/events.sqlite --output /private/backup/events.sqlite
```

Online SQLite backup refuses overwrite and prints SHA256, not events. Protect the
matching key separately; verify the checksum and restore into a disposable private
directory with the original key. A backup without its key cannot recover events.
Tests verify this restore and that a wrong key preserves original history.

For routine backups use the archive command and supplied weekly timer:

```sh
python -B server.py archive --db /private/state/events.sqlite \
  --key-file /private/config/event.key --collection-scope production --backup-directory /private/backup/visitors
python -B server.py check --db /private/state/events.sqlite --key-file /private/config/event.key \
  --collection-scope production --offsite-receipt /var/lib/ctt-visitor-backup/offsite.json
```

Archive streams the copy/hash, checks SQLite integrity and decrypts records in
batches in the disposable copy. Only successful verification records a completed
backup. Its protected directory has a 1 GiB budget; exhaustion stops backup and
never deletes existing copies. It reserves room for the configured database cap
before copying, so concurrent growth cannot overrun that budget. Operator status warns after eight days without a
verified backup, two hours without a completed redaction sweep, or at 90% database
capacity. check exits nonzero for these warnings; service errors log only the
component and exception class, never visitor contents. Failure counters are since
process start, not a durable audit log. Connect these checks to private operations
when deploying; no monitoring endpoint is installed automatically.

### Existing off-site host, separate visitor archive

Do not add SQLite snapshots to the PostgreSQL archive or modify its task/principal.
The visitor task reuses the existing SSH host/account/key but has its own folder,
lock, task and success receipt. Only completed checksummed snapshots with encrypted
event payloads are shared (indexed times and saved Home configuration remain
unencrypted, as described above):

```sh
groupadd --system ctt-visitor-backup
usermod -a -G ctt-visitor-backup ctt-visitors
usermod -a -G ctt-visitor-backup ctt-backup
install -d -m 2750 -o ctt-visitors -g ctt-visitor-backup /var/backups/ctt-visitors
install -d -m 2750 -o ctt-backup -g ctt-visitor-backup /var/lib/ctt-visitor-backup
install -m 0755 record-offsite.example /opt/ctt-visitors/record-offsite
```

These are operator setup commands, not an automatic migration. Preserve existing
users/groups/configuration; inspect before applying. The setgid receipt directory
lets the collector read backup status without giving it write permission. The
working DB/key retain 0700/0600 protection and are never exposed to ctt-backup.

Add the three Visitor settings from backup-settings.example.psd1 to the ignored
Windows settings, preserving all existing values. Restrict the visitor destination
and a **different key-recovery directory** to the backup owner's Windows account
and SYSTEM. The key must be provisioned through a separate administrator channel,
not the restricted snapshot login; never commit it or print it in a terminal.
Keep an independent protected recovery copy. A snapshot without its key cannot
recover visitor history. Test a disposable restore using that off-host key copy
before activation. Old encrypted snapshots can contain already-redacted IPs.

On the existing Windows host, validate manually twice, then register a separate task:

```powershell
.\Sync-VisitorBackup.ps1 -ConfigPath .\backup-settings.psd1
.\Sync-VisitorBackup.ps1 -ConfigPath .\backup-settings.psd1
.\Install-ColoradoTrafficBackupTask.ps1 -SyncScriptName Sync-VisitorBackup.ps1 `
  -TaskName 'Colorado Traffic Tracker Visitor Backup' -ConfigPath .\backup-settings.psd1
```

Repeated runs verify existing listed files without downloading them again. Damage
is preserved and isolated; unrelated copies continue and the task reports failure.
No completed local or VPS visitor history is pruned. An unavailable host/transfer
fails without advancing the receipt and retries at the next scheduled run. Only
verified copies generate /var/lib/ctt-visitor-backup/offsite.json, and freshness
uses the snapshot's date, not the latest re-verification time. The panel/check
command warns after eight days. Windows 5.1 behavior is required in CI; PowerShell
Core checks alone do not verify task registration, ACLs or the real backup host.

An existing encrypted v1 database is never silently replaced or fully loaded for
upgrade. Run an explicit bounded upgrade with a fresh, protected backup destination:

```sh
python -B server.py upgrade --db /private/state/events.sqlite \
  --key-file /private/config/event.key --collection-scope production --output /private/backup/before-upgrade.sqlite
```

This keeps original records and the pre-upgrade copy, adds authenticated query
metadata and preserves the key. An interrupted upgrade resumes using another new
backup destination. Prior versions must not reopen the upgraded working file;
restore the preserved copy to a different private path when testing rollback.

## Legacy offline logs

The old importer remains available on a separate plaintext DB. It accepts
successful Caddy JSON GET navigation records for the four primary pages, ignores
assets/API/operator requests and GPC/DNT records, deduplicates reimports and groups
by daily keyed network, not browser session. It never infers button actions.
Demo actions stay labeled illustrations, never stored as collected events.
Inspect actual upstream log shape/privacy coverage before import. This collector
does not enable access logging or merge plaintext rows into its encrypted DB.

```sh
python3 -B operations/visitor-analytics/server.py import --db /private/legacy.sqlite < /private/filtered-access.jsonl
python3 -B operations/visitor-analytics/server.py prune --db /private/legacy.sqlite
```
