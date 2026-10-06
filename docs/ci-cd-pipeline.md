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
the actual result. Compare the completed jobs after rollout rather than treating
that estimate as a measured speedup.

CI now runs on every PR, pushes to main, and manual dispatch. Branch work can be
checked before a PR through the Actions UI. New PR revisions cancel obsolete runs;
main and manual runs are not actively cancelled by newer runs. GitHub concurrency
retains at most one pending run per group, so intermediate queued revisions can be
superseded. Every PR runs the complete gate, including documentation-only changes,
which avoids path-filtered required checks being left pending.

## Quality gates

| Job | What it verifies |
| --- | --- |
| `build-and-test` | Full Maven reactor, unit and integration tests, JaCoCo checks |
| `resilience-tests` | Actionlint workflow checks, shell regressions, Compose configuration |
| `mutation-tests (service)` | Full PIT profile for each service and its dependencies |
| `container-builds (service)` | Each production Dockerfile builds successfully |
| `windows-backup-tests` | Catch-up behavior and interrupted local archive recovery on Windows |
| `ci-complete` | Every preceding job succeeded; failures, cancellations, and skips fail the gate |

Maven, resilience, and Windows checks run independently. Mutation and container
matrices start after Maven succeeds, avoiding expensive work when the basic suite
fails. Each matrix uses `fail-fast: false` so a failure in one service does not
hide results for another. Job timeouts bound hung runs without changing coverage
or mutation thresholds. PIT still runs its ordinary test lifecycle before mutation
analysis; `-DskipTests` would also disable PIT and must not be added to this command.

The mutation matrix uses the existing Maven profile with `-pl <service> -am test`.
It preserves all configured classes, tests, operators, thread counts, and per-service
thresholds. Results are neither sampled nor restricted to changed lines. This
trades some runner minutes and repeated common-module compilation for a shorter
feedback loop and clear service-level failures. Incremental PIT history is not
used: upstream documents incomplete dependency invalidation in that experimental
feature. Full analysis remains the merge gate.

Maven dependency caches include all POMs and the wrapper configuration. Docker
BuildKit caches use separate service scopes, so parallel images do not overwrite
each other's cache. Only dependencies and build layers are cached; Maven and PIT
results are recomputed on every run. PR caches follow GitHub's branch isolation;
main does not consume PR-only caches.

Test, integration, coverage, and PIT reports are uploaded even after failures and
retained for seven days. Docker build records also expire after seven days. Download
the service-specific PIT artifact and open `index.html` to investigate surviving
mutants. Maven runs in batch mode without download-progress noise. Third-party
actions use verified full commit pins, checkout does not retain credentials, and
CI needs no production or provider secrets. Actionlint's binary is version-pinned
and its archive is checked against the upstream SHA-256 before extraction.

## Delivery boundary

GitHub CI validates changes; the VPS delivery mechanism remains the documented
systemd updater from main. This change does not publish images, access production,
merge PRs, or replace the updater. Container build success verifies packaging; it
does not replace readiness, live ingestion, history, quota, or timer checks after
deployment. Follow [the deployment runbook](cloud-vps-deployment.md) and
[AGENTS.md](../AGENTS.md) for reviewed revisions, data protection, and rollback.

At assessment time, main had no classic branch protection and no repository
ruleset. The updater follows origin/main without querying CI, so a green badge
alone does not enforce a delivery gate. Configure a main-branch ruleset requiring
pull requests and `ci-complete`, plus the existing CodeQL check after confirming
its exact check name. Require the branch to be current before merging, prevent
force pushes/deletion, and keep bypass permissions narrow. Establish these checks
from an actual PR run before requiring them. This is a repository-settings rollout
step, separate from the workflow change; it has not been enabled by this PR.
Track that rollout in [issue #112](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/112).

A registry-based immutable-image deployment would need a separate design covering
image provenance, VPS authentication, reviewed commit selection, rollback, and
live verification. For this single-host project it is deferred until it provides
a concrete operational benefit over the current deployment pattern.

## Validation and rollback

Before opening a PR, run actionlint, `./mvnw clean verify`, and
`./scripts/verify-resilience.sh`. The PR must also pass every mutation shard,
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
- [Docker build cache in GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/)
- [PIT Maven configuration](https://pitest.org/quickstart/maven/)
- [PIT incremental-analysis limitations](https://pitest.org/quickstart/incremental_analysis/)
- [Actionlint](https://github.com/rhysd/actionlint)
