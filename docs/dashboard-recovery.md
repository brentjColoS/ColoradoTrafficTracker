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
| 42 | `feature/system-headline-presentation` |
| 45 | `feature/system-decision-cards` |
| 46 | `feature/system-provider-identities` |
| 43 | `feature/system-runtime-diagrams` |
| 44 | `fix/system-copy-consistency` |
| 29 | `feature/data-evidence-page` |
| 30 | `feature/api-explorer-page` |
| 31 | `fix/information-hero-consistency` |
| 32 | `feature/data-corridor-hero-map` |
| 33 | `fix/dashboard-i70-coverage-alignment` |
| 34 | `fix/information-panel-border-motion` |
| 35 | `fix/information-grid-wave-motion` |
| 36 | `fix/information-diagram-motion` |
| 37 | `fix/road-sign-pointer-scope` |
| 38 | `feature/data-map-travel-pulses` |
| 47 | `fix/information-page-parity` |
| 48 | `fix/dashboard-short-range-control` |
| 49 | `test/dashboard-bounded-motion-comparison` |
| 50 | `fix/dashboard-release-cache-keys` |
| 51 | `docs/dashboard-recovery-assessment` |

Map-dependent incident presentation, current-cell metric plumbing, and renderer
warming require the map foundations first. This is the reason IDs 17–24 precede
10–16 in execution. It avoids changing topic scope merely to satisfy an earlier
proposed order. Historical coverage and scrolling are separate topics after the
reconstructed baseline has passed assessment.

The mixed System story sources are also split by behavior: live-health28,
headline presentation42, decision-card presentation45, static runtime/verification diagrams43, and consistent
copy44 precede the Data/API topics. Provider identities46 remain separate from
runtime diagrams43 even though their original source commit mixed both. Shared-file edits do not justify combining
these problems; panel, grid and architecture motion remain34–36.

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

The final assessment closes the original inventory: 57 files match the intended
reference exactly and 34 have recorded reviewed differences; all 168 source
commits have a retained, superseded or production-delivered disposition. All 56
merge IDs and parents were verified as evidence, with no replay. Delivery owners
come from the actual accepted topic diffs rather than speculative file ownership.
The [readiness assessment](dashboard-build-readiness.md) and
[finite motion results](dashboard-motion-assessment.md) record current evidence
and its limits. Final PR checks and fresh exact-SHA sidecar verification still
precede release. Historical scrolling remains a separate subsequent experiment.

CI and corrected governance intentionally differ from the old source. Other
runtime/assets must match the intended reference or have a reviewed exception.
Full source accounting, applicable gates, local browser review, and bounded
performance assessment precede the exact-SHA sidecar-only release. Preserve the
old image and private configuration for rollback. No partial wave is deployed.

Release preparation uses one new `dashboard-recovery-1` query key for all
application-owned scripts and styles across the four pages. The source reused
old keys for changed map and estimate logic and gave the shared stylesheet
different URLs. Keeping a single fresh key avoids mixed cached releases; pinned
MapLibre assets remain unchanged.

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

Incident labels #148 passed all gates and merged at `5347c97`. Default replay
recovery resolves a five-hour window ending at the earlier of both corridors'
latest valid observation. Explicit start or end bounds remain unchanged. Missing,
failed or invalid latest reads keep the safe retained fallback rather than choosing
epoch or claiming a shared window from just one corridor. The experimental public
mount still ignores replay requests; no provider or collection behavior changes.

Default replay #149 passed all gates and merged at `03ff85b`. Preload recovery
uses only the snapshot, availability and refresh-pacing hunks from `8f5de50` and
`7e9ad34`. Shared reads are deduplicated per cycle; controls use local snapshots,
failed slices retain their last good data and busy automatic cycles do not queue.
The source's hidden map startup is replaced by shared module-only warming with
retry, so combined view creates no WebGL context or basemap reads. Cold failure
copy does not claim an earlier snapshot exists. Layout remains a separate topic.

