# Frontend ownership and validation walkthroughs

This experimental batch starts at `a1ac4c5` and returns to
`experiment/dashboard-reconstruction`. It preserves the lightweight deferred
script architecture, public behavior, provider policy, storage, and deployment
boundaries. It does not promote the dashboard to production.

## What the eight segments change

| Segment | Responsibility | Result |
| --- | --- | --- |
| M1 | Regression organization | The 8,979-line test file becomes a 19-line runner, fifteen feature suites and four fixture modules. The full command remains unchanged. |
| M2 | Chart data | `dashboard-series.js` owns normalization, smoothing, gaps, baseline profiles, zones and domains. Four value/format helpers are explicit inputs. |
| M3 | Incident model | `dashboard-incident-model.js` owns legacy conversion, thread identity, aggregation and lifecycle rules, without DOM or request dependencies. |
| M4 | Chart calendar | `dashboard-chart-axis.js` owns viewer-time ticks and bounded day-transition caching. Denver baseline calculations remain in the series model. |
| M5 | Canvas rendering | `dashboard-chart-painter.js` owns drawing and marker layout. The coordinator supplies an explicit paint frame; models, palette and canvas-sizing adapters remain stable factory inputs. |
| M6 | Map data | `corridor-map-data.js` owns geometry, marker interpolation, cells, hotspot aggregation and GeoJSON preparation, without a renderer or DOM. |
| M7 | Map style | `corridor-map-style.js` owns the initial style/layer definition. Renderer loading, interactions, markers, popups and theme updates stay in the map controller. |
| M8 | Maintainer handoff | Place trailing gap, retry and asset regressions with their feature owners; document ownership, tradeoffs and validation walkthroughs. |

`dashboard.js` remains the screen coordinator: initialization, controls, loading,
refresh, summary presentation, incident-table wiring and view state. `dashboard-history.js` owns
history requests and cached windows; `dashboard-continuous.js` coordinates
continuous navigation and rendering. They call the same chart/incident owners.
`corridor-map.js` remains the MapLibre lifecycle and interaction controller.
`dashboard-incident-table.js` owns incident rows, detail/source expansion and
status/time presentation. Its render call receives explicit availability, focus
and expansion values; it does not read dashboard state or start requests.
No module should import its coordinator or start a request during definition.

Load dependencies before consumers in `index.html`, and use a new cache key on
every changed served script. The asset test checks exact keys and consistent
references. The VM fixtures also load the same dependency modules. Pure models
can be tested alone; full integration cases continue to exercise their callers.

The coordinator falls from 3,269 to 1,848 lines; the map controller from 1,931 to
1,249. These reductions mostly represent code moved to named owners. They are
not repository-wide code deletion. Explicit factories/imports add some lines.
The drawing module remains substantial (780 lines), but now has one coherent
job. Its broad input list exposes existing coupling; it does not eliminate it.

## Stylesheet ownership

| Owner | File and scope |
| --- | --- |
| Shared browser shell | `dashboard.css`: theme tokens, typography, navigation and common control/accessibility defaults used by all four pages. |
| Dashboard screen | `dashboard.css`: corridor summaries, chart/history controls, incident panels and map/sign interactions. |
| Shared information layout | `information.css`: information shell/cards, key-value layouts, actions and shared Data/API hero facts. |
| System page | `information.css`: status/heartbeat, architecture/runtime, operations and verification components. Related operations labels/icons and System hover controls share matching declarations. |
| Data page | `information.css`: hero map, source pairs, derived metrics, geometry, history and truth/coverage sections. |
| API page | `information.css`: terminal, request path/explorer, response contract, endpoint atlas, access handoff and guardrails. |
| Standalone illustrations | `flow-diagram.css` and `health-panel.css`: their named diagram/panel components. |

