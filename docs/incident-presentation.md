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

The legend shows eight common types by default and adds ten through
**More types**. General weather retains its icon in reports but is
omitted from the legend alongside its more specific weather entries.
The expanded items continue in the same aligned grid, without separate tiers.
It wraps within the panel at narrow widths and uses the existing light/dark
theme colors plus a readable blue for weather.

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
