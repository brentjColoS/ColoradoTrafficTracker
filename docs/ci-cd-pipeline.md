# CI and delivery pipeline

## Assessment and decisions

The previous workflow ran on every push and pull request, so opening or updating
an internal PR repeated Maven verification and Windows tests for the same commit.
Operational checks waited behind Maven, test and coverage reports were not retained,
and container packaging was first exercised outside CI. Actions already used full
commit pins and a read-only token; these controls are retained.

The successful main run [37061512856](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/37061512856)
on October 2, 2026 took about seven minutes. Its sequential mutation reactor took
5 minutes 14 seconds: routes 26 seconds, ingest 71 seconds, and API 215 seconds.
API mutation analysis is the main bottleneck. Running services in parallel removes
about 97 seconds of sequential work; runner setup, cache misses, and queueing affect
the actual result. The first matrix run [37549281367](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/37549281367)
passed all gates, but its API shard still took 5 minutes 6 seconds. Runner variance
and the API bottleneck limited the overall gain; service parallelism alone is not
a claim of a measured 97-second improvement.

Three large controller suites now use standalone MockMvc for their existing HTTP
requests and assertions. They previously bootstrapped Spring MVC slices while
mocking repositories and disabling security filters. Full Spring integration suites
still test application wiring, public/protected routes, and rate limiting. The
standalone setup retains plain-text responses and Boot's ISO timestamp format.
An isolated same-machine Java 21 comparison reduced API PIT analysis from 81 to
74 seconds and the Maven invocation from 96 to 85 seconds. Both generated the
same 1,401 mutation identities and passed the original thresholds. These local
measurements are diagnostic evidence; GitHub runner timings are the delivery
measurement.

Ingest tests also had a repeatable 30-second JVM shutdown stall. The Surefire
thread dump identified Spring waiting for future scheduled work during shutdown.
Both application and retention schedulers now cancel queued delayed tasks when
shutdown begins, while retaining the existing wait for active tasks to finish.
A parameterized regression verifies cancellation, completion without interruption,
and executor termination for both schedulers. The full local Maven verification
passed 366 tests, fell from 64 to 40 seconds in successive runs, and no longer
produced the forced-JVM-shutdown warning. This is also a runtime shutdown
change; normal polling and retention behavior while the application runs are
unchanged. Deploy it only as a reviewed application revision using the normal
runbook.

CI now runs on every PR, pushes to main, and manual dispatch. Branch work can be
checked before a PR through the Actions UI. New PR revisions cancel obsolete runs;
main and manual runs are not actively cancelled by newer runs. GitHub concurrency
retains at most one pending run per group, so intermediate queued revisions can be
superseded. The workflow is never filtered by changed paths, so required checks are always
reported. Full Maven, resilience, Windows, and packaging checks run on every PR.
All PIT is omitted when a PR changes exclusively root Markdown, `docs/`, static
web assets under `api-service/src/main/resources/static/`, or the exact frontend
test paths explicitly listed in `scripts/ci/mutation_scope.py`: the runners,
reviewed feature suites, shared browser fixtures and batch fixture. New files in
those directories remain unrecognized until reviewed and added to the list.
The experimental integration runs its complete JavaScript entry point and historical
incident SQL regression in the required `dashboard-tests` job. The reviewed standalone
flow-diagram, stored-observation and traffic-estimate tests are also recognized
frontend paths. The SQL regression and `.node-version` still require full PIT.
No broad `scripts/` or test-directory exclusion is allowed. Service Java changes
select complete affected-module gates as described below. Shared code, resources,
POMs, wrappers, workflows, the scope detector itself, and any unrecognized path
require all mutation gates. Main pushes and manual dispatch always require all
PIT gates. Both PR guards use the first parent of the exact tested merge commit, with a
shallow checkout containing both merge parents. They verify that `HEAD` matches
`GITHUB_SHA`, the ref is a PR merge ref, and the second parent is the expected PR
head. The event payload's base SHA can be stale after another topic merges;
using it caused three recent runs to fail before validation. Missing parents,
a different checkout, an unexpected head or invalid detector outputs fail CI;
renames are expanded into deletions and additions so moving Java into documentation
cannot bypass analysis.

## Experimental reassessment: November 6, 2026

At accepted experimental revision `41009d11`, the latest 100 CI runs contained
94 successes, three failures, two superseded cancellations and one active run.
All three failures were missing event-base revisions in the shallow checkout,
not assertion failures. The merge-parent check above addresses that observed race
without fetching full history or relaxing the delivery boundary.

