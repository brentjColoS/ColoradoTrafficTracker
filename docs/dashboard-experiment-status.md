# Dashboard experiment status

This document is the durable entry point for the dual-corridor dashboard
experiment. Read the repository-level `AGENTS.md` first, then use this document
with `docs/dashboard-build-readiness.md` before changing the experimental UI or
its supporting APIs.

Production `main` remains the stable application line. Dashboard experiments
are integrated into `experiment/dashboard-development`; new dashboard topics
branch from that line and return to it through focused pull requests. Promotion
from the experiment to production is a separate decision and requires explicit
approval.

## Completed topic groups

The initial experiment was developed as a continuous branch. Its commits still
form four useful review boundaries:

1. `9932fb1` through `4e2c8f9`: dual-corridor layout, live API integration,
   provider-free historical mode, icon system, corridor summaries, and chart
   controls.
2. `f582e38` through `e26c57c`: bounded historical replay, complete seven-day
   windows, durable CDOT incident lifecycle replay, and scheduled incident end
   handling.
3. `0ea665c` through `a0956b7`: chart readability, complete 24-hour coverage,
   robust local trend fitting, sample-state guidance, and an adjustable
   historical reference band.
4. `230c56f` and `979a4cb`: weekly recency-weighted traffic baselines backed by
   the preceding three months of retained observations.

These groups are intentionally kept together in the first experimental
integration because they share the same dashboard state and rendering pipeline.
Future changes should not add another unrelated topic to that baseline.

## Product constraints

- Keep the primary page as a desktop-focused, side-by-side view of I-25 and
  I-70. Do not turn it into a map-first or direction-specific dashboard.
- Preserve the Black Forest, Goldenrod, Burnt Rose, Ivory, and Almond Silk
  palette, including usable light and dark themes.
- Retain average speed, estimated delay, active incidents, worst segment,
  current-versus-baseline charts, route-specific incident activity, operational
  status, and the architecture summary.
- Incident rows retain original first-seen, last-seen, active, source, corridor,
  and tracked mile-marker semantics. UI wording must not overstate location or
  freshness accuracy.
- Repeated speed values are not automatically failures. Operational status must
  use successful observation freshness and provide a concrete reason when it is
  degraded.
- Keep the main dashboard concise. Avoid reintroducing confidence, latency, or
  data-quality hero cards, a prose-heavy briefing, or a large decorative road
  sign.

## Safe review modes

- `?demo=1` uses labeled synthetic data and requires no backend.
- `?historical=1` anchors the dashboard to retained data, disables timed
  refresh, and does not start ingestion.
- `?replay=1` advances a bounded virtual clock through retained traffic and
  incident history. `replayStart`, `replayEnd`, and `replayRate` provide bounded
  overrides.

Historical and replay modes are read-only. They must not contact TomTom or CDOT,
rewrite timestamps, or imply that retained observations are live.

Use these focused checks while iterating:

```bash
./mvnw -q -pl api-service -am verify
node --test scripts/tests/dashboard.test.cjs
docker compose config --quiet
```

Use the full repository gates before merging a topic into the experimental
development branch. Provider-backed checks require a separate, deliberate
decision.

## Parked alternatives

The speed-limit context, I-70 validation, I-25 tile projection, and semantic
zone branches are separate experiments. They change ingestion, schema, provider
budgeting, and older dashboard concepts; they are not implied dependencies of
the dual-corridor dashboard. Reassess their data model and quota effects before
moving any part of them into active development.

The dashboard-reversion branches are safety snapshots, not the active product
direction. Preserve them until the experimental baseline is accepted, but do
not merge them into the development line.

## Continuing the experiment

1. Start from the latest `experiment/dashboard-development`.
2. Use one branch for one visible behavior, API contract, or operational need.
3. Confirm the real payload and retained-data behavior before changing the UI.
4. Run focused tests, then the full applicable gates.
5. Open a pull request back to `experiment/dashboard-development` with the
   problem, scope, evidence, and known limitations.
6. Keep production deployment and promotion to `main` out of the topic unless
   explicitly authorized.

`docs/dashboard-build-readiness.md` contains the detailed data contracts,
failure handling, accessibility decisions, verification history, and local
review commands.
