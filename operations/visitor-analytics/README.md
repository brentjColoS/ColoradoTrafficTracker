# Private visitor observatory

Operator-only, first-party page visits and allowlisted button actions. Browser,
device, viewport and referral reports are approximate and may be incomplete or
forged; they do not identify recruiters or unique people. No GeoIP is connected.

## Collection and access

- Only the four explicitly marked /dashboard/ pages send to /visitor-events.
  Experimental collection requires its own marker, scope and separate database;
  this production release does not enable it. See collector.py for allowed events.
- GPC stops collection in the browser and independently at intake (Sec-GPC: 1).
  Ordinary DNT does not stop these limited first-party events. This policy is
  prospective: skipped visits are not recovered or imported. Keep the short
  About the Data notice consistent with deployed behavior.
- No typed content, mouse/scroll tracking, replay, fingerprints, exact browser
  versions, third-party analytics or advertising. Blocked session storage stops
  collection with no fallback; failures stop that page without retries.
- Same-tab session IDs rotate after 30 minutes idle or 24 hours. Batches send
  after five seconds, up to 20 events, with a final page-hide beacon. Nothing
  polls, preloads the operator UI or calls providers. The browser stores only
  short-lived session metadata, not visit history.
- Source links use ?src=resume|linkedin|github|portfolio. source-links.js captures
  the label and removes src with replaceState; the initial request still contains
  it. Only the external referrer hostname is retained, never its path/query.
- The operator UI loads on demand: 25 visits/page, latest 60 events/visit, signed
  snapshot cursors. All time is a filter, not retention. Search and source/page
  summaries cover the current page; totals cover the matching period. Refresh
  restarts the snapshot, including after Home reclassification.
- Home uses the server-observed IP. Mark/unmark reclassifies retained history
  without deleting it, including redacted visits. Home overrides bots and is
  excluded from External. At most 16 saved addresses; shared NAT/VPNs may classify
  others as Home.
- Deployed IP-only access requires HTTPS and exact public /32 or /128 addresses,
  enforced by Caddy and the app for all operator assets/data/actions. Anyone
  sharing that address can access it; changes require an SSH update, never an
  automatically widened allowlist. Home writes also require Origin/action token.
  Password mode is available only when --operator-ip-only is omitted.
- Backend binds loopback. Caddy must overwrite X-Visitor-Client-IP with its
  verified connection address, rejecting missing/duplicate/malformed values.
  Local processes are trusted; do not expose the port. A CDN requires separately
  validated forwarding, not blind X-Forwarded-For trust. Responses are
  no-store/noindex/frame-denied. Never publish records, keys or populated env files.

## Storage and limits

The dedicated VPS SQLite file is separate from traffic PostgreSQL. Fernet
encrypts event payloads with an external owner-only key; indexed metadata,
opaque identities and saved Home configuration are not encrypted. Restrict the
entire state directory. Never replace the key over existing data: loss of the
key or VPS can permanently lose visitor history.

Raw IPs are masked on reads after 24 hours. The hourly redaction timer rewrites
payloads in resumable batches of 200, with a 55-second budget; removal normally
takes up to one additional hour. Visit history remains until deliberately
removed. Proxy logs and older backups have separate retention.

Intake is write-only, same-origin, no CORS: 16 KiB/request, 20 events/batch,
60 batches/IP/minute, 600 total/minute, 500 events/session, 16 connections and
three-second socket timeout. The main SQLite file caps at 256 MiB; whole batches
roll back at capacity, never pruning history. Journals/backups need extra space.

Reads allow two snapshots, five seconds/query, 1 MiB connection caches, disk
sorting and no mmap. Service examples cap memory at 96 MiB / CPU 50%; maintenance
has a separate 96 MiB / CPU 25% allowance. Broad queries may return retryable
budget errors. Status/check warn at 90% capacity, two hours without a completed
redaction sweep or eight days without a verified backup. Errors log component
and exception class, never visitor contents; counters reset with the process.

## Local validation

Install requirements.txt into a disposable venv. A synthetic viewer needs no
crypto dependency:

```sh
python3 -B operations/visitor-analytics/server.py serve --demo \
  --db /private/tmp/visitor-demo/visitors.sqlite --port 8191
```

For real local clicks, use a fresh database and external key (created exclusively,
owner-only, without printing it):

