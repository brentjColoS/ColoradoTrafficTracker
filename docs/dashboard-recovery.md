# Dashboard recovery ledger

Tracking issue: [#118](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/118).
The [machine-readable ledger](dashboard-recovery-ledger.json) is the durable
source inventory and topic record. Read it with `AGENTS.md` before resuming work.

## Authority and state

The user authorized validation, focused merges, and the completed experimental
sidecar release without requiring personal inspection. This does not authorize
experimental dashboard promotion to main. Necessary shared prerequisites remain
separate, narrowly scoped main PRs. Production data and private configuration
must remain intact.

| State | Revision/evidence |
| --- | --- |
| Post-revert main baseline | `dcbdeee`, same tree as pre-#114 `c3e80d7` |
| CI prerequisite | #119, merge `31bd44b`, all applicable CI and CodeQL passed |
| Working agreement | #120, merge `bcb7065`, all applicable CI and CodeQL passed |
| Public dependency resolution | #126, merge `b9cbf9d`, all applicable CI and CodeQL passed; separately import the focused fix into experimental integration |
| Frontend mutation scope | #130, merge `8e48acc`, all applicable CI and CodeQL passed; import only its focused policy while preserving the mandatory experimental frontend gate |
| New experimental integration start | `bcb7065` |
| Restored visual reference | `1d963b6` |
| Public sidecar before recovery | `91ba877`, unchanged until final release |
| Separate scrolling source | `26872fc`, draft #116 remains unmerged |

Preserved tags are `checkpoint/dashboard-restored-motion-2026-10-07`,
`checkpoint/sidecar-before-reconstruction-2026-10-07`, and
`checkpoint/dashboard-scroll-source-2026-10-07`. Original source history remains
preserved. A same-named time-ruler remote branch advanced during recovery; its
original tip is separately preserved at
`checkpoint/time-ruler-source-before-recovery-2026-10-07`. Subsequent topic names
are checked locally and remotely before creation. The stripped `32e3689`
performance checkpoint is comparison evidence,
not the accepted visual target.

## Ordered topics

Every row is a separate topic branch and PR to `experiment/dashboard-reconstruction`.
IDs are stable ledger identifiers, not promises that unrelated features share a
branch. The source inventory assigns possible file owners; shared-file hunks must
be classified and recorded as the corresponding topic is recovered.

| ID | Topic branch |
| --- | --- |
| 1 | `docs/dashboard-recovery-boundaries` |
| 2 | `ops/read-only-dashboard-sidecar` |
| 3 | `feature/dashboard-recent-incidents` |
| 4 | `feature/dual-corridor-dashboard` |
| 5 | `feature/dashboard-retained-replay` |
| 6 | `feature/dashboard-chart-exploration` |
| 7 | `feature/weekly-traffic-baselines` |
| 8 | `feature/dashboard-time-ruler` |
| 9 | `feature/speed-zone-history-charts` |
| 17 | `feature/dashboard-geometry-proxy` |
| 18 | `feature/dashboard-map-renderer` |
| 19 | `feature/focused-corridor-map` |
| 20 | `feature/corridor-map-current-flow` |
| 21 | `feature/corridor-map-slowdown-history` |
| 22 | `feature/corridor-map-incident-timeline` |
| 23 | `feature/corridor-map-context` |
| 24 | `fix/corridor-map-renderer-lifecycle` |
| 10 | `feature/dashboard-incident-details` |
| 11 | `fix/dashboard-incident-table-scroll` |
| 12 | `fix/dashboard-current-flow-metrics` |
| 13 | `feature/dashboard-daily-travel-range` |
| 39 | `feature/dashboard-period-summaries` |
| 14 | `feature/dashboard-posted-limit-guides` |
| 41 | `fix/dashboard-chart-incident-labels` |
| 40 | `fix/dashboard-replay-default-window` |
| 15 | `feature/dashboard-view-preloading` |
| 16 | `feature/dashboard-wide-layout` |
| 25 | `feature/dashboard-information-shell` |
| 26 | `feature/system-architecture-story` |
| 27 | `feature/system-section-navigation` |
| 28 | `feature/system-live-health-panel` |
| 29 | `feature/data-evidence-page` |
| 30 | `feature/api-explorer-page` |
| 31 | `fix/information-hero-consistency` |
| 32 | `feature/data-corridor-hero-map` |
| 33 | `fix/dashboard-i70-coverage-alignment` |
| 34 | `fix/information-panel-border-motion` |
| 35 | `fix/information-grid-wave-motion` |
| 36 | `fix/system-architecture-motion` |
| 37 | `fix/road-sign-pointer-scope` |
| 38 | `feature/data-map-travel-pulses` |

Map-dependent incident presentation, current-cell metric plumbing, and renderer
warming require the map foundations first. This is the reason IDs 17–24 precede
10–16 in execution. It avoids changing topic scope merely to satisfy an earlier
proposed order. Historical coverage and scrolling are separate topics after the
reconstructed baseline has passed assessment.

## Accounting and validation

The experimental integration is protected by ruleset `24632736`: only up-to-date
topic PRs can merge, with `ci-complete` and the four verified CodeQL Analyze checks
required. There are no bypass actors; deletion and force pushes are blocked.
Merge commits preserve individual topic boundaries. Main has its separate ruleset
`24631611`. GitHub's managed CodeQL setup did not schedule scans when this
integration was protected only by a ruleset. Matching classic branch protection
is therefore also enabled, including administrator enforcement and the same five
required checks. Neither layer permits deletion or force pushes. Actual scans,
not merely configured settings, must pass before accepting a topic. Settings are
not deployment triggers.

The original net change is 91 files, 168 non-merge source commits, and 56 merge
checkpoints. Merge checkpoints are evidence, not commits to replay. Production
common/ingest/routes foundations and migrations have no net change to recover.
Temporary handoffs and superseded implementations do not need resurrection.

For each accepted topic, record source commits and actual retained hunks, its PR,
exact checked head, accepted merge SHA, commands/outcomes, and justified deviations.
Pending entries are not evidence of completed validation. Never use an old test
result as proof of a new reconstructed tree.

CI and corrected governance intentionally differ from the old source. Other
runtime/assets must match the intended reference or have a reviewed exception.
Full source accounting, applicable gates, local browser review, and bounded
performance assessment precede the exact-SHA sidecar-only release. Preserve the
old image and private configuration for rollback. No partial wave is deployed.

Replay PR #125 initially failed API container dependency resolution. The shared
resolver fix passed as main prerequisite #126 and experimental import #127.
Replay incorporated that accepted experimental base, passed fresh CI and CodeQL
runs, and merged at `379cf8f`. The failed packaging gate was neither bypassed nor
blindly rerun. Chart exploration #128 and weekly baselines #129 subsequently
passed and merged as separate topics.

The JavaScript test and fixture paths previously made frontend-only topics
mutation-required despite unchanged JVM behavior. Shared prerequisite #130 now
recognizes only those two exact paths; Java, build, workflow and unknown changes
remain mutation-required. Main/manual runs still use full PIT, and all other
gates remain required. Its focused experimental import retains unconditional
frontend tests. Validate that actual job behavior on the next frontend-only
topic before claiming a delivery-time improvement.

The focused experimental CI import #131 passed every gate and merged at
`c7faf43`, retaining the unconditional frontend suite. Time-ruler reconstruction
uses only source `68a32ce`: adaptive ticks, shared chart guides and Denver day
boundaries. Earlier ledger references to synchronized hover were inaccurate;
neither that source nor the restored visual target implements it.

Time rulers #132 passed and merged at `866c4a3`. CI logs confirmed the focused
frontend scope decision without removing other gates. Zone reconstruction
recovers only sources `2bb9d26` and `2a46927`: bounded bucketed history, per-zone
weekly baselines and chart context. The daily-range merge checkpoint `7955aab`
is not replayed; its compatibility work belongs to the later daily-range topic.
No durable data, migrations, or ingestion are changed. Updated source labels
and complete eight-zone I-70 demo coverage remain required before deployment.

Zone history #133 passed all gates and merged at `a32006e`. The geometry proxy
recovers only sources `c7f61c4` and `899a9fd`: successful GeoJSON reads are cached,
tracked corridor names are normalized, and unavailable internal route geometry
returns 503 after bounded timeouts. Existing experimental Compose already points
at the production route service. Renderer assets and map UI remain separate.

Geometry proxy #134 passed all gates and merged at `253e113`. Renderer recovery
pins the original MapLibre 6.10.0 assets with matching hashes and complete license,
using the existing public dashboard path. This asset-only topic does not yet add
the focused map UI, native rendering or worker/fallback assessment.

Renderer #135 passed and merged at `4d7140a`. The following neutral map topic
recovers the focused slot, corridor-filtered reports and relative renderer
import without traffic coloring. Its current map contract replaces old branch
destinations and historical readiness claims; dated imagery evidence stays
preserved. A native failed-raster check exposed a startup message race, tracked
for the separate lifecycle topic24 and required before the final release.

Neutral map #136 passed and merged at `400e57f`. Current-flow recovery uses only
its original focused sources and the coherent combined renderer checkpoint
`b36f852`. The intermediate sparse directional UI and loader are superseded,
not restored; existing geometry API remains available. Optional map failures
preserve charts and incident data, and current/hourly reads retain the correct
mount and time anchor. Production collection and retained data are unchanged.

Current-flow #137 passed all gates and merged at `01b7193`. Slowdown-history
recovery restores only its bounded combined-cell frequency API, safe map
presentation and distinct legend. The original near-stop threshold is preserved;
current/hourly views retain the reviewed actual-observation timestamp. Native
testing exposed flex overriding hidden legend items, so the exact four-line
source fix is recovered now rather than accepting a visibly broken intermediate
topic. Remaining incident-row layout stays isolated in lifecycle topic24.

Slowdown-history #138 passed all gates and merged at `40f74d7`. Incident timelines
recover selected-window reads, ongoing short tables and five distinct-event
hotspots. The original `ee4addc` zoom-expression correction belongs with that
feature so a renderer-invalid intermediate is not accepted. No backend,
collection or retained data changes are needed. Original popup prioritization
and cleanup still require their separate lifecycle topic before release.

Map context #140 passed and merged at `19f2d86`; bounded configuration fallback,
mile markers and posted-limit boundaries remain separate from the hero map.
Lifecycle #141 passed all applicable gates and merged at `c175671`. Native checks
found cached failed module imports, stale cross-corridor popups, first-click
attribution and failed-raster message races; bounded fixes and regressions are
included. Successful rendering is reused without a mutation observer.

Incident detail recovery now exposes retained CDOT descriptions and useful
impact notes, with explicit planned and cleared states. Reported durations use
complete provider intervals; observation durations use complete retained
observation intervals. Mixing those clocks would overstate what was measured.
This does not modify incident collection, source reports or historical rows.

Incident details #142 passed all gates, including full mutation and container
checks, and merged at `9434133`. Incident-table scrolling recovers bounded panels,
compact combined previews and complete focused lists. Unused wheel distance
passes to the page at either edge, with page updates coalesced per frame. The
temporary always-expanded combined list and overscroll containment are retired.
Mixed source `7e9ad34` contributes only its containment removal here; replay,
refresh, period-summary and chart changes remain separate topic work.

Incident panels #143 passed all gates and merged at `3f096e7`. Reviewing mixed
source `7e9ad34` identified three additional coherent topics rather than a safe
single-branch replay: period summaries after daily travel ranges, chart callout
placement after zone guides, and a shared default replay window before preloads.
Their IDs39–41 and exact hunk routing are recorded separately in the ledger.

Current-flow metrics restore travel time and the worst half-mile interval without
changing card styling. The shared estimator is recovered here before hero pulses:
mixed directional counts cannot establish combined coverage, and hourly snapshots
use their actual cell observation timestamps and average-speed field. A stopped
interval produces unavailable travel time, not a fictitious finite estimate.

Current metrics #144 passed and merged at `5deb08a`. The initial API container
build encountered a Maven Central HTTP502; one diagnosed failed-job retry passed
the unchanged head. No gate or dependency was weakened. Daily-range recovery
uses complete contiguous speed-zone estimates since Denver midnight, includes
the current estimate and excludes incomplete, gapped or stopped buckets. The
selected24h zone request is reused rather than duplicated. Information-page
explanation stays with topic29, and period summaries stay with topic39.

Daily ranges #145 passed all gates and merged at `132ab73`. The separate period
summary topic recovers only the corresponding `7e9ad34` hunks: weighted selected
period averages, complete zone-bucket travel estimates and observed-event counts.
Short views restore current metrics. The actual thirty-day API uses180-minute
buckets, so its range labels say three-hour rather than the old inaccurate hourly
wording. Refresh, replay, chart-label and layout work remain separately scoped.

Period summaries #146 passed all gates and merged at `8372137`. Posted-limit
recovery adds sign/guide/domain context and clearer range, observed and expected
speed descriptors. Retained and long-range speeds are not labeled live. Bounded
edge continuation is marked as synthetic boundary context rather than a new
observation. Only those `fa3bef0`/`7e9ad34` hunks belong here; callout placement
remains topic41. A new branch name preserves the original guide-source branch.

Posted guides #147 passed all gates and merged at `5c56ceb`. Incident-callout
recovery selects the five busiest Denver days and keeps speed-zone labels inside
the plot, away from nearby lines. A narrow-plot regression showed the source
clamped only the background, not the actual text; bounded fitting and text anchors
correct that without changing canvas resolution. Existing 320px summary-card
clipping remains assigned to the separate wide-layout topic16 before release.
