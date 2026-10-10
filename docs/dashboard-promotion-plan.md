# Primary dashboard promotion

## Intended result

Serve the currently deployed newer dashboard at `/dashboard/` from reviewed
`main`. Keep `/dashboard-old/` and `/dashboard-experimental/` as unadvertised,
read-only sidecars that are built and started deliberately. Neither sidecar
starts during production deployment, update, rollback or reboot. Preserve the
accepted palette, layout, motion, incident semantics and historical coverage.

## Baseline — October 10, 2026, Denver time

- Local main source: `0bcedf303746ea28398143e1ba6cffe95e31563f`.
- Live production checkout: clean main at
  `d6f31abef704bc00c3edfb2322255ef36012f4cf`; API on loopback port 8080.
- Live experimental checkout/image:
  `e47a291b64564cf4fac01a5df330ec301bfe44ba`; API on loopback port 8083.
- Reviewed experimental branch: `6224db5`; it differs from the live release.
  Preserve the deployed incident-scroll handoff (`behavior: instant`) and its
  tests. Do not silently exchange the live release for a different toolbar.
- Production operational status is HEALTHY, with fresh I25/I70/CDOT evidence.
  Experimental readiness is UP. PostgreSQL remains the existing V26 schema.
- Production auto-update, health-report and backup timers are active. Disk has
  approximately 27 GiB available; available memory is approximately 3.4 GiB.
- Main and experimental integration rules require a PR, ci-complete and four
  CodeQL checks. Neither ruleset permits bypass.
- Main has newer Maven/container/CI work. Retain it; import application scope,
  not an entire old integration or its reverted ancestry.

Recheck this baseline before every rollout stage. Observations are dated
snapshots, not continuing guarantees of live state.

## Authority and preservation

The current request authorizes implementation and preparation of the requested
promotion. Prepare the exact reviewed candidate, validation and rollback before
requesting any remaining merge/cutover approval. No production mutation is
needed while building the reviewable result. Never infer deployment authority
from a green CI result or from old experimental release permissions.

Preserve original source commits with named checkpoint refs and retain running
and previous application images before cutover. Keep the original working
checkout and unrelated branches untouched. Keep a small ledger of source scope,
commits, PR/check results and rollout evidence. Checkpoint refs must be available
from the remote so a clean clone can rebuild either preserved release.

No schema migration, database-image replacement, retention change or duplicate
ingestion is planned. Never remove volumes, rows, archives or provider evidence.
Private configuration remains host-local and must never be printed. No diagnostic
traffic-provider requests are needed.

## Stage 1 — establish reproducible sources

1. Work in a clean topic branch from current main in an isolated worktree.
2. Preserve the original-dashboard source and exact deployed experimental
   source under dated checkpoint refs; verify ref identity before publishing.
3. Inventory the application patch: API Java/resources/tests, frontend assets,
   common-module dependency and required configuration. Exclude migrations,
   ingestion/routes changes, experimental marker and unrelated build tooling.
4. Record intentional differences from the live source. Preserve source styling
   and behavior; no redesign or broad cleanup belongs in this change.

## Stage 2 — promote the accepted application

1. Import the complete API/frontend behavior and its existing regression tests.
2. Make continuous/prepared history default on for primary and experimental
   mounts. Historical scrolling itself remains initially disabled.
3. Separate public replay policy from pathname. Shared-production readers retain
   bounded history exploration; isolated local replay remains explicitly usable.
4. Carry routes-service and map configuration into the primary API without
   replacing production authentication keys or exposing secrets.
5. Run frontend and nearest API checks first. Commit the coherent application
   step. Retain current main Maven, Dockerfile and CI changes.

## Stage 3 — add manually managed sidecars

Use two separate optional Compose projects, loopback ports 8083 and 8084, and the
existing production network. They own no database, routes, ingestion or volumes.
Use read-only database logins, read-only pool/root filesystem, disabled Flyway,
resource/log limits, no provider credentials and restart policy `no`.

Provide small build/start/stop/status/verify/log helpers. Build committed source
from its explicit Git revision in a temporary archive context, excluding local
secrets and uncommitted files. Build must never start a container. Start must
require an already built revision-tagged image; stop must retain images/source
and never operate on production. Preserve default source refs while allowing an
explicit committed development ref for experimental builds.

