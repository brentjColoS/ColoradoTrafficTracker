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
PIT is omitted only when a PR changes exclusively root Markdown, `docs/`, static
web assets under `api-service/src/main/resources/static/`, or the exact frontend
test files `scripts/tests/dashboard.test.cjs` and `scripts/tests/dashboard-preview.cjs`.
The JavaScript suite runs in the build gate whenever it exists; the experimental
integration keeps its unconditional frontend test step. The production baseline
has no such suite yet, and this CI prerequisite does not import experimental UI.
No broad `scripts/` or test-directory exclusion is allowed. Java, Java tests, resources,
POMs, wrappers, workflows, the scope detector itself, and any unrecognized path
require full mutation analysis. Main pushes and manual dispatch always require
PIT. Scope detection uses the PR merge checkout's base commit and a shallow checkout
with both merge parents. Missing revisions or invalid detector outputs fail CI;
renames are expanded into deletions and additions so moving Java into documentation
cannot bypass analysis.

## Quality gates

| Job | What it verifies |
| --- | --- |
| `delivery-boundary` | Reject accidental experimental promotion before Maven starts |
| `mutation-scope` | Conservative PR scope decision; main/manual always require full PIT |
| `build-and-test` | Full Maven reactor, unit and integration tests, JaCoCo checks |
| `resilience-tests` | Actionlint workflow checks, shell regressions, Compose configuration |
| `mutation-tests (service/shard)` | Full PIT scope across routes, ingest and two complementary API shards when required |
| `api-mutation-complete` | Validate API partitions and enforce the existing combined mutation threshold |
| `container-builds (service)` | Each production Dockerfile builds successfully |
| `windows-backup-tests` | Catch-up behavior and interrupted local archive recovery on Windows |
| `ci-complete` | Every preceding job succeeded; failures, cancellations, and skips fail the gate |

Maven, resilience, and Windows checks run independently. Mutation and container
matrices start after Maven succeeds, avoiding expensive work when the basic suite
fails. Each matrix uses `fail-fast: false` so a failure in one service does not
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
profile plus either `mutation-api-web`
or `mutation-api-support`. The web shard includes the dashboard and traffic
controllers, API filters, and mile-marker analytics controller, including nested
classes. The support shard covers everything else within the original API scope;
new classes are included automatically. Every shard retains all existing target
tests, mutation operators, and four PIT threads. Results are neither sampled nor
restricted to changed lines.

API shard mutation percentages are not independent quality gates. The aggregation
job sums detected and total mutations, then checks the existing 60% module threshold
read directly from `api-service/pom.xml`, using PIT's integer rounding and
non-perfect-score ceiling. The existing 70% PIT line-coverage threshold is retained
on each API shard, making coverage enforcement at least as strict as the previous
module gate. The full local `mutation` profile remains available with its original
thresholds and scope.

Each API shard records SHA-256 hashes of every compiled class within the original
scope. The aggregation job requires both reports and identical class manifests,
checks that every compiled class belongs to exactly one partition, rejects mutant
identities duplicated between or within reports, and verifies each reported mutant
belongs to its assigned partition. Empty, malformed, missing, unfinished, or
erroneous results fail the gate. Both shard reports remain available as
`pit-reports-api-web` and `pit-reports-api-support`; the combined score is displayed
in the aggregation job summary. Regression tests exercise these failure paths and
threshold boundaries.

Sharding adds one mutation runner and a short aggregation job. Each shard still
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

Docker
BuildKit caches use separate service scopes, so parallel images do not overwrite
each other's cache. Only dependencies and build layers are cached; Maven results are recomputed on every run, and PIT results on every required run. PR caches follow GitHub's branch isolation;
main does not consume PR-only caches.

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