These are individual GitHub runs, measured from the first job start to the final
gate completion; job times include setup and artifact work and overlap:

| Check | Full Java change, [41970336779](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/41970336779) | Frontend change, [42154830355](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/42154830355) |
| --- | ---: | ---: |
| Maven/build gate | 1m35s | 2m06s |
| API support mutation job | 8m08s | PIT omitted |
| API web mutation job | 1m39s | PIT omitted |
| Ingest mutation job | 4m08s | PIT omitted |
| Routes mutation job | 42s | PIT omitted |
| Complete CI | 10m11s | 3m38s |

The dashboard test entry point already imports its split feature suites. The
coverage gaps were elsewhere: the historical SQL script was never invoked, and
`StoredObservationDatabaseTest` and `IncidentBoundaryDatabaseTest` were disabled
because CI did not provide their disposable URL. The workflow now runs the SQL
script in its existing isolated, temporary Docker fixture and supplies both
`CTT_PRECISION_DB_URL` and `CTT_COUNTER_DISPOSABLE_DB_URL` to Maven's existing
PostgreSQL service. That also retains the newer incident transaction/rollback
and flow-precision tests. Fixtures use synthetic data and no provider credentials.
`CTT_HISTORY_DB_URL` remains unset: the retained-data parity test needs a populated
historical dataset and is not a meaningful check against an empty CI database.
Live provider and local capture tests remain opt-in.

Dashboard validation now starts before Maven finishes, uses Node 24.22.2 from
`.node-version`, retains TAP results for seven days, and is required by the
mutation, packaging and final gates. Node has no package dependencies here, so
package-manager caching is disabled. New test files still require explicit
registration in the complete entry point; a directory-wide discovery command
would also launch preview tools or repeat imported suites.

Further work, in priority order:

1. Add a Playwright Chromium gate for navigation, layout, asynchronous recovery
   and accessibility, using provider-free fixtures and packaged-API smoke checks.
   Expand browser coverage after establishing a stable Chromium baseline.
2. Track the slowest mutation job and summed job durations. Compare full runs
   separately from affected-module PRs; combined results are recorded below.
3. Profile ingestion before adding another runner. Preserve its complete mutation
   scope and thresholds, including extracted-class targets.
4. Keep experimental releases tied to a checked revision and the recovery ledger.
   Production promotion remains a separate decision.

## Mutation ownership after the module split

Each selected module runs its complete mutation scope, including unchanged classes
and all existing target tests. Selection is at the module boundary; there is no
changed-line sampling or incremental PIT history. The full Maven reactor,
dashboard, resilience, Windows and all three packaging checks still run on every PR.

| PR changes | Mutation gates selected |
| --- | --- |
| API Java source or Java tests only | All three API shards and their combined gate |
| Ingestion Java source or Java tests only | Complete ingestion profile |
| Routes Java source or Java tests | Routes, ingestion and all API shards: both services consume routes over HTTP |
| More than one service | Union of the affected service gates |
| Anything in `common`, any POM/build/workflow input, non-static resources, or an unfamiliar path | All gates, including common |
| Only the reviewed documentation/static/frontend paths above | No PIT; each job records the scope decision |
| Main push or manual dispatch | All gates |

The detector verifies the current four-module reactor and its shared dependencies
before narrowing a PR run. A different module/dependency layout falls back to all
gates until reviewed. PR diffs still use the verified merge's first parent and
expand renames into both paths; moving a source between modules selects both.
A failed diff, invalid checkout or invalid scope output fails CI. Matrix jobs
remain present and succeed only after validating their explicit scope result, so
the final gate continues to reject failed, cancelled or unexpectedly skipped jobs.
The API report aggregator follows the API-specific decision, rather than another
module's need for PIT. Selected jobs must produce their retained reports.

`common` owns direct tests for incident geometry, speed-zone definitions and
variable-sign behavior. Service integration tests remain in their services. Its
separate `mutation-common` profile targets every `com.example.common.*` class,
including future shared helpers, and fails on an empty mutation set. It requires
80% mutation detection and 90% PIT line coverage, with two threads. The first local
Java 21 measurement generated 62 mutations, detected 56 (90%), covered 103/108
lines (95%), and completed the Maven invocation in 7.5 seconds. These local times
are diagnostic; hosted setup and runner costs must be measured separately.

