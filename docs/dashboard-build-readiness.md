# Dashboard reconstruction readiness

This integration is not release-ready yet. Read
[experiment status](dashboard-experiment-status.md),
[the recovery ledger](dashboard-recovery.md), and `AGENTS.md` first.

## Current verification

The shared main prerequisites #119, #120 and #126 passed their applicable checks.
The focused experimental resolver import #127 also passed. Accepted topics now
include the read-only release tools, recent-incident API, dual-corridor foundation,
retained replay and chart exploration. Each has its own PR and checked revision;
these accepted topics are not a completed release.
Historical source validation remains attached to the preserved source revisions.
It must not be reported as validation of a new reconstructed revision.

As topics land, record the actual tested behavior, commands, outcomes, PR head,
and accepted merge in `dashboard-recovery-ledger.json`. Keep pending work pending.

The weekly-baseline topic reads the preceding 13 weeks of archive-inclusive
hourly observations, matched to Denver weekday and hour, with an eight-week
recency half-life and reduced outlier influence. Profiles refresh weekly and
populate the existing reference band; missing profiles retain the explicitly
theoretical fallback. Local Java/frontend and responsive browser checks passed.
Its exact-head GitHub gates passed in #129, accepted at `75adef7`. This is still
a partial reconstruction, not a sidecar release candidate.

CI scope prerequisite #130 and its focused experimental import #131 passed.
Time rulers #132 passed all gates and merged at `866c4a3`; actual CI retained
frontend/build/container/security checks while omitting PIT for unchanged Java.
The next topic restores bounded zone trends and per-zone weekly baselines over
the existing durable speed-zone table. Its Java21 full verification passed in
35.297 seconds; GitHub acceptance remains pending. Map/current-metric plumbing
and final I-70 demo alignment remain separate topics before any release.

Zone history #133 subsequently passed full CI/PIT/CodeQL and merged at `a32006e`.
The geometry proxy topic passed focused tests, Java21 full verification36.788s,
resilience checks and quiet placeholder Compose validation. Its source geometry
contract was verified against the existing sidecar without contacting providers.
GitHub acceptance and all remaining map/UI topics are still required.

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
