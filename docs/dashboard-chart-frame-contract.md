# Chart paint frames and history ownership

`chartPaintFrame` in `dashboard.js` captures the display policy for one synchronous
paint. The coordinator and continuous-history renderer pass that value to
`DashboardChartPainter.drawCorridorChart` or `drawZoneChart`. The painter receives
stable model/axis/formatting and canvas/palette adapters at creation; it receives
no dashboard state, history controller, request function or mode callbacks.

## Rendered span versus selected range

The rendered interval is `[end - hours * 3_600_000, end]`. `hours` describes the
canvas being drawn. `rangeHours` describes the user's selected range: 2, 6, 24,
168 or 720 hours. These values are equal for a normal window. A cached history
strip normally spans twice the selected range, with extra content on both sides;
its `hours` is doubled while `rangeHours` stays unchanged. The bounded-memory
direct-render fallback uses a single-span strip with the same display policy.

Use `hours` for time-to-pixel mapping, raw observation selection and baseline
coverage. Use `rangeHours` for smoothing width, the detailed-sample cutoff,
incident grouping/count limits and weekly guide emphasis. Strip tick spacing
also follows `rangeHours`; ordinary window ticks retain automatic span selection.
Using the doubled span for those display decisions changes the visible chart.

## Frame values

| Field | Meaning and owner |
| --- | --- |
| `end`, `hours` | Rendered interval. The coordinator chooses the current/retained anchor; continuous history chooses its strip bounds. |
| `rangeHours` | Selected range captured independently of the rendered span. |
| `currentDayAnchor` | Captured current time for weekly 30-day date anchors in Current view, independent of observation freshness. Null in historical/replay views, which use the 1st, 8th, 15th, 22nd and 29th. |
| `strip` | Continuous-history raster, including the direct-render fallback. Suppress its baked selection outline; the visible canvas gets a fresh outline. |
| `referenceSigma` | Selected band width captured for this paint. |
| `zoneFinder`, `selectedZoneKey` | Finder layout and selected zone identity. The painter cannot change the selection or map. |
| `liveEdge` | Coordinator's existing freshness/mode decision, always false for strips. It remains false for historical, replay, demo, stale, missing or unusable flow. |
| `pendingHistory` | Preserve the existing zone lane height while the requested window differs from the accepted data key. False for strips. |
| `zoneSpeedLabel` | Existing `Live:`/`Observed:` policy. Retained, historical, replay and long-range speeds are observed. Short-range demo retains its existing label. |
| `emptyMessage` | Already resolved loading, retry or no-data text for the selected view and corridor. |

Frames contain values, not a reference to coordinator/history state or functions
that read it later. Capture a new frame after a preference/window change. A caller
may freeze it; the painter only reads the frame and its supplied series/maps.
This is an internal browser contract, not a public HTTP payload or persisted state.

For corridor strips, continuous history supplies `samples`, `trendSamples`,
`baseline` and `domain`. For zone strips it supplies `groups` and per-zone
`baselines`, `trends` and `domains` maps keyed by group identity. Prepared series
retain clipping, smoothing halos, gap/boundary markers and stable domains. Empty
arrays deliberately mean no observations; they must not fall back to current
data. Missing optional series/map entries retain the existing model calculation.
The painter does not mutate route data, observations or prepared series.

## Shared state stays with its owner

- The coordinator owns selected range, sigma, focus, finder/selection, current
  observations, theme and live-edge eligibility. Canvas sizing and palette reads
  remain explicit browser adapters.
- `dashboard-history.js` owns the retained anchor, minute-rounded request key,
  accepted data key, pending/error states, cancellation, retry deadlines and its
  bounded window/baseline caches. A stale completion cannot replace another key.
- `dashboard-continuous.js` owns request/chunk scheduling, merged observations,
  smoothing halos, row/domain registries, raster reuse and axis settling. Its
  raster identity retains data version, size, theme, sigma, finder layout and
  coverage bounds. Selection and cursor-time labels are visible overlays; changing
  selection refreshes those overlays without rebaking the speed plot. Band-overflow
  arrows use the current explicit sigma and preserve the existing description.
- The painter owns canvas marks and geometry. Individual overlay helpers receive
  explicit sigma, range, selection or descriptor values. They cannot start reads,
  update a history key or silently consult a later dashboard preference.

No request, cache, cancellation, deadline, navigation or animation policy changes
are part of this boundary refactor. Such changes need their own behavior evidence.

## Validation and a change walkthrough

Run `node --test scripts/tests/dashboard/charts.cjs` first, then the full
`node --test scripts/tests/dashboard.test.cjs`. Frame regressions cover an isolated
painter with a frozen frame, later coordinator/history changes, doubled strip spans
across every selected range, pending lane height/loading text and mode-specific
speed labels. Existing history tests retain cancellation, deadline, navigation,
row/domain and raster-reuse checks.

For a future smoothing change, modify the series owner and test both a normal
window and a doubled strip using the same selected range. For a selection change,
keep the plot cache independent of selection and test the fresh visible overlay.
Compare canvas output and real-browser startup/interaction before integration;
test counts alone do not prove visual or performance equivalence. Use fresh asset
keys for every changed served script. See the [delivery workflow](experimental-delivery-workflow.md)
for reviewed integration, exact-revision checks and experimental-only release.