```sh
python -B operations/visitor-analytics/server.py key --key-file /private/tmp/visitor-test.key
python -B operations/visitor-analytics/server.py serve --local-test --collect \
  --key-file /private/tmp/visitor-test.key --db /private/tmp/visitor-test/events.sqlite \
  --collection-scope production --port 9193 --origin http://127.0.0.1:8192
```

In another terminal, run the fixture proxy:

```sh
DASHBOARD_FIXTURE_PORT=8192 VISITOR_PREVIEW_BACKEND_PORT=9193 node scripts/tests/dashboard-preview.cjs
```

Open /dashboard/?fixture=live&src=resume, navigate/click, then refresh
/operator/visitors/. Never deploy --local-test, --demo or the fixture proxy.

```sh
python -B -m unittest discover -s operations/visitor-analytics -p 'test_*.py'
node --test scripts/tests/visitor-events.test.cjs
node --test scripts/tests/dashboard.test.cjs
```

## Release checklist

1. Require reviewed main SHA, activation authority, matching notice, exact operator
   IP and rollback revision. Inspect live readiness, flow/history continuity,
   providers, timers and resource headroom. Preserve private configuration/data.
2. Install reviewed code and pinned requirements under the unprivileged account.
   Adapt the supplied Caddy/systemd examples; validate direct-client forwarding.
   Key/env/database are owner-only; state and backup directories are mode 0700.
   Configure the exact address in both Caddy and VISITOR_OPERATOR_IP. No password
   is required in IP-only mode. New installations need a fresh production DB/key,
   separate from local/demo/experimental files; updates preserve existing ones.
3. Stage the service, hourly redaction and weekly backup timers before activating
   public scripts. Verify allowed/denied/forged-IP requests, Origin/token checks,
   GPC suppression, DNT-only collection and a disposable backup restore. The
   operator setup needs no ingestion restart, provider credentials, Flyway or
   traffic data writes.
4. Deploy only the authorized main revision through the normal updater; never
   leave the VPS on a feature branch. Public assets require the normal API
   release, not an experimental sidecar. Verify source/image and cache keys.
5. Check a tagged browser journey, named clicks, source cleanup, Home, GPC/DNT,
   blocked storage, scope isolation, protected assets, timers, backup age and
   unchanged primary readiness/freshness/history. Keep records out of GitHub.

Rollback: disable intake, restore the prior reviewed image/config and stop
collector/maintenance timers if needed. Preserve database, key, private config
and backups. Missing intake must not interrupt traffic pages; no migration needed.

## Maintenance and recovery

Only two verified weekly snapshots on the same VPS are retained. No visitor
off-site transfer or off-host key recovery is required; host/key loss is accepted.
Traffic-data off-site backups remain separate and unchanged.

```sh
python -B server.py archive --db /private/state/events.sqlite \
  --key-file /private/config/event.key --collection-scope production --backup-directory /private/backup/visitors
python -B server.py check --db /private/state/events.sqlite --key-file /private/config/event.key \
  --collection-scope production
```

Archive verifies checksum, SQLite integrity and decryption in bounded batches
before rotating only older generated snapshot/manifest pairs. It refuses overlap,
uses an owner-only 1 GiB directory budget and reserves the database cap before
copying. Failed/incomplete/manual files remain for inspection, never automatic
deletion. check exits nonzero for warnings; wire it into private operations.

For a manual exclusive snapshot:

```sh
python -B server.py backup --db /private/state/events.sqlite --output /private/backup/events.sqlite
```

Verify its SHA256 and restore into a disposable private directory with the
original key. Wrong keys fail closed. Legacy encrypted v1 upgrades require an
explicit bounded command and fresh protected backup destination:

```sh
python -B server.py upgrade --db /private/state/events.sqlite \
  --key-file /private/config/event.key --collection-scope production --output /private/backup/before-upgrade.sqlite
```

Interrupted upgrades resume with another new backup destination. Never open an
upgraded file with an older version; test rollback against a separate restored copy.

The legacy offline importer remains separate/plaintext: successful navigation
logs only, no button inference, GPC/DNT rows excluded, daily keyed grouping and
deduplicated imports. It neither enables access logs nor backfills encrypted
collection. Inspect real upstream privacy coverage before any import; demos stay
labeled illustrations.