Preloading #150 passed all gates and merged at `e2c0a6b`. Wide-layout recovery
restores the160rem shell, tall desktop charts, proportioned metrics and mobile
navigation. Native320px checks reproduced summary text escaping its card; the
range and worst segment now stack inside the narrow container without reducing
canvas resolution. All mixed `7e9ad34` hunks have individual topic ownership.

Wide layouts #151 passed all gates and merged at `a41d441`. The information-shell
topic restores the three basic first-party pages, relative navigation, shared
theme and retained operational-status contract. Native narrow dark and offline
checks confirm fitting content and retryable connection failure, not a false
traffic outage. Rich stories, navigation, maps and motion remain separate topics;
no intermediate page is a release candidate.

Information shell #152 passed all gates and merged at `fc83c22`. Architecture
foundation recovers only `2998459`, `4651f11` and `967f6c1`: the static data path,
runtime/operations context, focus tracing and mobile fact grid. Later story,
section navigation, live-health presentation and optimized motion remain their
own topics. This intermediate source styling is not final visual acceptance.

Architecture #153 passed every applicable gate and merged at `4ce4190`. Section
navigation recovers only the six anchors, scroll-linked active location and
full-width route. Updates are frame-coalesced; the opaque route avoids backdrop
filtering. On mobile its top position follows the existing non-fixed header,
so it neither leaves a vacant60px strip nor hides the anchored section. Hero,
health, copy and motion are separately owned, and no partial page is deployed.

Section navigation #154 passed every applicable gate and merged at `85c5b31`.
Live-health recovery restores the four retained signal checks and a technical
disclosure without changing the backend contract. Requests time out after eight
seconds, cannot overlap, and skip automatic reads while hidden. A source problem
stays degraded while usable flow remains; connection failure is not an outage.
The heartbeat handoff remains, without a forced layout on refresh. Its static
grid is restored here; efficient grid travel and visibility-based decorative
pause remain separate motion work before the complete release.

Live health #155 passed all applicable gates and merged at `bf67378`. Its actual
mutation-job log confirms frontend-only scope skips PIT, while frontend, full
build/coverage, container and security checks remain mandatory. Earlier ledger
wording saying “full mutation” for frontend-only topics is corrected to the
applicable mutation-scope gate; no checks have been disabled.

Headline recovery restores the finite source-to-target handoff, wrapped-text
underlines, actions and introductory cards. Resize and font changes share one
pending frame, and geometry is read before changing line styles. Discarded rays
stay retired. Decision-card styling, final copy/coverage and continuous diagram
motion remain separate; this intermediate page is still not a release.

Headline #156 passed every applicable gate and merged at `7764cc8`. Decision-card
presentation restores numbered neutral cards and the forest hover treatment using
an opacity layer rather than animated shadows. Native desktop light/dark and
narrow checks preserve legibility and fitting content; copy remains separate.

Decision cards #157 passed all applicable gates and merged at `24fc62b`.
Provider identities restore the original TomTom/CDOT images and source styling
as a separate topic. Native light desktop and dark narrow checks confirm loaded
marks and fitting content; source descriptions stay with copy topic44.

Provider identities #158 passed all applicable gates and merged at `306afc1`.
One diagnosed Maven Central HTTP502 interrupted the API image build; a single
failed-job retry passed the unchanged head, with no dependency or gate changes.
Static runtime and verification diagrams now restore the source layout and
original brand assets. Native narrow light/dark checks preserve fitting panels,
wrapping operations pills and visible icons. Continuous motion stays with topic36;
the verification illustration does not claim current release-check results.

Static runtime #159 passed every applicable gate and merged at `08cfbec`.
The copy-only topic restores plain-language descriptions and sentence-capitalized
detail rows without introducing connector-motion metadata. Eight short check
labels occupy two desktop rows; narrow layouts retain four readable rows rather
than squeezing them into two. The isolated bold traffic step is removed, and
the API/dashboard tagline describes the result rather than implementation jargon.