Run it with:

```bash
./mvnw -B -ntp -U -s .mvn/public-repositories.xml -pl common -am -Pmutation-common verify
```

The distinct profile prevents repeating common mutations in every service's
`-Pmutation -am` invocation. Common results are retained separately as
`pit-reports-common`; they do not change the API's three-report manifest or combined
score. Existing service targets, operators and thresholds remain unchanged.
Ingestion still has an explicit target-class list, so extracted ingestion behavior
needs a reviewed target update. Clock-independent stagnation tests are described
below; the planned Playwright gate remains a separate follow-up.

## Quality gates

| Job | What it verifies |
| --- | --- |
| `delivery-boundary` | Reject accidental experimental promotion before Maven starts |
| `mutation-scope` | Conservative whole-module PR scope decision with a visible summary; main/manual always require full PIT |
| `build-and-test` | Full Maven reactor, unit and integration tests including disposable PostgreSQL checks, JaCoCo checks |
| `dashboard-tests` | Complete dashboard regression entry point and real historical incident SQL; pinned Node and retained TAP reports |
| `resilience-tests` | Actionlint workflow checks, shell regressions, Compose configuration |
| `mutation-tests (service/shard)` | Full PIT scope across common, routes, ingest and three complementary API shards when selected |
| `api-mutation-complete` | Validate API partitions and enforce the existing combined mutation threshold |
| `container-builds (service)` | Each production Dockerfile builds successfully |
| `windows-backup-tests` | Catch-up behavior and interrupted local archive recovery on Windows |
| `ci-complete` | Every preceding job succeeded; failures, cancellations, and skips fail the gate |

Maven and dashboard checks start independently after the delivery guard; resilience
and Windows checks also run independently. Mutation and container matrices wait
for both Maven and dashboard validation, avoiding expensive work when either
basic suite fails. Each matrix uses `fail-fast: false` so a failure in one service does not
hide results for another. Job timeouts bound hung runs without changing coverage
or mutation thresholds. Routes and ingest still run their ordinary test lifecycle
before mutation analysis. API consumes the compiled classes, test classes, and
resources produced by the successful Maven verification job in the same workflow
run, then invokes PIT directly. SHA-256 hashes and the workflow revision are checked
before analysis; missing or changed files fail the job. This avoids repeating API
compilation and ordinary tests while retaining the full Maven gate. The artifact
expires after one day and is never reused across runs. `-DskipTests` would also
disable PIT and must not be added to mutation commands.

Routes and ingest use `-pl <service> -am test` with their existing profiles. API
uses the direct `org.pitest:pitest-maven:mutationCoverage` goal with the `mutation`
profile plus `mutation-api-web`, `mutation-api-analytics`, or
`mutation-api-support`. The web shard includes every controller family
(`*Controller*`), API filter (`Api*Filter*`) and the extracted `MapIncidentGeometry`
and `MapIncidentPresentation` helpers, including nested classes. The analytics
shard covers `DashboardHistoryBlocks`, `DashboardWindowSummaryService`,
`HistoricalIncidentEpisodes`, `TrafficStagnation`, `TrafficAnomalyAnalysis`,
`TrafficForecast` and `TrafficBaselineSupport`, including nested classes. The
support shard covers everything else within the original API scope; new
controllers join web and other new services join support automatically. Every
shard retains all
existing target tests, mutation operators, and four PIT threads. Results are
neither sampled nor restricted to changed lines.

API shard mutation percentages are not independent quality gates. The aggregation
job sums detected and total mutations, then checks the existing 60% module threshold
read directly from `api-service/pom.xml`, using PIT's integer rounding and
non-perfect-score ceiling. The existing 70% PIT line-coverage threshold is retained
on each API shard, making coverage enforcement at least as strict as the previous
module gate. The full local `mutation` profile remains available with its original
thresholds and scope.

Each API shard records SHA-256 hashes of every compiled class within the original
scope. The aggregation job requires all three reports and identical class manifests,
checks that every compiled class belongs to exactly one partition, rejects mutant
identities duplicated between or within reports, and verifies each reported mutant
belongs to its assigned partition. Empty, malformed, missing, unfinished, or
erroneous results fail the gate. The reports remain available as
`pit-reports-api-web`, `pit-reports-api-analytics`, and `pit-reports-api-support`;
the combined score and each shard's detected/total counts appear in the aggregation
job summary so growing imbalance is visible. Regression tests exercise these failure paths and
threshold boundaries.

