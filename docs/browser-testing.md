# Browser testing

Playwright runs real Chromium against the dashboard in two modes. The fixture
suite controls time, API scenarios and external presentation resources. The
integration suite runs the verified API/routes JARs with disposable PostgreSQL,
real migrations and synthetic observations. Neither mode starts ingestion or
uses live provider accounts.

## Run locally

Use the Node version in `.node-version`:

```bash
npm ci --prefix scripts/tests/browser
npm --prefix scripts/tests/browser exec -- playwright install --with-deps chromium
npm --prefix scripts/tests/browser run typecheck
npm --prefix scripts/tests/browser run test:ui
```

The fixture server starts on its own loopback port for each test. Its data clock,
batch cache and renderer retry state cannot leak into another test. Browser time
uses the same fixed observation anchor. Google Fonts CSS and USGS tiles receive
local deterministic responses; unexpected external requests and uncaught browser
exceptions fail the test. These checks exercise the real HTML/CSS/JavaScript,
including actual MapLibre rendering and its unavailable-renderer fallback.

For packaged application checks, install Java 21 and Docker, then:

```bash
./mvnw -B -ntp -U -s .mvn/public-repositories.xml clean verify
python3 -B scripts/ci/browser_runtime.py record browser-runtime
npm --prefix scripts/tests/browser run test:api
```

The runtime helper verifies the JAR hashes and source revision, starts only its
own database/API/routes processes, seeds current and archived observations, and
removes those resources on teardown. The application keeps API-key security
active while explicitly enabling public dashboard reads. Database migrations run
only in that new disposable database. Logs and tested revision are retained in
`api-test-results`; no populated environment files are required.

## Debug and maintain tests

### Bounded concurrent-session measurements

After building and recording the verified JARs above, run
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
120–600. Use 600 explicitly when validating the proposed experimental shared-IP
budget; the report records the actual setting and keeps rate limiting enabled.
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
values; historical scenes exercise real batched API and card reads from the
independent browser contexts. They do not yet measure historical DOM rendering
or continuous interaction/soak behavior. The combined scenes deliberately form a
burst; select one scene to separate loading contention from the shared-IP limit.
Opening reports both browser readiness and first-byte/DOM timing. `stream`
tests distinct NDJSON summaries; `shared` requests one common cold window.
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

Run commands inside `scripts/tests/browser` to use Playwright options directly:

```bash
npm exec -- playwright test specs/history.spec.ts --project=chromium
npm run test:headed
npm run test:debug
npm run report
npm exec -- playwright show-report api-playwright-report
npm exec -- playwright show-trace path/to/trace.zip
```

Use accessible roles/names and awaited assertions. History data is prefetched;
register a response wait before the action that starts the read, rather than
assuming every navigation requires a new request. Keep tests independent, use
controlled delayed responses instead of sleeps, and assert section statuses and
values inside a batch response rather than checking HTTP 200 alone.

The suite includes navigation, themes, corridor/range selection, historical
navigation and retry, cancelled reads, empty/partial/rate-limited data, renderer
fallback, mobile layout, keyboard operation, axe scans and image comparisons of
the actual chart and time-range controls. The real-application cases verify
security, validation, archive-inclusive counts, bootstrap rendering and history
reads from known PostgreSQL rows.

Automated axe checks cover detectable WCAG A/AA issues in light and dark states;
they do not certify complete accessibility. Mobile Chromium is emulation, not a
real device or Safari. Firefox/WebKit are not part of the required baseline.

## Visual baselines

Snapshots are reviewed files under `specs/visual.spec.ts-snapshots`, separated by
platform. Do not update them just to make a failed check green. Inspect the
actual/diff images, confirm the product change, then regenerate only the affected
case. Fixed observation time and deterministic presentation resources keep these
small comparisons stable. Failure screenshots are separate debugging artifacts.

The UI job uses this digest-pinned Linux image for both normal execution and
baseline generation. CI mounts its pinned Node installation read-only into the
container; only the selected UI job pulls the image. This keeps runner font
updates from changing comparisons. To regenerate a reviewed Linux baseline:

```bash
docker run --rm --ipc=host -v "$PWD:/work" \
  -v /work/scripts/tests/browser/node_modules \
  -w /work/scripts/tests/browser \
  mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d \
  /bin/bash -lc 'npm ci && CI=1 npm exec -- playwright test --project=chromium --grep "reviewed visual layout" --update-snapshots'
```

Run this from the repository root. This mounts only the checkout and an anonymous
dependency directory; the baseline files remain available for review in Git.

## CI behavior

`browser-tests` starts alongside Maven/dashboard checks after the delivery and
scope guards. `browser-api-smoke` consumes the successful Maven job's same-run
JAR artifact instead of rebuilding. PIT and container builds keep their existing
prerequisites; the final `ci-complete` gate requires both browser jobs.

Code, mixed and unknown PR changes run both jobs. Verified documentation-only
changes record explicit successful no-execution decisions. Main/manual runs
always execute. Audited browser case/fixture/image paths can omit Java mutation
work, while new unknown paths, configuration, lockfile and CI/build changes keep
the conservative full-PIT fallback.

CI uses one browser worker, at most one diagnostic retry, and fails tests marked
flaky even if their retry passes. Focused-only tests are forbidden. Playwright's
three-minute global timeout leaves room within the job limit to upload reports.
HTML, JUnit, failure traces/screenshots and application startup logs are retained
for seven days. UI and real-application outputs use separate directories.

Review setup time, browser execution time, complete CI and summed job durations
separately before changing concurrency or adding browser shards. Current API
mutation groups, worker counts, operators and thresholds remain unchanged.
