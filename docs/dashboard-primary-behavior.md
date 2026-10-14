# Primary dashboard behavior

On the historical-window-summaries topic, moving away from Current changes the
top cards to summaries of the visible window. Speed is the mean of actual usable
observations within its minute-aligned bounds, including archived rows—not an
average of interpolated chart pixels or a rollup containing later observations.
Travel estimates add each observed speed zone's distance/speed; only complete,
contiguous corridor coverage contributes. The average weights partial buckets by
their overlap with the window, and the range shows the fastest/slowest complete
bucket estimates. The slowest average zone is observation-weighted. Incident
totals count distinct tracked durable events overlapping the window without the
graph's marker cap. Missing information remains a dash, never live data or zero.

Earlier incident archives use the historical markers' location/category filters
and three-minute continuity rule. Their uncapped reconstructed count is labelled
`Est. Incidents`: missing provider IDs and polling gaps make it an estimate, not
a definitive unique-event total. Compact UTC-week endpoints are cached for ten
minutes and reused across timeframes and nearby pans. Week seams do not split
continuous episodes. Cache weight is bounded to 50,000 episode units including
block overhead; failed reads are never cached as empty history. Each missing-block
query has a five-second timeout and fetches no marker geometry or raw payloads.
Cold queries cover at most two consecutive weeks to avoid large disk-backed sorts;
all archive work for the selected corridors shares a ten-second deadline. Completed
blocks survive a later batch failure, without caching the failed block as empty.

When the selected window has no zone observations, travel time instead uses each
positive, finite retained corridor-average speed and the corridor distance
applicable to that observation. The mean averages those distance/speed estimates,
not distance divided by the window's mean speed; extrema use the same valid
observations. Complete zone estimates still take priority. Failed, incomplete or
stopped zone observations do not trigger this fallback. Existing tooltips and
the response's `travelMethod` identify the estimation method without adding UI.
When no usable zone metric exists, the card shows `Lowest Observed Speed` from
retained corridor-average observations instead, with no invented location.
Historical travel extremes use compact `Fastest`/`Slowest` labels and can wrap
inside narrow cards without expanding the card or overlapping its neighbor.
The recorded distance boundary is cached for ten minutes; repeated navigation
does not rescan zone history. No stored observations are rewritten or created.

Graph navigation remains the first-priority path. After motion finishes and graph
coverage is available, card reads settle for 50ms after buttons/keyboard changes
or 150ms after wheel input. One cancellable compact read serves the visible
corridors. It shares the existing 48-per-minute budget, two reserved live slots
and server Retry-After cooldown, but has one independent background slot.
Supported browsers request progressive NDJSON on the same summary route:
speed/lowest-observation values arrive first, then travel/zone values, then
incident counts. This is one request, not polling or a request per field. Ordinary
JSON remains supported. Streaming has two workers, two queue slots and a fifteen-
second timeout. One speed/zone calculation and one archive lookup may run at a
time; a pending archive lookup does not hold the next window's early fields.
Concurrent nearby archive reads join the same bounded lookup and reuse its result
rather than issue duplicate scans. Disconnects stop later stages, and a failed
stream preserves already received values without manufacturing missing fields.
Bounds are checked on every update;
only completed summaries enter the client cache. Unchanged text is not rewritten
for later pieces, and each selection's tooltip dates are formatted only once.
A ready card can dispatch beside an in-flight preload, and a slow summary cannot
hold the graph request slot. Motion does not issue intermediate card reads.
No speculative card prefetch is added. Minute-keyed summaries
reuse a 32-entry client cache across Overall/Speed Zones. The server retains at
most 256 compact summaries and admits only one cold calculation at a time.
It uses the existing indexed zone query without taking the graph history-block
lock or retaining additional full-zone payloads. Busy capacity gets at most one delayed retry,
not a polling loop. Partial failures have short cache lifetimes;
Sync now retries them explicitly. Hidden tabs/page exits cancel pending work.
Current restores the existing live/day/period cards; map, incident tables,
operational health and sync timestamps remain live rather than silently replaying.
The candidate is unmerged and requires separate experimental review.

The API catalog includes a compact I-70 history example with brief notes on UTC
timestamps, missing speeds and empty results. Its row cap is not presented as
full-window coverage.
Loading the recipe selects the existing explorer preset without making a request;
only Run example sends a read. The recipe uses the active deployment's API prefix.

The API access-model illustration joins the two incoming gold signals at the
center, then carries one signal down to the shared-contract block's top edge.
It disappears on contact, with its glow clipped so it cannot cross onto the block.
The loop uses only transforms and opacity; offscreen/hidden-page pausing and the
static narrow-screen/reduced-motion presentation remain unchanged.

The System page has no secondary scroll-progress bar. Primary navigation and
section deep links remain available; section offsets account for the main header.

The System health heartbeat replays its existing finite CSS animations on each
refresh without restarting the continuous beacon or grid. Completion is cleared
after three uninterrupted visible seconds following the request; offscreen,
hidden-tab and page-cache transitions defer cleanup until the panel is visible
again. Returning to view reuses the latest status without another API request.
Reduced motion remains static, and the sixty-second refresh cadence is unchanged.

The promoted dashboard retains the deployed dual-corridor interface: I25 and
I70 summaries, current and historical baseline charts, incident lifecycle tables,
focused maps, operational status, and System/Data/API information pages. The
accepted palette, light/dark themes, full-resolution charts and visual motion are
preserved. Production still has one ingestion service and the existing database.

