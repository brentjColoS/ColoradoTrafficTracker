# Browser capacity measurements

Build and record the verified JARs using the
[browser-testing procedure](../../../../docs/browser-testing.md#run-locally), then run
`npm --prefix scripts/tests/browser run test:capacity`. This optional measurement
starts one isolated API/routes/database target and ten browser contexts sharing
one trusted client IP. It uses the pinned production-compatible database and
Java runtime images, a read-only application login after disposable migrations,
the cloud profile, 120 requests/minute, and API limits of 1.5 CPU / 1.5 GiB.
Provider access is blocked by an internal Docker network; ingestion never starts.

The synthetic default has 180 days of corridor observations (518,402 rows),
60 days of fourteen durable zones (1,209,614 rows), 2,073,600 legacy reports,
1,500 durable events and 322,560 hourly map rows. These approximate bounded table
estimates checked on November 9; they do not reproduce production records or all
of its historical distributions. Coverage boundaries remain distinct by dataset.
`CAPACITY_DAYS` accepts 60–365 for corridor history; other dataset sizes stay fixed.
`CAPACITY_RATE_LIMIT` defaults to the original 120/minute baseline and accepts
120–600. Set it explicitly when comparing fixture limiter settings; the report records
the actual setting and keeps rate limiting enabled. This does not configure production.
`CAPACITY_TRANSPORT` defaults to `https`: the owned loopback Caddy proxy uses
an internal localhost certificate and `encode zstd gzip`, matching the deployed
proxy's HTTPS/compression behavior. Only this run's Playwright contexts ignore
that fixture certificate; no host trust store is changed. Browser navigation
records and requires HTTP/2 plus compressed HTML. API-request scenes use the
Playwright request client and do not establish browser HTTP/2 behavior.
`CAPACITY_TRANSPORT=http` retains the original uncompressed HTTP/1.1 diagnostic.
Keep transport fixed when comparing application revisions; old HTTP timings are
not deployed-proxy capacity measurements.

`CAPACITY_HTTP_THREADS` defaults to 64, matching the experimental reader worker
budget, and accepts 10–200. API CPU, memory, connection-pool and 128-task limits
remain fixed. Use `CAPACITY_HTTP_THREADS=200` explicitly for the original framework
worker baseline. Reports record configured workers and cgroup task counts;
`peak` is included when the kernel exposes it. Reading these counters may add
short-lived diagnostic tasks. Cleanup captures both log streams and fails the
run on observed native-thread or memory exhaustion, even if HTTP checks passed.

`CAPACITY_CLIENT_MODE=distinct` assigns ten fixed documentation IPs through the
owned proxy; the default `shared` assigns one IP to all ten sessions. Both modes
overwrite forwarded headers. They change only the isolated fixture proxy.
Reports retain observed rate-limit headers and page payload sizes. The hourly
map seed uses combined-direction rows, matching the frequency read contract;
refresh scenes require nonempty combined cells for both long-range windows.
`CAPACITY_SCENE` selects `open`, `history`, `summary`, `stream`, `shared`,
`legacy`, `refresh`, or `all` (default). Scenes issue ten simultaneous
operations, report successes and failures independently, and continue to collect
evidence after a failed operation. Page opening checks the rendered current
values and chart summary after painting; historical API scenes exercise real
batched API and card reads from the independent browser contexts. These burst
scenes do not measure historical DOM rendering or sustained behavior. The combined scenes deliberately form a
burst; select one scene to separate loading contention from the shared-IP limit.
Opening retains the original whole-operation timing (including automation and
diagnostic collection) and separately records browser-native navigation-to-chart
and card DOM readiness in `renderedOpening`. A page observer requires both seeded
current values and the chart painter's matching accessible summary. `stream`
tests distinct NDJSON summaries; `shared` requests one common cold window.

`CAPACITY_WARMUP=bootstrap` performs one 30-second-bounded server HTML read and
checks every bootstrap section before the browser workload. The default is
`none`; reports label this cache-state difference and retain warmup duration.
A warmed result does not establish cold-start performance.

`CAPACITY_SCENE=navigation` opens ten real pages, then clicks corridor/range/view
and history controls with ten-second pauses between destinations. It covers
oldest available windows, a later window, return to Current and supersession.
It checks actual painted chart summaries, route coverage and completed cards
against the selected window. Known pre-fixture incident gaps remain explicitly
unavailable instead of being treated as zero events. Browser click listeners
record final-destination-to-chart and card readiness separately in
`renderedDestinations`; whole-workflow timings include configuration clicks and
automation overhead. The still-current check revalidates the previous destination,
not a new timing sample. This is bounded interaction coverage, not a 30-minute
soak, collection/retention coexistence proof or the complete release matrix.
`reads` runs history and all summary scenes without browser startup/preload
traffic, keeping the complete ten-session read workload within the default
shared-IP budget. Overall graph requests span different supported resolutions
and dates across 110 days; legacy cards span ten separate days.
`expiry` is a separate opt-in scene. It primes ten sessions, writes two controlled
observations only in the disposable database, waits one fixed 61-second expiry
boundary, and verifies retained fetch/version evidence plus delivery of the new
observations within three bounded follow-ups. It exercises version-only replies
and the real application's background refresh rather than a mocked cache clock.
`page-expiry` repeats the same bounded observation/expiry checks through the
public HTML bootstrap instead of the snapshot API. It checks that prepared-page
reuse retains original fetch evidence while refreshing, then delivers the new
observations to all ten readers. HTML responses must remain `no-store`; no
browser scripts or provider reads are needed for this server-response check.

The prepared HTML retains both identity and gzip representations of the exact
bootstrap, with an eight-MiB combined cache bound. Gzip-capable readers share
that representation instead of recompressing each initial page at the proxy.
Both representations remain `no-store` and vary on `Accept-Encoding`; changes
to section status, data, version, or fetch/refresh evidence replace both. Demo,
historical, and replay shells use the same content negotiation without live
bootstrap data.

The entire run has a seven-minute deadline, bounded readiness/seed/command
timeouts, and teardown on normal completion or termination signals. Diagnostics
and `report.json` go to ignored `capacity-results/`, or `CAPACITY_OUTPUT`.
Only this run's UUID-named resources are removed. Images must be available before
running. A forcibly killed process cannot run teardown: use the resource prefix
in its report/logs to inspect and remove only its labelled leftovers.

This local diagnostic deliberately records whether the generator shares target
hardware and does not claim a production capacity guarantee. API restart clears
application caches, not the database/OS cache. Inspect per-section statuses,
card availability, p50/p95/p99/max, resource usage and expensive SQL before tuning.
The standard smoke suite retains its small seed and elevated limiter; these
capacity measurements use a separate entry point and are not normal CI jobs.
To compare another reviewed application topic with this same harness, supply its
verified `BROWSER_RUNTIME_DIR` and exact `CAPACITY_REVISION`; the report retains
both source revisions, JAR hashes and the fixture hash. Revision/hash mismatches
stop before containers start. Keep other builds and load generators idle during
timing comparisons; local timings remain distinct from hardware acceptance.

## Ingestion and retention coexistence

The capacity harness also has `coexistence` (three minutes) and `soak` (thirty
minutes) scenes. Run the short preflight first. Both use the same ten real
Chromium sessions, compressed HTTPS/HTTP2 proxy, API limits and disposable
180-day fixture as the capacity diagnostics. Existing short scenes retain their
seven-minute watchdog; coexistence has a ten-minute total deadline and soak has
a thirty-eight-minute total deadline, including setup and cleanup.

Supply the verified API/routes runtime and an explicitly hashed ingest-service
JAR from the same verified source revision. For example, from the repository root:

```bash
CAPACITY_SCENE=coexistence CAPACITY_WARMUP=bootstrap \
CAPACITY_CLIENT_MODE=distinct CAPACITY_RATE_LIMIT=120 \
CAPACITY_OUTPUT=/tmp/ctt-coexistence-result \
BROWSER_RUNTIME_DIR=/path/to/verified/browser-runtime \
CAPACITY_REVISION=EXACT_VERIFIED_SHA \
CAPACITY_INGEST_JAR=/path/to/verified/ingest-service.jar \
CAPACITY_INGEST_SHA256=EXACT_VERIFIED_INGEST_SHA256 \
node scripts/tests/browser/capacity/run.cjs
```

Use a fresh output directory and `CAPACITY_SCENE=soak` for the full run.
`JAVA_HOME` must identify a JDK with `javac`; the harness compiles its small
fixture driver against the packaged ingestion classes before timing begins.
It records the application, JAR and driver-source hashes.

The internal-network fixture runs the packaged `TrafficSampleWriter` every
minute for both corridors, and the packaged `TrafficRetentionJob` on its own
worker. All provider polling, reset probes, calibration, timeseries startup
maintenance and automatic retention schedules are disabled. No provider
credentials are supplied. This exercises real persistence/archival transactions,
not provider HTTP collection or provider quota rollover.

Six hundred old samples, six hundred legacy incidents and 4,200 zone rows start
live. The checks require every old sample to move into the archive, matching
before/after logical-row checksums, unchanged archive-inclusive incident totals,
exactly the new writer's sample/zone growth, and unchanged durable-event,
quota and reset-table hashes. The worker stops before final inventory checks.
Existing seeded data remains queryable throughout.

The browser workload rotates every session through all five ranges and
Overall/Speed zones while
keeping selected windows inside the retained coverage. It checks fully rendered
charts/cards, live snapshot freshness during historical navigation, writer and
retention progress, HTTP errors and browser exceptions. Freshness has a 195-second
diagnostic budget: a 60-second writer cadence, 60-second summary cache, 60-second
browser refresh and the existing 15-second fetch deadline. This is distinct from
the ten-second selected-window loading target. Failures end the run
instead of leaving an unproductive experiment active. JSON progress is written
atomically after each round; the writer has a separate NDJSON journal.

Resource checkpoints retain JVM heap, container CPU/memory/PIDs and browser heap.
Browser garbage collection occurs only at untimed five-minute checkpoints. After
a ten-minute warmup, final per-tab retained-heap growth is bounded by the larger
of 32 MiB or 25% of the warmed baseline. This is a bounded local observation,
not proof of leak freedom or acceptance on separate generator hardware.


## Sustained backlog and application restart

`CAPACITY_SCENE=backlog` uses the same verified runtime/JAR prerequisites and
starts 6,000 old samples, 6,000 incidents and 42,000 zone rows live. Ten browsers
rotate historical ranges and views for six minutes while ingestion continues.
The real retention job must archive exactly 1,000 canary samples in each of its
first six minute-spaced cycles. Per-cycle journal entries record archived and
remaining canaries, so an empty retention scan cannot count as backlog work.
All existing content-checksum, row-continuity and protected-table gates apply.
Both initial openings and reopenings must meet the two-second useful-render
budget; initial timing misses are failures even when retention integrity passes.
Long coexistence scenes stop after an opening miss; use the one-round probe
when both opening and historical diagnostics are needed from that process.
After bulk seeding, the fixture records live-table row estimates and analysis
metadata, refreshes planner statistics with a fifteen-second statement limit,
and records the updated values before timed browser reads. This keeps fixture
setup distinct from concurrent retention and does not change application budgets.
This is a fixed six-cycle backlog, not an indefinitely replenished queue.

After stopping the writer and reconciling the inventory, this scene navigates
the ten browsers to a blank page, restarts only its owned read-only API, waits
for readiness, and reloads all sessions without application warmup. It requires
useful chart/card opening within two seconds and ten historical windows within
the existing ten-second target; exact inventory must remain unchanged. It
records pre-restart API logs/task peak as well as final diagnostics. Browser
asset caches and database/OS caches remain uncontrolled; this does not simulate
seamless browsing during a server failure.

The scene has a fifteen-minute total deadline, including setup and teardown.
Worker startup has a bounded two-minute deadline to allow the larger seed.
Use a fresh output directory. This remains a colocated-generator diagnostic;
a separate physical generator/target pair is needed for independent hardware
capacity acceptance.


## One-round backlog probe

`CAPACITY_SCENE=backlog-probe` seeds the same 6,000 canaries as `backlog`,
then stops its real writer/retention workers after one ten-session historical
round. The seven-minute total watchdog still includes setup and cleanup. Reports
separate opening and historical SQL totals and retain navigation transfer,
post-response render time, and map-renderer resource timing. Initial useful
opening is checked against the unchanged two-second target. Historical timing,
content checksums, protected data, row continuity and at least one full retention
batch are checked; the remaining backlog is explicitly allowed. This is a short
diagnostic, not six-cycle backlog, restart or soak acceptance.

## Focused cold opening profile

`CAPACITY_SCENE=cold-open CAPACITY_WARMUP=none` measures ten simultaneous useful
openings, selected historical windows, one owned API restart, and ten reopenings.
It records navigation TTFB, transfer and response-to-useful-render time,
per-section bootstrap sizes, and bounded aggregate SQL diagnostics. SQL totals
can include automatic background preload work; they are not per-request traces.
The scene retains the seven-minute total watchdog and performs row-count and
100-row-per-dataset canary reconciliation even after a timing miss. Its opening
target remains two seconds and selected history remains ten seconds.

`CAPACITY_STARTUP_PREPARATION=true` passes the opt-in preparation property only
to the read-only test API; it stays disabled during disposable migration/setup.
Startup-to-readiness duration is recorded separately from browser opening time.
Use the verified application revision that implements this property when
comparing prepared and unprepared starts. Database/OS and browser asset caches
remain uncontrolled. No provider collection or live database is involved.
