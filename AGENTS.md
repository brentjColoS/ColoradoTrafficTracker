# Project working agreement

Read this file before changing Colorado Traffic Tracker. It records the working
style expected for repository changes, reviews, and production operations.
`CONTRIBUTING.md` describes the public contribution baseline; this file adds the
project-specific decisions that every coding agent should carry between tasks.

## Start with the current state

1. Read the user's current request and the relevant repository docs before
   proposing changes.
2. Inspect `git status`, the active branch, recent commits, and overlapping work.
   Preserve user changes and do not reuse a dirty checkout for unrelated work.
3. Confirm actual runtime behavior, data shape, or provider response before
   designing an integration. Do not build against a guessed payload.
4. For production work, inspect the live revision and health first. Treat the
   repository, VPS, Windows backup host, and provider dashboards as separate
   states that may not yet match.

## Keep the work small and legible

- Use one topic branch per coherent problem. Start from current `main` unless the
  task explicitly continues an existing branch.
- Name branches after the work, such as `fix/cdot-marker-filtering`,
  `ops/disk-headroom-alert`, or `docs/project-working-agreement`. Do not put tool
  or agent branding in branch names, commits, issues, or pull requests.
- Prefer the smallest complete change that solves the stated problem. Avoid broad
  cleanup, speculative abstractions, new services, and configuration that is not
  needed yet.
- Make focused commits at natural review points. Each commit should leave the
  branch understandable and, when practical, runnable.
- Write short imperative commit subjects in normal language, for example
  `Preserve CDOT incidents across flow polls` or `Document the backup restore
  drill`. Conventional-commit prefixes are optional, not required.
- Favor clear names and small methods over explanatory comments. Add a comment
  only when it protects a non-obvious invariant, compatibility rule, or
  operational constraint.

Create an issue when the work benefits from a durable problem statement,
multiple pull requests, deferred follow-up, or operator coordination. A small
self-contained fix does not need ceremonial issue overhead.

## Implement iteratively

Use this loop:

1. Establish the existing behavior with code, tests, logs, database queries, or
   a bounded live check.
2. Implement one narrow behavior change.
3. Run the closest useful tests and inspect the result.
4. Commit the coherent step with a human-readable message.
5. Repeat only while the next step remains in scope.
6. Run the broader required checks before opening or updating the pull request.

Experiments that may be discarded should use an isolated worktree or branch.
Do not mix them into the delivery branch.

## Protect the data and provider budgets

- Historical traffic is a product asset. Preserve current and archived samples,
  durable incident events, speed-zone history, quota records, and reset evidence.
- Retention moves old live rows into queryable archive tables. Do not make older
  data inaccessible, truncate history, or introduce destructive migrations
  without explicit approval and a tested recovery path.
- Use additive Flyway migrations. Never edit an applied migration. Database image
  changes require a fresh backup and restore verification.
- Keep the archive-inclusive API and analytics views working when storage changes.
  When exact historical coverage differs by dataset, document the boundary.
- Inspect third-party formats before mapping them. CDOT incidents must be filtered
  to the tracked corridor and mile-marker ranges, and UI labels must describe the
  actual source and accuracy.
- Treat TomTom accounts as separate allowances. Keep primary-first rollover,
  per-account counters, full-batch reservations, and application hard stops.
  Live diagnostics should use the fewest provider requests necessary.
- Never commit, print, log, or paste provider keys, database passwords, ping URLs,
  private keys, or populated environment files. Examples use placeholders only.

## Keep operational status truthful

- Repeated traffic values can be normal. Determine freshness from successful
  observations rather than assuming unchanged speeds mean failure.
- `OUT_OF_SERVICE` is reserved for loss of usable flow across the monitored
  corridors or another condition that truly prevents service. One unavailable
  TomTom account is not an outage while another can continue ingestion.
- Every degraded or failure state must include a concrete reason and a useful
  next action. Avoid warnings that merely say a component is unhealthy.
- Monitoring should remain low-maintenance. The current production pattern is a
  twice-daily Healthchecks report, a one-hour freshness allowance for flow and
  CDOT data, an eight-day off-site-backup limit, and a warning at 10 GB available
  disk space.
- Prefer recovery actions that preserve data. Do not automatically prune database
  history to resolve disk pressure.

## Test in proportion to risk

Run the smallest relevant test first, then the repository gates appropriate to
the change:

- Java or API behavior: `./mvnw clean verify`.
- Compose, operations, monitoring, or recovery behavior:
  `./scripts/verify-resilience.sh` and the focused shell test.
- Windows backup behavior: the PowerShell tests under
  `operations/windows-backup`; CI runs these on Windows.
- Mutation-sensitive Java behavior: the existing mutation profile or required
  pull-request job.
- Docker/runtime changes: render or build Compose and inspect service health.
- Database or backup changes: verify checksums and perform a disposable restore
  when the change can affect recoverability.

Do not add tests that only repeat an implementation detail. Add tests for the
behavior, failure mode, or invariant that made the change necessary. If a CI job
fails, diagnose and fix the cause; do not weaken the gate to obtain a green run.

## Write reviewable GitHub artifacts

Pull requests should read as if written by a careful maintainer. Use the template
and include:

- the concrete problem and resulting behavior;
- a concise scope summary;
- relevant validation with real results;
- configuration, migration, rollout, or rollback notes when applicable;
- known limitations that affect a reviewer or operator.

Keep the title direct and natural. Remove planning history, abandoned approaches,
agent narration, and inflated claims. Update the title and description if the
implementation changes direction.

Open the pull request after local validation, then wait for all applicable checks.
Do not merge merely because checks are green. Merge when the user has asked for
it or the active task explicitly includes merge authority. Keep major framework
upgrades separate from routine dependency updates; follow
`docs/runtime-version-policy.md`.

## Deploy deliberately

- Production runs from `main`. Do not leave the VPS on a feature branch.
- Deploy only the reviewed revision after merge authority is clear. Confirm the
  exact commit and expected file scope before changing the server.
- Preserve private environment files and live data volumes. Never replace secrets
  from repository examples.
- For application deployments, verify readiness, fresh I-25 and I-70 samples,
  CDOT snapshot/provider metadata, TomTom quota status, historical row continuity,
  and required systemd timers. A container merely being `Up` is not sufficient.
- For script-only operational changes, avoid unnecessary container restarts and
  run the affected service or check directly.
- If deployment verification fails, diagnose and restore the last known-good
  revision. Report the evidence and resulting live state.

Relevant runbooks include:

- `docs/cloud-vps-deployment.md`
- `docs/dashboard-experiment-status.md`
- `docs/dashboard-build-readiness.md`
- `docs/healthchecks-io-monitoring.md`
- `docs/windows-offsite-backups.md`
- `docs/tomtom-two-account-operations.md`
- `docs/data-history-coverage.md`
- `docs/incident-event-operations.md`

## Definition of done

A change is complete when the requested behavior is implemented, focused and
broader validation are green, documentation and examples match reality, the pull
request is reviewable, and any authorized deployment is verified from the user's
point of view. Summarize what changed, why it matters, what was tested, and any
remaining decision the user actually needs to make.
