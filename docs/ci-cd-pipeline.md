# CI and delivery pipeline

Every PR receives the applicable verification gates before merge. Main pushes and
manual dispatches also run CI. Required checks cover application behavior,
browser presentation, mutation sensitivity, packaging and build provenance.
Production delivery is a separate operation from successful CI.

PIT is the Java mutation-testing tool: it changes selected program behavior and
checks whether the test suite detects those changes. Its mutation score measures
that sensitivity; line coverage measures a different property.

The workflow is in [ci.yml](../.github/workflows/ci.yml). Historical optimization
results are retained in the [measurement record](evidence/ci-optimization-measurements.md);
they describe their original runs rather than current pipeline duration.

## Triggers and scope

CI runs on every PR, pushes to main, and manual dispatch. Branch work can be
checked before a PR through the Actions UI. New PR revisions cancel obsolete runs;
main and manual runs are not actively cancelled by newer runs. GitHub concurrency
retains at most one pending run per group, so intermediate queued revisions can be
superseded. The workflow is never filtered by changed paths, so required checks are always
reported. Full Maven, resilience, Windows, and packaging checks run on every PR.
PIT is omitted only when a PR changes exclusively root Markdown, `docs/`, static
web assets under `api-service/src/main/resources/static/`, or the exact frontend
test files `scripts/tests/dashboard.test.cjs` and `scripts/tests/dashboard-preview.cjs`.
Dashboard and existing visitor regressions run on the pinned Node version.
Browser and packaged API tests are required except on verified docs-only PRs.
The packaged job uses revision- and checksum-verified JARs from the Maven gate
and runs against disposable PostgreSQL, not production or a provider account.
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
| `portfolio-docs` | Offline image-publisher behavior and repository/wiki documentation links |
| `delivery-boundary` | Reject accidental experimental promotion before Maven starts |
| `mutation-scope` | Conservative PR scope decision; main/manual always require full PIT |
| `build-and-test` | Full Maven reactor, unit and integration tests, JaCoCo checks |
| `dashboard-tests` | Dashboard, Why, motion, historical SQL, and production visitor tests |
| `browser-tests` | Pinned Chromium tests for dashboard behavior, accessibility, mobile, and reviewed visuals |
| `browser-api-smoke` | Real packaged runtime and browser checks with disposable PostgreSQL |
| `verify-maven-cache` | Exact prepared dependency-cache restoration and offline resolution on a fresh runner |
| `resilience-tests` | Actionlint workflow checks, shell regressions, Compose configuration |
| `mutation-tests (service/shard)` | Full PIT scope across routes, ingest and three complementary API shards when required |
| `api-mutation-complete` | Validate API partitions and enforce the existing combined mutation threshold |
| `container-builds (service)` | Each production Dockerfile builds successfully |
| `verify-docker-cache` | Fresh-builder restoration of all three dependency RUN layers after an application-source edit |
| `windows-backup-tests` | Catch-up behavior and interrupted local archive recovery on Windows |
| `ci-complete` | Every preceding job succeeded; failures, cancellations, and skips fail the gate |

## Mutation analysis and artifact provenance

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
profile plus `mutation-api-web`, `mutation-api-analytics`, or
`mutation-api-support`. The web shard covers controllers, API filters, and map
presentation. Analytics covers history blocks, window summaries, incident episodes,
and trend calculations. Support covers everything else within the original API scope;
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
scope. The aggregation job requires every shard report and identical class manifests,
checks that every compiled class belongs to exactly one partition, rejects mutant
identities duplicated between or within reports, and verifies each reported mutant
belongs to its assigned partition. Empty, malformed, missing, unfinished, or
erroneous results fail the gate. The three reports remain available as
`pit-reports-api-web`, `pit-reports-api-analytics` and `pit-reports-api-support`.
The aggregation summary displays the combined score. Regression tests exercise
these failure paths and threshold boundaries.

Each shard performs PIT's coverage discovery and mutation execution; ordinary
compilation and tests are shared from the verified build. It preserves full analysis
before merge. Incremental PIT history is not used: upstream documents incomplete
dependency invalidation in that experimental feature. Changed-class-only PR
analysis is also deferred because it would omit indirect effects on unchanged code
and change the meaning of the existing module score.

## Dependency and image caches

Maven dependency caches include all POMs, the wrapper and its configuration,
`.mvn/public-repositories.xml`, `.mvn/maven.config`, and the preparation script.
The local Maven-cache action defines these inputs once; neither workflow YAML
nor Docker configuration is part of the key. CI and all three container builders explicitly
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

The wrapper's `.mvn/maven.config` bounds native Resolver HTTP recovery: four
transfer retries for HTTP 429/503, five-second initial backoff capped at ten
seconds, ten-second connect and sixty-second inactivity limits. Each Docker
dependency stage copies this same policy before resolving dependencies. Persistent
upstream failures remain failures; no compiler, test, mutation or whole-job retry
is introduced, and existing job deadlines remain unchanged.