Copy #160 passed every applicable gate and merged at `f79e388`. Data evidence
restores source distinctions, report placement, calculation recipes, retained-day
ranges and interpretation limits. Each corridor keeps its own retained date;
bounded reads show partial failure and retry guidance without claiming ingestion
is down. Native checks corrected startup ordering, nested heading focus and narrow
unavailable-value collisions before commit. Hero map, actual I-70 alignment and
continuous motion remain separate topics before any complete-candidate release.

Data evidence #161 passed every applicable gate and merged at `2b4fb8b`. API recovery
restores the twelve-route catalog, public/client access lanes and five optional
presets. Reads never run on startup, cannot overlap and stop after eight seconds.
The old fixed300/min claim is corrected: the existing sidecar actually reports120
and the limit is deployment controlled. Responses expose their real remaining
allowance and retry guidance; no backend or provider behavior changes.

API #162 passed all applicable gates and merged at `58f034f`. GitHub's first
run lost the required aggregate job despite thirteen successful jobs; the
unchanged head passed a fresh complete attempt without a gate bypass.

Hero typography recovers the single shared32–58px scale, line-height and tracking.
Native measurements confirm identical computed values across System, Data and
API at actual1093px and390px widths. The map layout remains its own next topic.

Responsive evidence correction: the earlier detached preview tabs stayed at
1280px despite requested viewport overrides. Their functional observations
remain useful, but their recorded narrow-width labels are not valid responsive
evidence. Repeat those layout scenes in the native in-app preview, asserting
`innerWidth`, before final acceptance or release. Do not infer a tested width
from the requested override alone.

Framed Data map #164 passed every applicable gate on its corrected two-commit
head and merged at `1aa1e00`. CodeQL first rejected an imprecise hostname regex
in a test; exact URL-hostname equality passed fresh CI and the actual security
result without dismissing the finding. No intermediate map was deployed.

Coverage alignment recovers only the frontend deltas from checkpoint `91ba877`
against its first parent. The verified live route already provides MM206–274,
68 miles, nine anchors and eight posted-limit zones. UI distances, endpoint
labels, calculated ranges, demos and synthetic fixture geometry now agree with
that existing contract. Production foundations and the mixed merge are not
replayed; no public transition notice or historical data change is introduced.

Coverage #165 passed all applicable gates and merged at `4dab6f3`. Border motion
now restores the two-sided720ms drawn outline independently of grid, diagram
and map animations. Geometry measurements are frame-coalesced and batched before
SVG writes; unchanged sizes settle without ongoing JavaScript animation. Native
checks observe the actual intermediate stroke offset before completion at1093px,
390px API and320px Data, with matching full-width SVGs and no page overflow.

Shared heroes #163 passed every applicable gate and merged at `ff72e69`.
Border #166 passed both same-head CI runs and the actual security result, then
merged at `acb25a9`. A delayed PR trigger overlapped one manual dispatch;
both completed successfully without further dispatch or gate changes.

Grid motion restores the original112-degree diagonal and left-to-right travel
on Data limits, API guardrails and live health. A fixed32px mask clips a moving
transform/opacity beam rather than animating the mask itself. Native actual1093px
and390px checks confirm visible motion, offscreen pausing and fitting content.
Architecture keeps its source vertical descent and green/gold static backdrop.
The shared visibility foundation remains separate from diagram recovery.
Grid #167 passed all applicable CI/security checks and merged at `6c6bda5`.

