# Primary dashboard behavior

The promoted dashboard retains the deployed dual-corridor interface: I25 and
I70 summaries, current and historical baseline charts, incident lifecycle tables,
focused maps, operational status, and System/Data/API information pages. The
accepted palette, light/dark themes, full-resolution charts and visual motion are
preserved. Production still has one ingestion service and the existing database.

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

Dataset-specific coverage and corridor-definition boundaries remain described in
`docs/data-history-coverage.md`; missing older map/zone observations remain missing.
Older scalar history stays available through the existing archive-inclusive views.