After Maven verification, `scripts/ci/probe_maven_transfers.py` checks the actual
resolver against a loopback repository: a transient 429 recovers, persistent
429/503 stop after the initial request plus four retries, and a missing artifact
gets one request. The probe first loads its pinned dependency-plugin tooling from
the existing public repository policy; simulated responses never come from Maven
Central. Run the same command locally with a prepared Maven cache.

The primary verified build is the only Maven cache producer. Before verification
it resolves the normal and existing `mutation` profiles, plus the standalone
`scripts/ci/maven-cache/pom.xml`. That cache-only POM inherits root version
management and prepares JUnit Platform Launcher, which PIT otherwise resolves at
runtime outside `go-offline`'s plugin graph. It is not a reactor module, runtime
dependency or Dockerfile input. Main retains its four existing mutation workers;
no experimental common or analytics profiles are imported.

When mutations are selected, the verified build also installs `common` and loads
the pinned PIT help goal before saving. This does not replace actual mutation
testing or modify verified API bytecode. Mutation workers restore read-only and
cannot race to publish incomplete immutable caches.

On an exact-key miss, the producer may seed its public local repository from a
cache available under GitHub's normal branch restrictions, then resolve current
coordinates and policy. The restore-only seed is not an exact-hit claim. Existing
wrapper caches have a different cache version and cannot substitute for the Maven
repository. Only a successful job saves the new key; no credentials are cached.

The required `verify-maven-cache` job runs on a separate fresh runner after the
verified build. It changes Docker workflow text, requires an exact current-key
hit with no fallback and no save, then resolves the complete prepared set with
`--offline`. A successful cold download or partial seed cannot satisfy this gate.
This proof runs before merge and on main pushes; main's existing build supplies
the cache rather than introducing a second experimental-style warming pipeline.

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
and the container job has a ten-minute limit. Only dependency-cache export uses
`ignore-error=true`: an unavailable upload does not turn a valid image build into
a failure. Dependency resolution, compilation, image builds and the independent
reuse proof still fail normally. No job-level `continue-on-error` or automatic
build/test retry is introduced.
The scopes end in `-dependencies-v1` to avoid importing old application-layer
caches. Compare cold and warm runs before claiming a timing improvement; a green
image build does not itself prove dependency-cache reuse.

CI pins the producer and fresh consumer to BuildKit 0.35.0, using the same verified
publisher manifest digest. This replaces 0.33.1's problematic cross-run matching;
main's earlier green image run reported missing cache blobs and reexecuted Maven
resolution, so build success alone was insufficient evidence of cache reuse.
Application runtime images and Maven versions remain unchanged.

After all three ordinary image jobs succeed and publish their dependency caches,
the required `verify-docker-cache` job starts on a separate GitHub-hosted runner
and clean builder. It changes an application resource, imports each service's
dependency target with no cache export, and reads the actual Buildx records.
Every matching dependency RUN vertex must be complete and explicitly `cached`;
successful reexecution, absent/ambiguous records and failed log reads are failures.
Thus an optional export outage only passes when a usable matching cache still
exists. Main's existing image jobs remain the sole producers; no extra warming
workflow, privileged trigger or broader permissions are added.

Run `./scripts/test-container-build-cache.sh` for the disposable build regression.
It checks that another service's resource and unrelated context changes do not
invalidate packaging, owned/shared resources do invalidate packaging, and the
dependency target's image identity remains unchanged across those source edits.
It also exports each dependency target and resolves its dependencies offline in
a container with networking disabled. This local check complements, but does not
replace, the separate hosted fresh-runner restore proof.
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

## Reports and diagnostics

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
systemd updater from main. CI does not publish images, access production or replace
the updater. Container build success verifies packaging; it does not replace
readiness, live ingestion, history, quota or timer checks after deployment.
Follow [the deployment runbook](cloud-vps-deployment.md) for reviewed revisions,
data protection and rollback.

The reviewed-main delivery policy requires PRs, up-to-date branches,
`ci-complete` and the four CodeQL checks: `Analyze (actions)`,
`Analyze (java-kotlin)`, `Analyze (python)` and `Analyze (javascript-typescript)`.
Checks are bound to GitHub Actions. Force pushes/deletion and unresolved review
threads are blocked, with no bypass actors or additional approval-count gate.
The [ruleset record](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/112)
documents its setup; inspect repository settings when changing enforcement.

The updater still follows origin/main without querying CI itself. Repository
protection enforces PR validation before revisions reach main; it does not replace
operator authority, a successful exact-revision delivery check, or live verification.
Experimental integration receives separate destination and merge safeguards; it
must never be retargeted to main as a convenience.

A registry-based immutable-image deployment would need a separate design covering
image provenance, VPS authentication, reviewed commit selection, rollback, and
live verification. For this single-host project it is deferred until it provides
a concrete operational benefit over the current deployment pattern.

## Validation and rollback

For workflow or application changes, run actionlint, `./mvnw clean verify`,
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