Diagram recovery restores original clocks across System, Data and API under one
visibility budget. Traveling rails/scans use transforms; static glow layers
crossfade rather than animating shadows. Connectors read shared node rectangles
before writes, only on resize or visibility events, with no continuous geometry
loop. Verification timers stop offscreen, hidden or on disposal and preserve
back-forward restoration. Its gates illustrate the release path, not live CI.
Native1093px checks confirm six attached connectors and active verification;
390px runtime packets and320px Data icons fit. Technical documentation navigation
and other static parity differences remain separate from this motion-only topic.
The neutral hero map restores the source frame, normal overview/detail basemap
contract, green/rose corridor traces and the four-across desktop facts strip.
Renderer and data startup have bounded deadlines, invalid lines never allocate
WebGL, and navigation cannot initialize a late renderer. Native390/320px checks
keep failure messages and the wrapped legend visible. Old whole-geometry glow
work is not restored; travel-paced compositor overlays remain their own topic38.

Native responsive repeats now confirm the prior API390px dark429/retry scenario
and320px API access/route panels and unavailable Data values fit. Remaining final
responsive/performance scenes still require actual viewport measurement.

Diagram #168 passed every applicable CI/security gate and merged at `5f844cb`.
Normal Git transport repeatedly failed with server errors; GitHub's Git-object
API reproduced the exact validated commit, including its message newline,
before a non-forced topic-ref advance. Destination, scope and checks did not
change. No sidecar or production deployment occurred.

The standalone road-sign fix scopes pointer reflection to the component and
cancels its pending frame when disconnected. Reflection layers and swap timing
remain intact. The primary dashboard neither mounts nor fetches this legacy
component, so this recovery is not a claimed dashboard performance improvement.

Pointer #169 passed all applicable CI/security gates and merged at `1166dfd`.
Travel-paced map pulses now use two small green/rose transform overlays, not
per-frame WebGL style updates. Each one-way trip takes one second per rounded
travel minute from the same calculator used by the dashboard. Complete combined
cells take precedence; corridor average remains the existing fallback.

Current-cell observation time now correctly wins over a stale summary timestamp.
Unavailable or invalid readings hide only that corridor's pulse; retained
estimates are labeled. Four bounded reads refresh once per visible minute.
Offscreen, hidden and reduced-motion states pause travel; navigation aborts
outstanding pace requests and cancels animations. Disjoint geometry is not joined
by a fabricated roadway. Renderer startup safeguards and the wrapped legend stay
intact. Native1093/390/320px checks cover visible motion, pause/resume, current,
retained and unavailable labels without overflow. The fixture uses a fresh clock
for unanchored current reads, so long verification sessions do not become stale.

Travel pulses #170 passed all applicable CI/security gates and merged at
`bf78a5e`. Final static parity is a separate topic: restore the missing ingest
selector, five technical documentation links, provider accents and matching
Data/API fact typography, page backdrop and desktop spacing. The small-screen
map header omits only its secondary count, while the pace legend keeps wrapping.
The optimized SVG outline and transform-based motion are not reverted.

The rule-by-rule stylesheet comparison found no remaining unmatched blocks.
Remaining static scan/terminal differences are the reviewed transform-layer
implementation; obsolete reduced-motion pseudo-border rules are superseded by
the accepted SVG paths. The existing truth-heading base rule already matches
the source mobile layout. These differences do not justify replaying dead CSS.
Full inventory accounting, final responsive/performance assessment and the
single complete sidecar release remain required before completion.

Static parity #171 passed all required checks and merged at `37d7641`.
The end-to-end source audit caught a separate dashboard omission: two-hour
snapshots were already preloaded but had no visible range button. The short-range
control topic restores `2H` without changing requests, plotting or the default
24-hour selection. It also restores the existing 15-second manual-sync hint.
Every preloaded range must remain reachable through the controls.

Short-range #172 passed all required checks and merged at `c9fa6bb`.
The separate bounded-diagnostic topic adapts the original motion preview:
complete pinned source pages/assets, fixture8091-only GET proxy, four finite
eight-second scenes and cleanup on hidden/navigation/stalled-frame interruption.
It records unsupported long-task monitoring as unknown and counts map-style
updates consistently across variants. It neither changes application motion nor
claims CPU/GPU utilization from frame timing. See the
[fixed assessment protocol](dashboard-motion-assessment.md).