Keep page-specific rules near their owners and shared theme values in the shell.
Identical values in unrelated components do not automatically justify a shared
selector. The dashboard's plain background before `color-mix()` remains a fallback.
Responsive, pseudo-state, animation and reduced-motion rules are behavior: retain
their cascade order and test the affected states. Data/API shared rules and final
animation overrides cross page sections, so splitting page files needs its own
dependency and cascade assessment.

The targeted CSS follow-up groups System control/operations declarations and
merges only adjacent identical reduced-motion contexts. It preserves every
selector, ordered declaration and keyframe. Sixty static before/after scenes
cover both themes, three viewport widths and System hover/focus/busy/disabled/
reduced-motion variants; animations are frozen for comparison, not benchmarked.

## Complexity versus simplification

Necessary complexity protects product behavior: account-specific allowances,
atomic reservations, live/archive continuity, truthful source and time labels,
cache cancellation, missing-data gaps, and recovery. Removing those branches to
make files shorter would remove guarantees or features.

Accidental complexity comes from finding unrelated responsibilities in the same
large file, implicit cross-script helper ownership and one enormous test suite.
This batch makes ownership visible and permits focused model tests. A new
framework, bundler, generic chart engine, or additional service would introduce
migration and operational work without demonstrated benefit here.

The existing three-service layout has operational cost. It also separates
provider ingestion from read-only serving and route metadata. A service merger
would require a separate measured case; changing it during frontend cleanup
would enlarge risk without resolving the immediate concentration problem.

The closure review isolates table presentation with explicit view inputs. The
subsequent [paint-frame contract](dashboard-chart-frame-contract.md) separates a
rendered strip's span from the selected range and removes direct coordinator/history
state reads from the painter. Request/cache/navigation ownership stays unchanged.
The demo builder, map popups and
history navigation stay with their current owners; another extraction needs a
specific maintenance benefit. Moving ten lines behind a factory that needs twelve
inputs is usually a poor trade. See the [cleanup handoff](cleanup-handoff.md) for
retained contracts, deferred work and the stopping criteria.

## Walkthrough: explain account rollover

Question: when the primary account cannot afford the next poll, what happens?

1. `TomTomAccountPool` supplies configured accounts in primary-first order.
   `TomTomAccountAvailability` excludes quarantined or unavailable accounts.
2. `TomTomAccountQuotaManager.reserveCompleteBatch` rejects invalid sizes, then
   selects accounts with enough room for the entire requested batch. It does
   not split this reservation across accounts. `reserveUpTo` is a different
   contract and must not replace it casually.
3. `TrafficRequestBudget.reserveMonthlyForAccount` stores usage per provider,
   account, product and billing period. Its conditional SQL update enforces the
   hard stop atomically. An earlier read of remaining room alone would race.
4. An allowed reservation retains its account identity and can record a
   transition. Releases charge back the original reservation. Provider failure
   handling can mark an account unavailable; another usable account can still
   keep ingestion available.

Concrete existing test: with a hard stop of 195,000, primary usage 194,997 and
an eight-call batch, `reservesACompleteBatchFromTheNextAccount` expects all eight
calls on secondary and no primary reservation. Its companion
`blocksAnIncompleteBatchWhenNoOtherAccountIsAvailable` expects no reservation.
These are synthetic test values, not a statement of current provider pricing.

Read the quota-manager test alongside `TrafficRequestBudgetTest` to distinguish
selection policy from persistence/concurrency protection. Run them without
provider calls:

```sh
./mvnw -pl ingest-service -Dtest=TomTomAccountQuotaManagerTest,TrafficRequestBudgetTest test
```

A useful explanation identifies the full-batch guarantee, why the SQL guard is
needed, which account a release affects, and why one exhausted account does not
automatically mean the service is out of service.

## Walkthrough: trace an archived observation to the API

Question: why can an old sample still appear after retention removes its live row?

1. `TrafficRetentionJob` chooses a cutoff and bounded batches.
   `TrafficRetentionBatchWriter.archiveNext` archives dependent incidents and
   samples before deleting eligible live samples in a transaction. This is a
   storage-tier move, not permission to discard history.
