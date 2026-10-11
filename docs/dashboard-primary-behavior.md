# Primary dashboard behavior

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

Speed Zones retains the full-width graph and the original map placement by
default. The selected Overall or Speed Zones button stays pressed with the same
depth effect as the selected timeframe. Selecting Speed Zones slides the chart-detail buttons left to reveal
a separate Zone Finder toggle; it is unavailable in Overall and Both Corridors.
Zone Finder starts off and resets off when changing corridors or returning to
Overall. Toggling it does not change the displayed historical time or refetch
graph history. When enabled, it pairs each graph row with a numbered zone locator
on the existing map. The map sits beside the graphs and stays visible while scrolling on wide
screens, expanding its imagery into the available viewport height while keeping
the zone controls visible. Short and narrow screens retain the compact map;
smaller screens stack it above the graphs. The enabled finder button has a
full-segment pressed depth effect and a rose pin. Select a map badge, a named
zone button or the graph's Z badge to highlight the same section and graph row.
Show whole corridor resets that highlight. The existing geometry anchors place
zone ranges; unplaceable ranges are not guessed. Names come from matching route
metadata, with mile-marker ranges as fallback. Traffic colors retain their
original meaning. This uses one renderer and the already-loaded data; zone
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
