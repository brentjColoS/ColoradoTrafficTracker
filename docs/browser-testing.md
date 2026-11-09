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