2. The `traffic_sample_all` view includes live samples and archived samples with
   their logical source reference preserved. Live `history_id` is the sample ID;
   archived `history_id` is negative `source_id`, while `sample_ref_id` remains
   the original reference. `TrafficHistorySample` maps that view;
   `TrafficHistorySampleRepository` reads it with corridor/time/order bounds.
3. `TrafficController.history` validates corridor, window and limit. It chooses
   the appropriate repository query, applies the optional `asOf` upper bound,
   maps rows with `TrafficSampleMapper`, and returns the history DTO. The speed
   only and incident-inclusive limits intentionally differ.
4. Dashboard history blocks and the browser's history modules assemble bounded
   views and feed the series model. Repeated recorded speeds remain observations;
   smoothing must preserve gaps rather than inventing coverage.
5. Zone rows have separate durability: migration V24 makes `sample_id` a logical
   reference to a live ID or archive `source_id`. Older deleted zone detail
   cannot be recreated. Local map-cell history is another dataset with its own
   coverage boundary. See [data history coverage](data-history-coverage.md).

Use a disposable database for retention tests. Compare counts, source IDs,
observation timestamps and an anchored history response before and after a
retention batch; verify that the archive-inclusive result remains available.
Do not test this by deleting production data. This batch's runtime reconciliation
uses synthetic live/archive observations and a read-only API role.

A good walkthrough distinguishes a corridor observation from a zone observation,
an incident event and a current map snapshot; their histories are not interchangeable.

## Walkthrough: make a small change and prove its behavior

Question: can the maintainer identify an owner, change behavior deliberately and
write a test that could detect a regression?

Use the existing ninety-minute gap rule as a worked example. This cleanup does
not change that rule. `dashboard-series.js` owns splitting speed observations;
`dashboard-chart-painter.js` draws the resulting segments. A UI control or HTTP
handler is not the right place to change a mathematical gap rule.

1. State the desired boundary precisely: a gap of exactly ninety minutes stays
   connected; a longer gap starts a new segment; an invalid point breaks the
   line. Establish current behavior before editing.
2. Add/assert these examples through the series model's public behavior, including
   repeated speeds at different timestamps. Check returned segments, not the
   spelling of a private helper or a copied implementation.
3. If a different threshold is requested later, first make the new expectation
   fail against the old code, then make the smallest change in the series owner.
   Inspect all affected chart modes and retain time/zone behavior.
4. Run the focused suite and then the unchanged complete frontend command:

```sh
node --test scripts/tests/dashboard/series-and-zones.cjs
node --test scripts/tests/dashboard.test.cjs
```

The full runner also includes transport fixtures using localhost, timezone,
continuous-history, map, incident, health and variable-sign cases. Passing a
pure model test does not prove script load order, request handling or browser
startup. Update changed asset keys and run packaged/runtime checks and applicable
CI before integration. Java changes require `./mvnw clean verify`; operational
changes require resilience and focused shell tests. Mutation-sensitive Java
changes must retain the existing mutation gate.

The expected explanation covers the requirement, owner, failing example,
minimal implementation, broader callers, and rollback. Reciting a command or
claiming that a large test count proves every feature is insufficient.

## Focused maintainability follow-up

`browser-theme.js` owns stored/device preference, toggle persistence and accessible
control labels. Dashboard map/chart updates and information-page icon paths remain
explicit inputs. Information pages retain their existing preference recheck on
device changes, including when storage writes fail; the dashboard keeps a manual
choice for the visit. Load the shared owner before either page coordinator.

`information-api.js` owns the API explorer DOM, request presets, bounded reads,
clipboard interaction and response presentation. `information-data.js` owns Data
page daily reads and retained-day estimates; its numerical/day helpers do not
read DOM or start requests. Both receive an explicit API-base resolver and start
only when initialized on their page. `information-pages.js` retains shared visual
effects and the System status/heartbeat lifecycle. Load both controllers before
the initializer; creating them does not fetch data.