Three API shards use one more mutation runner than the previous pair, plus the
existing short aggregation job. Each shard still
performs PIT's coverage discovery and mutation execution; ordinary compilation and
tests are shared from the verified build. It preserves full analysis
before merge. Incremental PIT history is not used: upstream documents incomplete
dependency invalidation in that experimental feature. Changed-class-only PR
analysis is also deferred because it would omit indirect effects on unchanged code
and change the meaning of the existing module score.

Before API sharding, verified PR run
[37552089599](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/37552089599)
finished CI in 4 minutes 42 seconds, with API mutation testing taking 3 minutes
28 seconds. A disposable local comparison of the two partitions reproduced all
1,401 mutation identities and statuses from the full run: 944 detected. Local
timings are diagnostic only; compare GitHub job and pipeline elapsed times,
including report aggregation and runner queueing, to assess the delivered gain.

By November 6, the original controller shortlist had left newer controllers in
support. The first main-based design from PR #357 split 2,153 mutants into
1,202 web / 310 history / 641 support and reproduced every original mutation
identity and status locally. That measurement applies to its main source tree.

On the experimental tree, the same API scope contains 2,096 mutants. The extracted
map and time-series helpers have moved work outside the old controller shortlist.
The revised three groups distribute those existing mutants as 774 web / 736
analytics / 586 support. There is one additional standard runner compared with
the previous two-way experimental gate, and no additional runner compared with
PR #357. Coverage discovery still runs in each shard, so wall time and summed
runner time should both be reviewed. No tests, targets, operators, threads,
timeouts, or quality thresholds are reduced.

The local Java 21 check reproduced all 2,096 mutation identities and all 163
compiled production-class hashes from the baseline CI reports. Both runs score
73% after PIT rounding. The local result detects 1,523 mutants versus 1,524 in
that earlier CI run; eleven status differences occur in `TrafficStagnation`, whose
endpoint tests use the current time and therefore exercise different Denver
operating schedules. The partition change retained its full test set and exposed
that coverage gap.

`TrafficStagnationTest` now calls the existing `assess(corridor, now, latest)` entry
point with explicit observation times and synthetic history. Its 76 parameterized
cases cover I-25 and I-70 schedule boundaries in winter and summer, daylight-saving
transitions, equivalent UTC and +09:00 timestamps, critical flat-run thresholds,
incident overrides, the 12-sample minimum, and distinct-average/repeated-step
severity boundaries. The existing endpoint integration checks remain intact.
These model assertions exercise the scheduled branches independently of when the
runner executes. Full Java verification and the existing combined API mutation
gate remain required. The two-zone mutation comparison uses
the unchanged analytics profile with all of its target tests:

```bash
TZ=UTC ./mvnw -B -ntp -U -s .mvn/public-repositories.xml -pl api-service -am -Pmutation,mutation-api-analytics test
TZ=Pacific/Auckland ./mvnw -B -ntp -U -s .mvn/public-repositories.xml -pl api-service -am -Pmutation,mutation-api-analytics test
```

The local UTC and Auckland runs retained all 736 analytics mutation identities
and produced identical statuses (592 detected), including all 228 stagnation
mutations. Production class hashes matched accepted experimental revision `fab397f`.

History-block timing and PIT timeouts can still change other API mutation statuses.
The retained reports expose those results for review.

## Combined coverage and runtime check

PRs #365 and #366 were checked together at `238b2eb` and accepted into experimental
at `4789af0`. These runs tested the same head; the manual run selected every
mutation gate, while the API-test/documentation PR selected only API mutations.
Job times include setup and reporting and overlap.

| Check | [Full run](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/42349275647) | [API-only PR run](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/42348994287) |
| --- | ---: | ---: |
| Maven verification | 2m00s | 1m55s |
| Common mutations | 21s | PIT omitted; scope confirmed in 4s |
| Routes mutations | 51s | PIT omitted; scope confirmed in 5s |
| Ingestion mutations | 4m16s | PIT omitted; scope confirmed in 5s |
| API web mutations | 3m31s | 3m33s |
| API analytics mutations | 2m00s | 1m39s |
| API support mutations | 4m15s | 3m39s |
| Complete CI | 6m38s | 6m00s |
| Sum of CI job durations | 22m07s | 15m58s |

