# Dashboard experiment status

Read `AGENTS.md` and [the experimental delivery workflow](experimental-delivery-workflow.md)
before changing this experiment. The accepted integration destination is
`experiment/dashboard-reconstruction`, not `main`.

## Current state

The dashboard promotion in PR #114 was reverted through #117. The new integration
starts from reviewed main after the narrow CI and working-agreement prerequisites
#119 and #120. The complete baseline, source audit and bounded motion assessment
passed their checks. The experimental sidecar was released once at
`654fb1b41552070b1ed5474770fcd2d0121985ce` on October 7, 2026.
Its 22 public assets match that accepted revision; readiness, fresh corridor/CDOT
observations and retained history were verified. Production containers,
configuration and routing were unchanged. The previous `91ba877` image remains
available for rollback. See [the release record](dashboard-recovery-release.json).
No partial waves or experimental UI promotion to main occurred.

[Recovery status](dashboard-recovery.md) and the
[machine-readable ledger](dashboard-recovery-ledger.json) account for sources,
topic ownership, accepted PRs, validation, and remaining work. Original branches
and tagged checkpoints remain preserved. Do not re-merge their reverted ancestry.

## Product constraints

- Keep I-25 and I-70 side by side, with corridor summaries, speed charts, incident
  tables, health, and focused maps. Do not make the dashboard map-first.
- Preserve the Black Forest, Goldenrod, Burnt Rose, Ivory, and Almond Silk palette,
  readable light/dark themes, high-resolution charts, and accepted visual motion.
- Keep incident first/last-seen, active state, source, corridor, and mile-marker
  semantics truthful. Missing coverage and old observations are not live data.
- Estimate freshness from successful observations, not whether speeds changed.
  Every degraded state needs a concrete reason and useful next action.
- Preserve provider-free local demo/retained/replay review modes as they are
  reconstructed. Do not add provider requests for dashboard validation.
- Keep production storage, ingestion, geometry, and quota foundations intact.
  They are not automatically topics to replay simply because old experimental
  history contains an earlier version.

## Parked work

The old speed-limit context, I-70 validation, I-25 tile-projection, and semantic
zone experiments are not implied dependencies. They may affect ingestion, schema,
or budgets and remain parked. Safety/reversion branches are checkpoints, not
active product changes.

Historical scrolling remains a separate experiment after the accepted baseline.
Draft #116 must not be merged as a shortcut. Its bounded coverage and
disabled-by-default graph interaction require their own focused branch, tests,
failure/lifecycle assessment and local preview. The released baseline does not
contain scrolling.