The corridor selector uses the same segmented button style as the timeframe
controls: Both Corridors, I-25 and I-70, with the existing graph shields repeated
in the individual corridor buttons. Parenthesized direction icons indicate
north–south for I-25 and east–west for I-70; accessible labels name those directions.
The selected corridor stays pressed;
deep links still select the corresponding corridor. Switching corridors returns
the chart to Current with scrolling disabled while preserving the timeframe.

The sync-status line is right-aligned immediately before Sync now. On narrow
screens the toolbar can wrap, but the status text and button stay paired.

Speed Zones retains the full-width graph and the original map placement by
default. The selected Overall or Speed Zones button stays pressed with the same
depth effect as the selected timeframe. Selecting Speed Zones slides the chart-detail buttons left to reveal
a separate Zone Finder toggle; it is unavailable in Overall and Both Corridors.
Zone Finder starts off and resets off when changing corridors or returning to
Overall. Toggling it does not change the displayed historical time or refetch
graph history. A short transform/opacity transition slides the graphs and moves the
same map into place; disabling reverses it. Reduced-motion users switch instantly.
When enabled, it pairs each graph row with a numbered zone locator
on the existing map. The corridor shield slides left as the graph expands into its
space, clipped at the chart lane boundary rather than sliding beyond the panel,
and reverses when the finder is disabled. Both use the same transform-only
transition as the map, without resizing the chart bitmap each animation frame.
On wide screens, graph rows expand vertically to fill the height shared with the
map, so corridors with fewer speed zones do not leave empty space below them.
That height change is included in the same animation and reverses on disable.
Mobile layouts replace the side shield column with a compact horizontal corridor
heading above each graph, including in Zone Finder. The final pipeline statistic
is centered below the other two. Standalone freshness reads `Just now`.
The map sits beside the graphs and stays visible while scrolling on wide
screens, expanding its imagery into the available viewport height while keeping
the zone controls visible. Short and narrow screens retain the compact map;
smaller screens stack it above the graphs. The enabled finder button has a
full-segment pressed depth effect and a rose-filled pin with its original outline
color and an unfilled center ring.
Dark mode inverts the original inset shape with a subtle light shadow on selected
and pressed controls, without an extra bright edge. Light mode remains unchanged.
Select a map badge, a named
zone button or the graph's Z badge to highlight the same section and graph row.
Show whole corridor resets that highlight. The existing geometry anchors place
zone ranges; unplaceable ranges are not guessed. Names come from matching route
metadata, with mile-marker ranges as fallback. Each configured zone has a stable
identity color shared by its graph badge, named button and map section. Bubbles
use a saturated magenta for Z7 to distinguish it from green map backgrounds.
Missing geometry endpoints respect ascending or descending mile-marker order,
so I-25's northern section retains the Z3 color in either theme. The whole-corridor
button fills the fourth control cell for I-25 and is centered below I-70's controls.
The colored bubbles
show `Zx | posted mph`, with a dash for an unavailable posted limit. Labels stagger
along each corridor and choose alternate in-map offsets to avoid other labels and
the road geometry where space permits, recalculated
only when zone geometry changes or the map moves/resizes. Finder mode
shows zone identity rather than traffic coloring, and labels that distinction.
Disabling it restores the unchanged current/frequency traffic styling and legend.
This uses one renderer and the already-loaded data; zone
selection itself makes no API requests and does not change historical timing.

The page embeds an escaped default snapshot when public reads are enabled, then
warms supported ranges through the existing batched snapshot API. Partial failures
retain useful prior sections with explicit status. Actual observation timestamps,
not repeated speed values or HTTP success alone, determine freshness.

Continuous/prepared historical loading defaults on in the primary page, with
Historical Scroll initially disabled. Preparation remains finite and bounded;
missing or evicted history requires additional bounded reads. Existing request
limits, visibility cancellation, shared caching and retry controls are retained.

First, Current and the half-frame earlier/later buttons work independently of
that toggle, which controls wheel and graph-keyboard navigation only. Buttons
remain disabled at the corresponding history boundary or until coverage is known.

Dashboard timestamps and chart rulers use the browser's detected timezone, with
Denver as the fallback. Sync time includes a parenthesized Colorado clock when
it differs. Historical window labels include timezone names and the signed hours
to add to local time to obtain Mountain time (for example, Eastern time shows
`−2 hours to MDT`). Offsets and MDT/MST are calculated for the displayed date;
windows spanning an offset change identify the center as the offset reference.
Fractional-hour zones retain their minutes and local midnight guides. This is
display-only: UTC query bounds, elapsed-time navigation, Colorado daily travel
summaries and Denver-hour baseline matching remain unchanged.

Production Compose explicitly disables replay. The HTML controller carries that
policy to the browser so moving from the experimental URL does not accidentally
enable a rapid production replay loop. `?replay=1` remains ignored in production.
The local-only `scripts/start-historical-replay.sh` explicitly enables replay,
disables Flyway, uses a read-only API connection, and stops only the verified local
project's ingestion before starting the API. It refuses remote/server execution.

The primary API uses the existing routes service for directional geometry and
passes the existing restricted browser basemap setting when configured. Keep
production authentication keys intact. No migration, retention policy, provider
poll schedule or per-account quota policy changes accompany dashboard promotion.

The fixture preview defaults to keyless USGS imagery. To compare the existing
experimental basemap, start it with `DASHBOARD_FIXTURE_CONFIGURED_BASEMAP=1`.
This makes one bounded map-configuration read per preview process and retains
the restricted browser key only in memory. Traffic stays synthetic. Tile-key
domain restrictions still apply: a localhost preview may show the route and
zone markers but no tiles; do not relax those restrictions for a preview.

Dataset-specific coverage and corridor-definition boundaries remain described in
`docs/data-history-coverage.md`; missing older map/zone observations remain missing.
Older scalar history stays available through the existing archive-inclusive views.
