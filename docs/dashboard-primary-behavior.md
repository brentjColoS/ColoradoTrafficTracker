# Primary dashboard behavior

Incident details expand locally, without a request. The compact view combines the
reported segment, impacts and severity, then shows a single start/end time range
and at most two useful message sentences (180 characters). Known location/timing
boilerplate and already displayed impact statements are removed conservatively;
closure reasons and distinct advisories are retained. The full provider report,
named exits, embedded schedules and source update time remain behind a separate
Full report disclosure, not repeated in the main expansion. Dates use the viewer's
timezone, retaining both abbreviations across DST changes. Planned dates are labelled
Scheduled; other provider dates are Reported, not proof of clearance. Table dates
are labelled First/Last Observed by the tracker. Unknown fields stay omitted.
Detail text is built only on expansion, rendered as plain text, and an open
report (including an opened full-source disclosure) remains open with updated content through normal refreshes. The map's
concise note remains unchanged. No polling, SQL, migrations, or ingestion changes
are added; structured CDOT schedule retention is a separate producer-side topic.

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

Graph navigation remains the first-priority path. Cards use the exact navigation
destination, not intermediate animation timestamps, and can load while the graph
is still easing toward it. The animation and its final timestamp remain unchanged.
Destination graph coverage must be available before a card read starts. Reads
settle for 50ms after buttons/keyboard changes or 150ms after wheel input.
Unchanged chart announcements and reference-band descriptions are not rewritten
per frame. One cancellable compact read serves the visible
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
hold the graph request slot. Easing frames do not restart settling or issue
intermediate card reads; new wheel/button destinations remain debounced and cancel
superseded reads. Returning toward Current restores live cards and cancels older
summaries without waiting for the animation tail.
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

Switching between Overall and Speed Zones preserves the selected historical
window when it has coverage in the destination view. If that window predates
durable zone history, the switch immediately selects the first supported zone
window and loads it without requiring a second navigation click. Current stays
Current; the selected timeframe and wheel-scroll preference do not change.

The experimental System Health component is quiet between observed events,
with no repeating heartbeats. A received dashboard snapshot triggers a short
packet/acknowledgement cue. Catalog and stored-summary reads react only when
their existing response `fetchedAt` advances; cache hits do not pretend to be new
queries. Ingest reacts when either corridor's observed sample timestamp advances,
even if speeds repeat, never when only the speed value changes. Version-hinted
responses reuse their matching cached sample data without adding requests.
The last observed activity and its time remain labelled after the cue ends.
These are browser observations, not direct evidence of provider calls, database
writes, continuous liveness, latency or uptime. Hidden/offscreen events update
the labels without queueing old animations; retained-data modes and reduced
motion suppress live reactions. The existing health states remain authoritative.

The observation desk shows three distinct metrics: Stored Observations, Samples
in View, and History Preserved. Samples in View counts observed plot points within
the selected corridors and window, including separate zone series; wider views
use bucket averages. Baselines and generated edge points are excluded. It uses
loaded chart data, recounts after animated navigation settles, and adds no reads.
History Preserved is the elapsed span since the earliest stored observation,
with its starting date, not a guarantee of uninterrupted coverage.
The existing dashboard snapshot includes an internal
`/traffic/database/observations?` section containing `observedAt`, `total`,
`corridors`, and `firstObservedAt`. One read-only PostgreSQL statement counts
stored corridor samples and finds their earliest timestamp in
both `traffic_sample` and `traffic_sample_archive`; it includes all stored sample
rows, including unusable readings, but excludes other corridor identities and
other database tables. Retention moves the two tiers atomically, so moving a row
does not change the total. The result is shared across viewers in the snapshot's
60-second cache, with version hints; failed counts also wait 60 seconds before
retrying rather than issuing repeated scans during a database problem. There is no new browser polling or provider
call. A one-second query timeout bounds a slow count. Failed reads are independent
of the chart/health sections and never become an invented zero. The cold count
still scans the countable rows; it is not a constant-time database tally.
The checked source time remains in the caption's tooltip, rather than implying a
per-insert stream or a transaction-by-transaction counter. No migration is needed.
Local fixtures supply explicitly labelled synthetic database totals: four new
rows per elapsed minute, regardless of requests or the selected timeframe.

The first reported total appears immediately; a subsequent increase ticks through
the difference over 900 ms and shows `+X added` since the previous report. Identical
reports do not animate. Decreases are displayed honestly without a positive gain.
Older reports cannot rewind the counter. Invalid totals or failed sections show a
dash, not a fabricated zero. Version hints reuse matching cached metadata. Motion
is bounded to the current update; hidden/offscreen, page lifecycle and reduced
motion settle directly to the reported number without replaying old animations.
These totals would count traffic observation rows, including archives, not all
database tables, unique vehicles, incidents or the selected graph window.


Under the Hood's experimental component keeps the five service labels and icons, but
gives each handoff a distinct illustration. Connector captions are omitted and the links share one dashed style. It omits
provider logos and watches a car pass along a longer road beneath the camera, using the same
road-edge, pavement and centre-stripe styling as the earlier road illustration.
That road fades in for the car run and out afterward; the provider-to-ingest link
stays visible like the other dashed connectors.
The provider otherwise follows the same
compact stage layout as the other services. The caption shares the title row and
step numbers are omitted. Once per 16-second car cycle, a ten-percent random
chance brings a mirrored second car from the opposite end; they stop at the
road's center with a small impact cue. This is decorative, not a live incident.
The original camera dot blinks red more actively during the car run, then fades
back to its original green as the journey moves on. It is a recording joke,
not a recording/status claim. The scene selection uses animation events rather
than timers, requests or per-frame JavaScript; offscreen pauses preserve it.
Flow/event symbols
reach ingestion, record inserts collect beneath PostgreSQL, a query travels
back to storage and returns as a response. Two bars then illustrate sender and
receiver windows: numbered packets fill a bounded three-packet range, DATA arrows
draw downward between the bars and ACK arrows return upward on a parallel path.
The window fades in for the exchange and fades out when the journey completes.
Reception advances the receive window;
the send window advances only after its acknowledgement returns. `W=3` and
TX/RX nod to sliding-window protocols, not the application's actual transport
state. The 16-second cycle gives viewers time to follow each handoff. Narrow
layouts switch below a 43rem component width, keeping the five stages horizontal
at tablet widths instead of leaving a wide empty strip beside a tall timeline.
Stacked rows use the full width for the service label and action, with reduced
spacing. They keep the small window's numbers upright with a little extra clearance
only between API and dashboard; the desktop panel remains compact. Hidden/offscreen/cached pages pause motion;
reduced motion remains static. Link geometry is measured only on layout changes,
not during animation frames. No requests or chart rendering are added.

The sender/receiver reference is [Stanford CS144](https://www.scs.stanford.edu/08sp-cs144/notes/l5.pdf)
and [RFC 9293](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.3.1).

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
heading above each graph, including in Zone Finder. In the local observation-desk
experiment, the combined stored-observation total spans the width above two equal view/history drawers
on small screens. Standalone freshness reads `Just now`.
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

The reconciled variable-limit preview retains the historical summary, incident,
health/activity, stored-observation and service-flow behavior above. Current sign
reports are separate from traffic samples and stored totals. Historical windows
and replay hide sign badges and notices until Current is restored; no historical
sign state is inferred. The shared snapshot can carry both the current-only sign
section and stored-observation totals, with independent failure and cache handling.
The static demo bridge uses an existing native sign section when supplied, and
otherwise reads the existing primary database-only sign endpoint once per minute.
