![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

The dashboard combines observed speeds, reported roadway events and calculated
comparisons. The [About the Data page](https://coloradotraffictracker.net/dashboard/data.html)
provides a visual overview of the sources and monitored routes.

## What does a speed represent?

Corridor averages summarize TomTom traffic-flow readings along each monitored
route. Local map cells cover smaller road sections, but their spacing does not
establish independent measurements at every half mile or in each carriageway.

The selected flow-tile source provides observed speeds and road geometry.
Free-flow speed and confidence remain unavailable, even when those fields appear
in an API response.

## How are travel times and the map bubbles calculated?

Travel times are calculated estimates, not recorded trips. With complete
combined-direction coverage, the site adds each half-mile cell's distance
divided by its speed and converts the total to minutes. The corridor average
is the fallback when coverage is incomplete. A zero-speed cell leaves the
estimate unavailable.

Each estimated travel minute becomes one animation second on the map. The
bubbles illustrate that estimate rather than vehicle positions. The geographic
background is refreshed manually.

## What does the historical band show?

The baseline matches Denver weekday and hour using the preceding 13 completed
weeks. Profiles identify their source, sample counts and any fallback used when
an exact match lacks enough history. The shaded band uses two standard
deviations around the reference mean to show historical variation. It is not
a forecast or travel-time guarantee.

## How should I read the calendar?

<picture>
  <source media="(max-width: 600px)" srcset="https://coloradotraffictracker.net/readme/current/calendar-compact.svg">
  <img src="https://coloradotraffictracker.net/readme/current/calendar.svg" alt="The past two months of lowest observed corridor-average speeds, with a relative rose-to-gold-to-green gradient for each corridor." width="960">
</picture>

Each cell shows the minimum valid `avgCurrentSpeed` for one completed
America/Denver day. It is calculated from original **corridor averages** before
hourly summarization, not from segment minima.

Colors compare the 60 displayed daily lows within each corridor, from rose
through gold to green. Each grid shows its mph range; equal colors on different
corridors need not mean equal speeds. Each square shows its day of the month.
Gray cells mark missing observations; padding outside the selected dates is
unnumbered. Gaps can also mean the day's lowest speed went unobserved.

The calendar updates daily after Denver midnight. Map estimates and the journal
update every 15 minutes. GitHub may cache older images, so timestamps identify
the displayed snapshot. The
[latest snapshot data (JSON)](https://coloradotraffictracker.net/readme/current/data.json)
includes daily values and observation counts.

## How far back can I compare?

Corridor samples, speed zones, incident events and map cells have different
start dates. Current flow cells are replaced in place; historical map cells
are hourly.

I-70 expanded from MM 206–259 to MM 206–274. Earlier averages still describe the
shorter route and have not been rewritten. The
[coverage notes](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/data-history-coverage.md)
record these boundaries and optional sign-history coverage.

[Historical storage](Historical-Storage) explains how identities and provenance
survive retention. [Dashboard reads](Dashboard-Reads) covers the aggregation,
pagination and incident reconstruction behind these comparisons.

[← Architecture](Architecture) · [Testing and verification →](Testing-Strategy)