All 17 CI jobs passed in both runs. Java verification retained 735 tests with
three intentional opt-in skips. Both API reports retained all 2,096 mutation
identities and 163 production-class hashes at 76% detection; two history-block
statuses varied. The full run also passed common, routes and ingestion mutations.

These are individual observations, not guaranteed savings or billed minutes.
Ingestion and API support finished almost together in the full run, so improving
API-only feedback may leave ingestion as the full-run bottleneck.

Local profiling did not justify another configuration change. Repartitioning
reduced the slowest shard from 95.3s to 89.1s but increased total invocation time
from 211.9s to 229.3–233.6s. Two workers made support slower at 104.5s. Keep the
existing three API groups and four workers; revisit after a sustained hosted
regression, with the complete mutation scope and quality thresholds preserved.

Maven dependency caches include all POMs, the wrapper configuration, and
`.mvn/public-repositories.xml`. CI and all three container builders explicitly
use that secret-free settings file to mirror external dependency and plugin
repositories to canonical HTTPS Maven Central. This prevents transitive POMs
from sending public dependency resolution to an authenticated package registry.
Local file and reactor dependencies are not mirrored. Private dependencies would
require a separately reviewed repository policy; none are needed by this project.

These builds use `-U` to recheck missing releases rather than retaining a cached
failed download. Pinned release versions are unchanged. The settings file is
copied before the Docker dependency-warming step, so a repository-policy change
invalidates that layer. There are no new credentials, unbounded retries, or relaxed
test gates. To reproduce the CI resolver locally, use
`./mvnw -B -ntp -U -s .mvn/public-repositories.xml clean verify`.

Docker BuildKit caches use separate dependency-only service scopes, so parallel
images do not overwrite each other's cache. The `dependencies` target includes
the pinned Maven image, reactor POMs, public repository policy, and downloaded
dependencies. Compiled code and application source layers are not uploaded.
Each builder copies only `common/` and its own `src/`, not the entire repository;
unrelated documentation or another service's source no longer invalidates packaging.
All reactor POMs remain present so Maven can select the requested module and its
dependencies correctly. Maven verification runs on every revision, and PIT runs
on every required revision. PR caches retain GitHub's branch isolation; main does
not consume PR-only caches.

Image validation and dependency-cache publishing are separate visible steps using
the same builder. Cache imports and exports have a two-minute timeout, with an
outer three-minute limit on publishing; image validation has a six-minute limit
and the container job has a ten-minute limit. Cache failures still fail the job:
there is no `ignore-error`, `continue-on-error`, or automatic retry to hide trouble.
The scopes end in `-dependencies-v1` to avoid importing old application-layer caches.
The first run must populate these scopes; compare cold and warm runs before claiming
a timing improvement. The triggering API job in run
[38033314009](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/38033314009)
built in about 30 seconds but spent 18 minutes exporting application build layers.
The dependency-only export removes that per-edit upload; this is not a guarantee
against registry, Maven Central, or GitHub cache outages.

Run `./scripts/test-container-build-cache.sh` for the disposable build regression.
It checks that another service's resource and unrelated context changes do not
invalidate packaging, owned/shared resources do invalidate packaging, and the
dependency target's image identity remains unchanged across those source edits.
It builds from tracked files in a temporary context without restarting services
or pruning the local Docker cache. It requires a running Docker daemon.

Container jobs configure Google's public Docker Hub cache on the disposable
runner's Docker daemon before downloading BuildKit, and on BuildKit itself for
base-image resolution. BuildKit bootstrap is pinned to the publisher's manifest
digest rather than resolving a mutable tag on every runner. Verify publisher
and cache digest parity when updating this pin. Existing daemon settings and ordered fallback mirrors
are preserved. Cache misses still fall back to Docker Hub; image names and
pinned digests, TLS verification, all three builds, and failure gates are
unchanged. This avoids repeated Hub authentication and throttling when the exact
public images are cached; it cannot guarantee success during an outage affecting
both the cache and upstream. No registry account, published image, production
daemon change, or local Docker restart is required. Do not prune local caches
to resolve a remote HTTP429 or authentication timeout.

Test, integration, coverage, and PIT reports are uploaded even after failures and
retained for seven days. Docker build records also expire after seven days. Download
the service- or shard-specific PIT artifact and open `index.html` to investigate surviving
mutants. Maven runs in batch mode without download-progress noise. Third-party
actions use verified full commit pins, checkout does not retain credentials, and
CI needs no production or provider secrets. Actionlint's binary is version-pinned
and its archive is checked against the upstream SHA-256 before extraction.

