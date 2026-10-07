# Dashboard reconstruction readiness

This integration is not release-ready yet. Read
[experiment status](dashboard-experiment-status.md),
[the recovery ledger](dashboard-recovery.md), and `AGENTS.md` first.

## Current verification

The shared main prerequisites #119 and #120 passed their applicable checks.
The recovery marker and source inventory are the first experimental topic; they
do not restore the dashboard features or prove their visual behavior.
Historical source validation remains attached to the preserved source revisions.
It must not be reported as validation of a new reconstructed revision.

As topics land, record the actual tested behavior, commands, outcomes, PR head,
and accepted merge in `dashboard-recovery-ledger.json`. Keep pending work pending.

## Release gates

- Complete source accounting: 91 original net-changed files, 168 non-merge source
  commits, and 56 integration checkpoints; record excluded/superseded changes.
- Every reconstructed topic has focused tests, broader applicable gates, and a
  reviewable PR targeting the experimental integration.
- Runtime code/assets match `1d963b6` or have an explicit reviewed difference.
  Corrected governance and actual new validation replace inaccurate promotion
  claims and stale readiness assertions.
- Check current/retained/empty/failed data, both themes, responsive layouts,
  reduced motion, map lifecycle, and graph presentation in local browser review.
- Preserve efficient border traces, left-to-right grid glow, coordinated diagram
  motion, and travel-paced geometry pulses with a readable non-overlapping legend.
- Use bounded eight-second performance scenes. Measure frame cadence, long tasks,
  repeated layout reads, and bounded resource usage; do not infer total GPU load
  from smooth frames alone or launch an open-ended benchmark.
- Build a clean exact-SHA release and preserve the previous sidecar image/config.
  Verify the read-only role, disabled Flyway, live I-25/I-70/CDOT observations,
  public assets, and unchanged production after sidecar-only deployment.

Do not start ingestion or alter historical samples for local UI review. Do not
deploy a partial reconstruction to either public surface.
