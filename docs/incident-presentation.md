# Experimental incident labels and icons

The experimental dashboard uses the existing incident API fields to choose one
of 19 display types. This presentation does not change provider categories,
ingestion, stored history, or incident lifecycle status.

The set covers crashes, construction, closures, disabled vehicles, sun glare,
snow, ice, debris/rockfall, fog/smoke, wind, flooding, avalanches, fire,
traffic queues, animals, maintenance, general weather, road hazards, and other
incidents. Unknown reports retain their
provider label with the generic icon.

Specific provider types take priority over general categories. For broad reports
such as Weather or Road closed, a recognized cause in the existing note or
description can refine the icon and label. For example, Road closed with a sun
glare note displays **Sun glare · Road closed**. A crash mentioning snow remains
a crash; snow removal remains maintenance. Negated, cleared, and precautionary
sentences are excluded from note-based inference. This is a bounded phrase
matcher, so unrecognized wording retains the available provider label rather
than guessing a cause. Lane impacts and the original note remain in incident
details. Labels are inserted as text, never provider-supplied HTML.

CDOT **Safety Closure** reports can also display as **Sun glare · Safety Closure**
when they match the Floyd Hill pattern: I-70 eastbound, mile markers 244–248,
November–February, and 6:30–8:30 a.m. in `America/Denver`. The source start and
either its source end or latest observation must fit within the same morning
window. Missing times, direction or location do not qualify. Reported causes
such as crashes, snow, construction or police activity retain priority; an event
extending beyond the window stays a safety closure. Denver timezone conversion
handles daylight-saving changes independently of the browser timezone.

The timing window follows
[CDOT's Floyd Hill guidance](https://www.codot.gov/travel/sunglare). There is one
dated exception for the
[announced October 21, 2026 preparatory hold](https://www.codot.gov/news/2026/october-2026-news/sun-glare-detours-i70-floydhill),
which the stored eastbound mile-244 event matches at 7:16–8:12 a.m. Mountain time.
The details and map popup disclose that the cause is inferred from location and
timing; CDOT's original safety-closure description and lifecycle remain intact.
This changes display classification only, uses already-loaded incident fields,
and makes no provider requests or changes to stored reports.

All nineteen icons come from Lucide, with the exact icon mapping and pinned
source revision recorded in `incident-types.js` and `THIRD_PARTY_NOTICES.md`.
Flooding uses Waves Arrow Up, without a building. Debris and rockfall share the
Stone icon and one legend entry while individual reports keep their specific
provider labels. Rain and traction/chain law have no dedicated icon or legend
entry; existing provider reports retain their text and use a generic weather or
other classification. These display choices never discard a provider report.

CDOT's `Traction Law Code 15` displays **Passenger vehicles: winter equipment
required**, and `Chain Law Code 18` displays **Commercial vehicles: chains
required**. Their `Lifted` variants explicitly say the restriction was lifted.
The table's incident details and map popup explain the requirements and retain
the code; provider notes and lifecycle status remain unchanged. Unknown codes
retain their provider labels. No additional requests or new legend icons are
needed.

The Code 15 explanation follows the recorded October 26, 2026 CDOT reports:
AWD/4WD vehicles need qualifying winter, mud-and-snow or all-weather tires with
at least 3/16-inch tread; 2WD vehicles need chains or approved traction devices.
Code 18 requires commercial vehicles to use chains or approved alternatives.
These numeric codes are legacy feed terminology; use the current
[CDOT traction guidance](https://www.codot.gov/travel/winter-driving/tractionlaw)
and [commercial vehicle guidance](https://csp.colorado.gov/chain-law-information)
when reviewing changes to requirements. A lifted event describes the reported
restriction ending, not an exemption from seasonal equipment requirements.

Incident tables and chart markers share the same vector paths. Chart callouts
and map popups retain specific labels rather than reducing them to a broad
category. Map dots still identify CDOT reports; a dot is not a separate source
of incident classification. Grouped chart markers continue to show event counts.
When a later revision changes a report's type, its table/chart icon and label
update together.

The legend places recently observed incident types first, left to right and then
onto the next row. It ranks each type by the newest last-seen timestamp in the
selected corridor's incident window, using first-seen time for missing last-seen
times and to break ties. Both Corridors combines the two corridors. Each type
appears once; unused types follow in a stable catalog order. General weather
appears when present in the reports and otherwise stays out of the legend.

The first eight types stay visible; **More types** reveals the rest in the same
aligned grid. Refreshes, timeframe changes, and corridor switches update the
order while preserving the expanded/collapsed choice. With no reports, the
legend keeps its default order. Reordering uses the incident data already loaded
for the tables and makes no additional requests. The grid wraps within the
panel in both themes.

Legacy snapshot replay also retains weather icon categories 2, 3, 4, 5, 10, and
11. Congestion fragments and provider clusters remain excluded from discrete
legacy incident counts.

Run `node --test scripts/tests/dashboard.test.cjs` for the dashboard suite.
The provider-free `incident-types` preview scenario exercises sun glare,
snow, ice, rockfall, debris, wind, maintenance, and flooding:

```bash
DASHBOARD_FIXTURE_PORT=8095 node scripts/tests/dashboard-preview.cjs
# Open http://127.0.0.1:8095/dashboard/?fixture=incident-types&corridor=I70
# Use fixture=chain-laws to review Code 15/18 and their lifted states.
```

The integration destination is `experiment/dashboard-reconstruction`.
Merge and sidecar release require their own authorization; production promotion
remains a separate decision.

## Long-term reports and upcoming work

The experimental dashboard distinguishes **Active** spot incidents from **Active ·
Long-term** reports spanning at least 48 hours, across all incident types. The span comes
from durable first/last observations, or a valid provider start/end period that
has already begun. Observed history takes precedence, so recurring overnight
work can show its multi-day history while retaining the current work period in
the full provider details. The badge describes a long-term report; it does not
claim that a lane restriction applies continuously.

Active spot incidents appear before active long-term reports, even when an
ongoing project was refreshed more recently. Each group retains newest-last-seen
ordering. Long-term reports stay active and counted; planned, continuing-later
and cleared records remain below all active reports. This uses already-loaded
timestamps and the same 48-hour classification as the badge, without extra reads.

Recurring long-term work with a valid future provider start shows **Continuing
at 7:00 PM**, or **Continuing Oct 21 at 7:00 PM** when the start is on another
local calendar day. The badge uses the dashboard's display timezone; its tooltip
includes the full date, timezone, and an explicit "Not active now" explanation.
This requires both a multi-day span and explicit recurrence/resumption wording
in the report. A source description cannot supply or invent the next timestamp;
only `sourceStartedAt` can do that. An ordinary one-off planned job remains
**Planned**, and cleared/cancelled reports cannot become continuations.

Missing, reversed, or invalid timestamps do not establish a long-term span, and
wall-clock age alone does not extend an old report. Upcoming work is excluded
from current active counts even if the provider's project record remains
active. Continuing-later reports are counted separately. Stored provider flags
and history are unchanged. Map popups use the same distinction as the table.
Badges sit beneath the incident name so they remain visible when the timestamp
columns require horizontal scrolling on a phone.

Preview synthetic examples with `?fixture=incident-continuing&corridor=I70`.
Fixture traffic is synthetic. Publishing requires the normal experimental
review, merge, and sidecar verification workflow.
