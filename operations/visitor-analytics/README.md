# Private visitor observatory

Operator-only, first-party page visits and allowlisted button actions. Browser,
device, viewport and referral reports are approximate and may be incomplete or
forged; they do not identify recruiters or unique people. Optional local city
data provides approximate IP areas, not browser GPS or verified locations.

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
- Production source links use /?src=resume|linkedin|github|portfolio. The root
  redirect must preserve the URI query (Caddy: /dashboard{uri}). Existing
  /dashboard/?src= links remain valid; local/experimental links keep their scopes.
  source-links.js captures the label and removes src with replaceState; the
  initial request still contains it. Only the external referrer hostname is
  retained, never its path/query.
- The operator UI loads on demand: 25 visits/page, latest 60 events/visit, signed
  snapshot cursors. All time is a filter, not retention. Search and source/page
  summaries cover the current page; totals cover the matching period. Refresh
  restarts the snapshot, including after Home reclassification.
- All traffic defaults to Home excluded, including outside people and bots.
  Include Home adds it back to both totals and paginated results. External,
  Home-only and bot filters remain separate; the switch applies to All traffic.
  Switching filters starts a new snapshot, without changing saved Home addresses.
- Home uses the server-observed IP. Mark/unmark reclassifies retained history
  without deleting it, including redacted visits. Home overrides bots and is
  excluded from External. At most 16 saved addresses; shared NAT/VPNs may classify
  others as Home.
- The private Signals panel can also save an exact public IPv4/IPv6 Home address
  manually (no CIDR ranges, DNS lookups or location requests). The same 16-address
  limit, Origin/action token and primary-operator access checks apply. Saving a
  Home address also grants that IP read-only observatory access in IP-only mode;
  removal revokes the next request, without a reload. Existing loaded data cannot
  be recalled. Anyone sharing the IP (including a VPN or public Wi-Fi exit) can
  view the page. Only the configured primary operator can add/remove Home IPs.
- Deployed IP-only access requires HTTPS and exact public addresses. The loopback
  app checks the configured primary addresses or saved Home IP on every asset
  and snapshot request; only the configured primary addresses can write. Home
  viewers receive no action token or management controls. A primary IP remains
  authorized even when it is removed from Home classification. Home writes also require Origin/action token.
  A backup restore also restores its saved Home viewing permissions; review that
  list before exposing the restored operator route.
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

### Local IP areas and map

Set `VISITOR_GEO_DATABASE=/var/lib/ctt-visitor-geo/city.mmdb` in the existing
private visitor environment to opt in. Use the official [DB-IP City Lite MMDB
download](https://db-ip.com/db/download/ip-to-city-lite), not CSV; verify its
published checksum before atomically installing the decompressed file. Keep it
outside Git. The supplied monthly geo timer refreshes on the fourth, verifies the
published decompressed checksum/edition, and atomically replaces only complete
data; failures retain the last working edition. It cannot access visitor data or
private configuration. The November 2026 MMDB is roughly 121 MB on
disk; `maxminddb` uses FILE mode, not a full memory load or mmap. A missing,
corrupt, wrong-type or over-100-day-old database yields unknown locations and
one private warning per process, not failed intake. Each lookup opens the current
edition, so updates need no service restart; the intake network restriction stays intact.

One local lookup per accepted batch stores an encrypted city/region label,
rounded area-center coordinates and source/edition. No coordinates or device
location are requested from browsers. Old records are not backfilled, and raw
IPs still redact after 24 hours; derived areas remain with visit history.
State-only results are not substituted for city areas. IP data may locate a VPN,
ISP or mobile gateway instead of the person. Two-decimal coordinates express
reduced precision, not a claim of street-level accuracy.

The private, initially collapsed map loads the site's existing MapLibre assets
only when opened. It covers the current bounded page of visits and follows its
period/category/Home/search filters, not all retained history. Matching area
centers combine into count pins; pins/buttons filter the journeys. Translucent
30-mile circles are a visual reference, not measured per-IP confidence bounds;
DB-IP Lite does not provide those. Unknowns stay
in the list. Closing releases the renderer. If WebGL or tiles fail, the list
still works. Basemap tiles come from the same USGS service used by the dashboard;
opening the map sends tile requests from the operator's browser, not visitor IPs.
The narrow map host/worker/CSS policy does not widen operator access. DB-IP
attribution is displayed wherever area results are shown.

### Daily Discord digest (opt-in, not enabled by installation)

Keep the webhook URL in an owner-only file outside Git and configure only the
intended user ID as `VISITOR_DISCORD_USER_ID` in `/etc/ctt-visitors/digest.env`.
Never log the URL. Create `/var/lib/ctt-visitors/digest` owned by the visitor
account, mode 0700. Initialize once, as that account, before enabling the supplied
oneshot/timer examples:

```sh
python -B digest.py --db /var/lib/ctt-visitors/events.sqlite \
  --key-file /etc/ctt-visitors/event.key \
  --state-file /var/lib/ctt-visitors/digest/checkpoint.json --initialize
```

Initialization baselines existing history without notifying. The timer runs at
17:00 fixed MST (UTC-7), **18:00 Colorado time during daylight saving**; no boot
catch-up run. It reads only new committed rows, excludes Home/bots and sessions
whose first page was already checkpointed, and remains silent if none qualify.
Session counts are not unique-person counts. At most five city/source/device
summaries accompany the combined count and protected operator link; one configured
user mention is allowed, never roles/everyone. Approximation/source attribution
is explicit. Raw IPs, coordinates and detailed journeys are not sent to Discord.

The visitor DB is read-only to this task. SQLite has a five-second query deadline
and 1 MiB cache; the separate state directory holds a small atomic checkpoint and
nonblocking lock. One outbound request has a ten-second timeout, no redirects and
requires Discord's confirmation. A failure retains the checkpoint for a future
scheduled/manual retry, without an immediate retry loop. One successful message
per MST date. A crash after Discord accepts but before checkpointing can produce
a duplicate on retry; webhooks do not provide exactly-once delivery. Database
identity/restore mismatches stop rather than silently replaying history.

Release needs separate authority, reviewed matching files, installed data,
private config and a synthetic send check. No new traffic container, provider
request, browser polling, ingestion hook or new collection endpoint. The sender
alone can reach the internet; intake remains loopback-only. Roll back by disabling
the digest timer and the optional geo setting; preserve history/key/checkpoint.

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
   Configure the exact primary address in VISITOR_OPERATOR_IP. No password
   is required in IP-only mode. New installations need a fresh production DB/key,
   separate from local/demo/experimental files; updates preserve existing ones.
3. For Home viewing, deploy the matching app first and verify direct allowed,
   denied, forged-IP and Home-read-only requests before updating Caddy. The old
   static Caddy primary-IP matcher blocks Home viewers; replace only that matcher
   with the supplied loopback-proxy route and verified-client header overwrite.
   Never expose the backend port or let a proxy preserve client-supplied identity
   headers. Roll back the proxy to primary-only first if authorization checks fail.
   Stage the service, hourly redaction and weekly backup timers before activating
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
