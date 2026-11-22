# Primary dashboard behavior

The public dashboard combines I-25/I-70 speed charts, historical comparisons,
incident reports, maps and service status. Current data and retained windows
have distinct timing and availability rules. The [read-model reference](dashboard-read-models.md)
owns the underlying calculations, cache bounds and progressive response contracts.

## Current and historical views

The corridor selector offers Both Corridors, I-25 and I-70. Selecting a corridor
returns the chart to Current with Historical Scroll disabled while retaining
the timeframe. Corridor deep links select the matching view. Overall and Speed
Zones preserve historical windows supported by the destination; an older Overall
window clamps to the first supported zone window and loads immediately.

Continuous/prepared loading is enabled, but Historical Scroll starts disabled.
First, Current and half-frame earlier/later buttons work independently of that
toggle. Buttons stop at known coverage boundaries. The toggle controls wheel,
horizontal touch drag and graph-keyboard navigation. A cold destination spanning
two uncached grid intervals loads its complete visible interval in one batch;
adjacent preparation and raster reuse remain bounded.

With scrolling enabled, a one-finger drag right moves toward older observations
and left toward Current. Taps and vertical gestures do not move history. Native
page scrolling and pinch zoom remain available. A second finger or interruption
cancels the drag; completing it does not activate a zone badge.

Historical chart navigation changes the top cards to the selected window's
summary. It does not replay the live map, incident tables, service health or sync
timestamps. Missing historical fields remain unavailable. Travel estimates and
legacy incident counts retain their calculation labels and coverage limits.

## Chart layout and time labels

Current Overall and Speed Zones plots use a dashed green edge with Live and a
small red dot beneath it. The dot fades on a ten-second CSS cycle without graph
redraws or requests. Reduced motion keeps it static. Historical, replay/demo,
unavailable and more-than-one-hour-old observations omit the indicators.

The Live group follows the plot's right boundary; overlapping final time labels
are omitted. At widths of 480px or less it stays inset. Overall uses a 34px left
gutter in Current and continuous history; both modes keep a five-pixel canvas
inset for marker clearance. Zone descriptors retain their own space.

Controls sit beside the comparison title when they fit and wrap below it when
they do not. Legends and historical-window details use full-width rows. The
right-aligned sync-status text stays paired with Sync now on narrow screens.

Chart rulers and timestamps use the browser timezone, with Denver as fallback.
Sync time includes a Colorado clock when it differs. Historical labels show
timezone names and the signed offset to Mountain time for the displayed date,
including fractional hours and DST. Windows crossing an offset change identify
their center as the offset reference. UTC query bounds and Denver baseline/daily
calculations are independent of display timezone.

## Speed Zones and Zone Finder

Speed Zones keeps a full-width graph and the normal map placement by default.
Zone Finder is a separate toggle for a single corridor's Speed Zones view. It
starts off and resets when changing corridors or returning to Overall. Toggling
it preserves the selected historical time and reuses loaded data.

The finder pairs graph rows with numbered corridor sections on the existing map.
Map badges, named buttons and graph Z badges select the same section; Show whole
corridor clears the selection. Configured anchors place zone ranges. Missing
endpoints are not guessed, and ascending/descending mile-marker order is respected.
Route names are preferred, with mile-marker ranges as fallback.

Zone identity colors agree across graph badges, buttons and map sections. Z7
uses magenta for contrast against map backgrounds. Bubbles show `Zx | posted mph`,
or a dash when the configured limit is unavailable. Labels avoid one another and
road geometry where space permits, recalculating only on geometry or map changes.
Finder styling identifies zones; disabling it restores current/frequency styling.

The same renderer moves into place through transform/opacity transitions, without
resizing chart bitmaps each animation frame. Wide layouts expand graph rows to
match the map and keep the map visible during scrolling. Narrow layouts stack
the map above graphs and replace side shields with compact corridor headings.
Short screens retain a compact map. Reduced motion switches layouts immediately.
Pressed-state styling remains visible in both themes.

## Incident reports and signs

Incident details expand locally without another request. A compact summary gives
segment, impact/severity, one reported or scheduled time range, and at most two
useful message sentences within 180 characters. Full report retains provider
text, schedule and update time as plain text. Both disclosures preserve expansion
through refreshes. Missing metadata is omitted, and date ranges retain both
timezone abbreviations across DST changes.