Adapt only the preserved legacy static asset/API prefixes during its build so
Caddy can mount it at `/dashboard-old/`. Keep its original API source and visual
assets. Test the transformation, including road-sign images, and ensure legacy
requests cannot reach primary assets or API. Document the adaptation recipe.

## Stage 4 — proxy and operator behavior

Keep `/` redirecting to `/dashboard/`. Primary UI/API/health remain on 8080.
Experimental UI/API/health remain on 8083. Give old UI/API their own prefixes on
8084. Optional upstream connection failures return an unadvertised 404, without
falling through to primary. Optional responses carry noindex headers.

Do not advertise the sidecars in public UI, navigation or promotional material.
Record lifecycle details in the operator runbook. Optional health is excluded
from production heartbeat and automatic rollback. Preserve production project
name `colorado-traffic-tracker` and the separate experimental project identity.

## Stage 5 — complete review and verification

- Run `./mvnw clean verify`, frontend tests, resilience/focused shell checks,
  Compose validation, container packaging and source-scope regressions.
- Check both public mounts, primary preparation, replay restriction, legacy URL
  isolation, independent build/start/stop, unavailable upstream routing, and
  production update/reboot default-off behavior.
- Use synthetic browser fixtures and retained data with ingestion off. Inspect
  both themes, desktop/mobile, ranges, corridor focus, history, incidents/maps,
  failures and unchanged visual quality.
- Open the explicitly scoped PR to main with real validation results and source
  provenance. Wait for all required/applicable checks on the actual head.
- Reassess source changes, capacity or failed gates; fix causes without weakening
  checks. Do not claim deployed behavior from fixture tests.

## Stage 6 — controlled cutover after review

1. Recheck live/main revisions, clean checkouts, active timers and image IDs.
2. Preserve rollback images and Caddy/private configuration. Take a fresh database
   dump and verify its checksum with the existing backup workflow.
3. Coordinate the production updater so it cannot race merge/cutover. Record and
   restore its prior timer state; keep the server checkout on main.
4. Build the exact reviewed primary image before replacement. Change only the
   primary API and proxy where possible; leave ingestion/routes/database running.
5. Verify readiness, public HTML/assets/snapshot and graph rendering, fresh I25
   and I70 samples, CDOT metadata, per-account quota state, archive continuity and
   required timers. Check source identity rather than container Up alone.
6. Stop the existing experimental sidecar only after primary verification, after
   preserving its image/configuration. Verify both optional paths return 404.
7. Start each optional reader briefly, verify isolation and freshness/history,
   then stop it. Ensure no optional boot/update activation is installed.
8. Restore the updater state and record final main/image/proxy/timer identities.

## Rollback and abort conditions

Any unexpected schema/ingestion/provider/configuration scope, unavailable backup,
missing source/image, insufficient headroom, failed gate or freshness regression
halts the dependent stage. Continue unaffected preparation and record the cause.

Before cutover, rollback is simply abandoning the topic: production is unchanged.
During cutover, restore the preserved primary image and original Caddy file;
restore the experimental image/service state if it was changed. Do not reverse
or delete database contents. Verify health and observation progress after rollback,
then restore the updater to its recorded prior state. A main revert must be a
reviewed follow-up when needed; do not leave production on a feature branch.

## Progress

Tracking issue: #211. Source checkpoints and application scope are recorded in
`docs/dashboard-promotion-state.json`. Focused API verification passed on Java 21
(207 API tests, one opt-in retained-database test skipped); all 330 frontend tests
passed. Both preserved sidecar images built locally. Lifecycle, legacy adaptation,
real Caddy routing and resilience checks passed during preparation. Full
`./mvnw clean verify` passed on Java 21; synthetic desktop/mobile/theme/history
and partial-failure browser checks passed. Container packaging and PR review
remain pending. No production services/configuration have changed.

- [x] Read working agreements and inspect local/GitHub/VPS state.
- [x] Create isolated topic from current main.
- [x] Preserve remote source checkpoints and inventory exact application scope.
- [x] Implement primary behavior and focused checks.
- [x] Implement independent default-off sidecars and proxy checks.
- [ ] Complete repository gates, browser verification and PR checks.
- [ ] Obtain any remaining concrete merge/cutover approval.
- [ ] Perform and verify authorized cutover, or report the ready candidate.
