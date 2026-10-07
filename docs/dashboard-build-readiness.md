# Dashboard reconstruction readiness

This integration is not release-ready yet. Read
[experiment status](dashboard-experiment-status.md),
[the recovery ledger](dashboard-recovery.md), and `AGENTS.md` first.

## Current verification

Topic22 restores selected-range incident reads, short-view ongoing tables and
long-view five-band hotspots. Local validation passed: 70 frontend tests,
Java21 full verification (36.264s), 33 tooling tests, actionlint and diff checks.
Native rendering passed on both mounts/corridors with light/dark and 1093px:
actual hotspot popups, short-table expansion and no style errors or document
overflow. Original zoom-expression correction `ee4addc` is recovered with its
hotspot dependency, and singular popup copy is corrected. Known overlapping
popup behavior stays assigned to the separate lifecycle topic24 before release.
Accepted slowdown-history #138 passed CI, full mutation checks and CodeQL.

Topic21 restores the bounded frequency endpoint and matching seven/thirty-day
map presentation after accepted current-flow #137. Validation on this topic:
7 focused controller tests (7.211s), 66 frontend tests, full Java21 verification
(35.365s), 33 tooling tests, actionlint and diff checks passed. Native browser
checks passed on both mounts and corridors, light/dark and 390px: frequency
coloring, truthful sampled-hour coverage, no document overflow and active-only
legend. A scoped hidden-legend CSS fix from the later original source was moved
forward because the new legend otherwise displayed both modes. CI acceptance
and the remaining map/UI recovery still precede any release; production and the
running sidecar remain unchanged.

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
Geometry proxy #134 passed all GitHub gates and merged at `253e113`.
The pinned renderer assets and public-path security regression are next;
all remaining map/UI topics and final release verification are still required.

Renderer #135 passed all gates and merged at `4d7140a`. The neutral focused map
now passes 58 frontend tests and Java21 full verification34.717s. Provider-free
native browser checks cover both mounts/corridors/themes, 1408/1093/390 widths,
worker loading, attribution, no-WebGL and missing geometry. A failed-raster
fixture keeps the route visible but exposed a startup failure-message race;
renderer lifecycle topic24 must correct it before release. No partial deployment.

Neutral map #136 passed all gates and merged at `400e57f`. Current combined-flow
recovery passes63 frontend tests and Java21 full verification41.196s. Existing
sidecar DTO/catalog reads confirmed actual flow/anchor/posted-speed contracts
without provider requests. Native fixture maps cover current and hourly labels,
both mounts/corridors/themes and narrow legend wrapping. This topic deliberately
retains combined one-mile display intervals and retires the sparse directional
loader; it adds no Java, ingestion, schema or data change. Further topics and
the known startup-message correction remain required before any release.

## Release gates

Incident panels #143 passed and merged at `3f096e7`. Current metrics now pass
92frontend tests and Java21 full verification43.233s. Provider-free native checks
cover mixed directional/current snapshots, historical hourly reads, stopped cells,
both mounts and narrow dark layout. Separate period-summary and daily-range work
remains pending. No intermediate candidate is released.

Estimated travel time sums complete contiguous combined half-mile intervals,
falling back to distance divided by corridor average when coverage is incomplete.
It is not a measured or direction-specific journey. A zero-speed interval cannot
yield a finite travel estimate. Worst segment uses the slowest current combined
interval, with the latest observed zone bucket only as a fallback.

Current metrics #144 passed all gates and merged at `5deb08a`. Daily-range local
verification now passes95frontend/33tooling tests and full Java21 cleanverify
42.389s. Native current/retained layouts cover both mounts,1093/390 widths and
dark/light themes without overflow. Daily ranges reset at Denver midnight and
use complete contiguous15-minute speed-zone coverage, plus the current estimate;
gapped, incomplete or stopped buckets cannot provide a finite range estimate.
GitHub acceptance and all later topics remain required before release.

Daily ranges #145 subsequently passed all gates and merged at `132ab73`. Period
summaries pass99frontend/33tooling tests and Java21 fullverify35.497s. Native
seven/thirty-day and return-to-current checks cover both mounts and390/1093 widths
in both themes. Complete zone buckets are one hour in7D and three hours in30D;
labels describe those real resolutions. No partial reconstruction is deployed.

Period summaries #146 passed and merged at `8372137`. Posted guides now pass
103frontend/33tooling tests and full Java21 verify36.872s. Native desktop-dark
and narrow retained-light charts show posted55/65/75 context, guide lines and
readable descriptors with no horizontal overflow. Synthetic edge continuation
never creates an observed point marker. Separate callout/layout/coverage work
and fresh GitHub acceptance remain required before release.

Default replay #149 passed all gates and merged at `03ff85b`. Preloading restores
the synchronized2/6/24/168/720-hour snapshot set, deduplicated shared reads and
last-good failed slices. Controls render locally; busy automatic syncs do not
queue, manual sync has a15-second cooldown, and local replay advances every15s.
The reviewed module-only warm-up avoids hidden WebGL/maps/configuration reads.
Native fixture checks confirmed39 combined-view reads and zero map canvases,
unchanged reads after range/theme/reference controls, then one map/config read
only after focus. Cold offline failure offers a retry without claiming retained
data exists. This remains a partial reconstruction, not a release candidate.

Preloading #150 passed all gates and merged at `e2c0a6b`. Wide-layout recovery
passes122frontend/33tooling tests and full Java21 verify36.111s. Native320/390px
metrics and navigation fit without text escaping cards;1093px desktop remains
readable. The2560x1440 shell uses its full width with352px combined and512px
focused chart content, preserving canvas resolution. Information pages and
complete source/performance assessment remain required before release.

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
