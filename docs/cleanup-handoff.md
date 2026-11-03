# Experimental cleanup handoff

The bounded cleanup ends with the closure review that follows `07f607a`.
Integration remains `experiment/dashboard-reconstruction`; production promotion
requires a separate decision. This document replaces the seventeen temporary
cleanup notes. Their original contents remain in Git history at `07f607a`.

The [recovery ledger](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267)
is the source of current PR heads, accepted merges, checks and serving revisions.
Read it and inspect actual Git/runtime state before continuing. A source checkpoint
or historical green run does not establish the current serving revision.
The closure checkpoint is
`checkpoint/experimental-cleanup-closure-2026-11-02`, created only after acceptance
and merged verification. Until that record exists, the prior accepted checkpoint
is `checkpoint/experimental-frontend-maintainability-2026-10-30` at `07f607a`.

## Accepted work and accounting

| Stage | Accepted experimental revision | Scope |
| --- | --- | --- |
| Segments 1–15 | `9227ea8` | Shared calculations/catalogs, obsolete helpers/styles, controller responsibilities and repeated SQL. |
| Segments 16–30 | `8d52338` | Obsolete CSS, query/mapping reuse and shared geometry calculations. |
| Segments 31–45 | `0679cde` | Retry/range policies, SQL/DTO/style reuse, snapshot and request ownership. Segment 44 was assessment only. |
| Prioritized reassessment | `a1ac4c5` | Three implemented topics: chart segmentation and equivalent information/dashboard CSS. Other candidates were rejected or deferred. |
| Frontend maintainability | `07f607a` | Eight segments: feature test suites, calculation/presentation owners, map data/style, and validation walkthroughs. |
| Closure | See ledger and checkpoint above | Explicit-input incident-table view, residue review, reconciled handoff and final verification. |

Code movement is not deletion. The eight-segment frontend batch added 109 runtime
and 219 test lines net, excluding documentation. Its smaller coordinator and map
files reflect responsibility separation. The closure table extraction is also
primarily movement; report its runtime/test totals separately. Removing these
historical notes must not inflate code-cleanup totals. No closure topic removes a
service, endpoint, provider guarantee, dependency, stored dataset or feature.

## Responsibilities and contracts to preserve

The [frontend ownership guide](frontend-maintainability.md) identifies browser
owners and provides account rollover, archived-read and behavior-change walkthroughs.
The screen coordinator retains controls, refresh, view state and component wiring.
The incident-table view receives explicit availability/focus/expansion inputs;
map lifecycle and popups remain separate. Script dependency order and fresh asset
cache keys are part of the serving contract.

Earlier cleanup established these boundaries:

- `CorridorSpeedZones` owns the shared posted-speed catalog. Directional variable
  signs retain their exceptions. Map responses keep their established fields.
- `DashboardRanges` owns the five range definitions. Callers retain different
  unsupported-range policies and existing refresh intervals.
- `LatestTrafficSamples` owns usable-first selection and raw fallback. Missing
  samples remain unavailable; raw-only requests do not query usable rows.
- `MapIncidentGeometry` and `MapIncidentPresentation` separate geometry and labels
  from HTTP orchestration. Preserve source precedence, marker rules and accuracy.
- `TrafficStagnation` owns assessment policy. Repeated speeds alone do not prove
  staleness; preserve successful-observation freshness and concrete recovery advice.
- Shared SQL expressions retain query signatures, parameters, ordering, identity
  keys and archive-inclusive sources. Similar projections with different weighting
  or endpoint normalization remain distinct.
- Road-sign authoring SVGs live under `docs/artwork/road-signs`; runtime PNGs and
  required vendor, preview and dynamic-class assets remain supported.

## Deferred work and when to reopen it

| Area | Decision / trigger for a separate task |
| --- | --- |
| Painter shared state and wide interface | Retain for closure. Revisit when a chart feature requires coordinated live/history changes; define explicit frame semantics first. Do not hide dependencies in an opaque context object. |
| History/continuous navigation | Retain cancellation, cache and deadline behavior. A reproducible navigation defect or measured bottleneck justifies a targeted state change. |
| Demo data | Retain the small local builder. Browser comparison found a pre-existing “undefined details” source label in demo incidents at `07f607a` and in closure; fix sample metadata in a separate small polish task. Extraction needs reuse or testing benefit. |
| Map popups versus incident table | Keep distinct time, lifecycle, GeoJSON and source-detail contracts. Share only behavior proven identical by representative cases. |
| Information/dashboard CSS | A future visual-change task can map cascade ownership and unused selectors across responsive layouts, themes and interactive states before removal. File size alone is insufficient. |
| `TileTrafficPoller` and provider orchestration | Separate backend task with captured payloads, failure/partial-batch characterization, quota invariants and historical continuity tests before refactoring. |
| Frontend test CI classification | New feature-suite paths conservatively trigger full mutation testing. Any optimization needs its own scope-classifier tests; closure does not weaken gates. |
| Service consolidation or framework migration | Require a measured maintenance/operational problem and migration/rollback case. No speculative conversion. |
| Production promotion | Separate review of the complete main-to-experimental diff, configuration and data compatibility, visual/performance acceptance and rollout/rollback. Cleanup completion is not promotion approval. |

## Verification and recovery

For a source change, establish behavior first and run focused tests, then the full
frontend command `node --test scripts/tests/dashboard.test.cjs`. The runner retains
all feature suites. Java/API changes require `./mvnw clean verify`; operational
changes require resilience and the focused shell tests. Keep applicable CI gates.
A test count alone does not demonstrate every feature or performance characteristic.

Review the combined diff and actual PR base/head before integration. Verify the
accepted merged revision, packaged assets, load order and relevant browser scenes.
For runtime verification use disposable synthetic live/archive data, providers and
ingestion schedules disabled, and a read-only API role. Preserve the prior image
before an authorized experimental release; verify readiness, both fresh corridors,
CDOT metadata, quota availability, history continuity and unchanged production.
Follow the [experimental delivery workflow](experimental-delivery-workflow.md).

Recovery evidence must survive temporary checkout removal: retain the checkpoint,
source bundle, accepted patch/PR provenance, validation results and rollback image
identity in the ledger's durable evidence location. Further work should accompany
specific defects or features rather than restart an unbounded cleanup sweep.
