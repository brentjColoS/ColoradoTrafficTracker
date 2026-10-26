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

All nineteen icons come from Lucide, with the exact icon mapping and pinned
source revision recorded in `incident-types.js` and `THIRD_PARTY_NOTICES.md`.
Flooding uses Waves Arrow Up, without a building. Debris and rockfall share the
Stone icon and one legend entry while individual reports keep their specific
provider labels. Rain and traction/chain law have no dedicated icon or legend
entry; existing provider reports retain their text and use a generic weather or
other classification. These display choices never discard a provider report.

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