## Delivery boundary

The `delivery-boundary` job runs before Maven. An experimental integration carries
`.github/experimental-integration.json` with its `base_branch`, for example
`experiment/dashboard-reconstruction`. Its topic PRs must target that integration;
a marked tree cannot target `main`. CI also inspects the base revision's marker,
so removing the marker in a topic does not bypass the destination check. Removing
the marker or changing its destination is rejected. Manual topic validation remains available and does
not authorize deployment. This guard prevents accidental promotion, not malicious
workflow edits; reviewed PRs and repository protection remain necessary.

API mutation runners install the existing `common` reactor module before invoking
PIT against verified API bytecode. Only that dependency installation uses
`-DskipTests`; the preceding full Maven gate and PIT execution are unchanged. This
supports dashboard APIs that depend on the shared corridor definitions without
rebuilding or replacing the verified API classes.

GitHub CI validates changes; the VPS delivery mechanism remains the documented
systemd updater from main. This change does not publish images, access production,
merge PRs, or replace the updater. Container build success verifies packaging; it
does not replace readiness, live ingestion, history, quota, or timer checks after
deployment. Follow [the deployment runbook](cloud-vps-deployment.md) and
[AGENTS.md](../AGENTS.md) for reviewed revisions, data protection, and rollback.

On October 7, 2026, the repository's `Reviewed main delivery` ruleset was enabled
(ID `24631611`). It requires PRs, up-to-date branches, `ci-complete`, and the four
verified CodeQL check names: `Analyze (actions)`, `Analyze (java-kotlin)`,
`Analyze (python)`, and `Analyze (javascript-typescript)`. Required checks are
bound to the GitHub Actions integration. Deletion and force pushes are prohibited;
there are no bypass actors. Unresolved review threads block merging. No additional
human approval count is imposed: maintainer-authorized automated validation and
merging remain possible. The pending prerequisite PR #119 became blocked after
these rules were enabled. Check names were established from the successful
post-revert main checks, not guessed.

The updater still follows origin/main without querying CI itself. Repository
protection enforces PR validation before revisions reach main; it does not replace
operator authority, a successful exact-revision delivery check, or live verification.
The settings rollout and verification are tracked in
[issue #112](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/112).
Experimental integration receives separate destination and merge safeguards; it
must never be retargeted to main as a convenience.

A registry-based immutable-image deployment would need a separate design covering
image provenance, VPS authentication, reviewed commit selection, rollback, and
live verification. For this single-host project it is deferred until it provides
a concrete operational benefit over the current deployment pattern.

## Validation and rollback

Before opening a PR, run actionlint, `./mvnw clean verify`,
`./scripts/verify-resilience.sh`, and the scope regression tests:
`python3 -B -m unittest discover -s scripts/ci -p 'test_*.py'`. The PR must also pass every mutation shard,
container build, Windows regression, the final gate, and applicable CodeQL checks.
Inspect the slowest job, artifact contents, and the second run's cache hits before
claiming a performance improvement. A cold container cache adds work on the first
run; subsequent runs reuse dependency and image layers.

Revert the workflow commit to restore the previous CI behavior. If `ci-complete`
has become a required repository check, update that setting as part of a revert
so an absent check cannot block PRs. Workflow rollback requires no database or
production change.

## Primary references

- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Pull-request merge refs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- [Node setup and version files](https://github.com/actions/setup-node)
- [Node test reporters](https://nodejs.org/docs/latest-v24.x/api/test.html#test-reporters)
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Java and Maven caching](https://github.com/actions/setup-java)
- [Maven repository mirrors](https://maven.apache.org/guides/mini/guide-mirror-settings)
- [Maven 3.10.0 command-line options](https://maven.apache.org/ref/3.10.0/maven-embedder/cli.html)
- [Docker build cache in GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/)
- [BuildKit registry mirrors](https://docs.docker.com/build/buildkit/configure/#registry-mirror)
- [Google's public Docker Hub cache and fallback](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images)
- [PIT Maven configuration](https://pitest.org/quickstart/maven/)
- [PIT incremental-analysis limitations](https://pitest.org/quickstart/incremental_analysis/)
- [MockMvc setup options](https://docs.spring.io/spring-framework/reference/6.2/testing/mockmvc/setup-options.html)
- [Actionlint](https://github.com/rhysd/actionlint)