First/Last Observed describe tracker observations, not provider start or confirmed
clearance. Classification, long-term/continuing labels, grouping and disclosed
inferences follow [incident presentation](incident-presentation.md).

Variable signs keep the six-hour per-device schedule and one-hour current-validity
boundary. Older successful readings appear as explicitly unconfirmed Last-reported
limits, with actual read times. They do not become current restrictions or live
difference counts. Failed, blank and communication-error values are unavailable.
Historical chart views omit current sign context; optional retained sign history
uses its own [coverage and validity rules](i70-sign-ingestion.md).

## Status and illustrations

System Health reacts to successful API responses, catalog/stored-read timestamps
and new corridor observations. Repeated speed values can still be fresh. Cached
reads cannot impersonate new live observations. Hidden/offscreen events update
labels without replaying motion, and reduced motion suppresses animation.

The System heartbeat uses finite refresh animations. Completion clears after
three uninterrupted visible seconds; hidden, offscreen and page-cache states
defer cleanup. Returning to view reuses the latest status without an extra read.
Its normal sixty-second refresh remains independent of decorative motion.

Stored Observations counts original live/archive corridor rows; Samples in View
counts loaded observed plot points after navigation settles, excluding generated
edges and baselines. Wider views can count bucket averages. History Preserved is
elapsed coverage span, not proof of uninterrupted collection. Only authoritative
increases animate toward the total over 900ms; older/decreased/unavailable values
do not manufacture growth. Synthetic fixtures label their totals.

Under the Hood is a five-stage illustration with a sixteen-second cycle, including
a bounded DATA/ACK window. It is decorative and makes no requests. Hidden,
offscreen and cached pages pause it; reduced motion keeps readable stationary
stages. System navigation retains section deep links without a secondary progress
bar. All information pages share responsive primary navigation.

The Why page's four-day comparison uses selected recorded hourly averages, not a
forecast or general weekday claim. It makes no live traffic reads. Its muted clip
loops only while visible in a foreground tab; reduced motion uses a still. Three
uninterrupted visible minutes of manual pause also show that still, with Play
returning to video.

## Startup and loading

The default public HTML embeds a current 24-hour view, recent incidents and 193
hours of current/week chart context. The month-long shared incident set and
889-hour trend preload arrive later through bounded snapshots. Short bootstrap
sections have distinct version keys so their hints cannot suppress longer reads.
Current zone observations and travel inputs are included; weekly zone comparisons
load per corridor after paint through `/traffic/dashboard/zone-baselines`.

Those comparisons use one background lane and the shared budget, with a
fifteen-second deadline including queue time. One corridor can finish independently.
Hidden/unloaded pages cancel them. Late live results update current snapshots
without replacing selected historical data. Failure preserves observations and
offers Sync now. Older complete bootstraps can hydrate without additional reads.
The overview leaves its hidden map renderer unloaded until a corridor is selected.

Local classic scripts are bundled in source order once at startup, with content
digests in the URL and ETag. Identity/gzip representations have distinct digests
and `Vary: Accept-Encoding`. Local stylesheets are inlined in their original
order. Standalone fixture HTML retains individual script and stylesheet references.

Identical snapshot sections share one prepared UTF-8/gzip page, bounded to 8 MiB
combined. Every request checks current section data, version, status and refresh
evidence before reuse. Larger pages remain complete but are not retained.
Responses stay `Cache-Control: no-store`. The embedded JSON escapes HTML-sensitive
characters. Demo, historical and replay shells retain their separate loading paths.

Production disables replay explicitly; a URL flag cannot enable it. The guarded
local replay helper uses a read-only connection, disabled Flyway and local-only
execution. Optional readers follow the [sidecar runbook](dashboard-sidecar-operations.md).

Fixtures default to keyless USGS imagery. Configured-basemap review makes one
bounded map-configuration read and keeps the restricted browser key in memory.
Domain restrictions can leave localhost without tiles; do not relax them for a
preview. [Coverage notes](data-history-coverage.md) identify unavailable older
zones/maps and corridor-definition boundaries.
