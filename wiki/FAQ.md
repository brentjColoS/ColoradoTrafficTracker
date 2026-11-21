![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

This page explains the numbers and visual cues used in the dashboard and README.
The [About the Data page](https://coloradotraffictracker.net/dashboard/data.html)
shows the sources and monitored geometry alongside those explanations.

## What does a speed represent?

TomTom traffic-flow observations are combined into corridor and local summaries.
The corridor average is an aggregate of those readings. It is not a measured
end-to-end trip, and the combined-direction view does not establish independent
measurements in each carriageway.

The selected tile source supplies observed speeds and road geometry. It does
not populate the stored free-flow-speed or confidence fields. Their presence
in an API shape is not evidence that those measurements are available.

## How should I read the calendar?

<picture>
  <source media="(max-width: 600px)" srcset="https://coloradotraffictracker.net/readme/current/calendar-compact.svg">
  <img src="https://coloradotraffictracker.net/readme/current/calendar.svg" alt="The past two months of lowest observed corridor-average speeds, with a relative rose-to-gold-to-green gradient for each corridor." width="960">
</picture>

Each cell is the lowest valid `avgCurrentSpeed` observation for one completed
America/Denver date. For example, it describes the lowest **corridor average**
recorded that day, not the slowest individual road segment and not the minimum
of an hourly average.

Rose marks lower daily minima and green marks higher ones within that
corridor's displayed 60 days. The mph range is printed below each grid. Colors
are relative: the same shade on I-25 and I-70 need not mean the same speed.
Empty cells preserve gaps or padding outside the selected dates. A collection
gap can also mean the day's actual lowest speed was never observed.

The calendar rolls forward once a day after Denver midnight. The map and
journal are regenerated every 15 minutes; GitHub's image cache can delay what
an open README displays.

## How are travel times and the map bubbles calculated?

When complete combined-direction half-mile cells cover a corridor, the site
adds each piece's distance divided by its observed speed and converts the total
to minutes. The corridor average is the fallback if full cell coverage is
unavailable. A zero-speed cell leaves an end-to-end estimate unavailable.

The map turns each estimated travel minute into one animation second. Its
bubbles are illustrations, not tracked vehicle locations. The map background
provides geographic context and is refreshed only when it needs maintenance.

## What does the historical band show?

The baseline uses the preceding 13 completed weeks and matches the Denver
weekday and hour. Profiles expose their source, counts and fallbacks where an
exact weekday/hour has insufficient observations. The band shows variation in
the reference history; it is not a forecast or a travel-time guarantee.

## How far back can I compare?

Coverage differs by dataset. Scalar corridor samples, detailed speed zones,
durable incident events and local map cells did not all start together. Current
flow cells are replaced in place; their historical record is hourly.

I-70 expanded from MM 206–259 to MM 206–274. Earlier corridor averages still
describe the shorter mountain stretch and were not rewritten. The
[coverage reference](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/data-history-coverage.md)
records these boundaries and the treatment of optional sign history.

[← Architecture](Architecture) · [Testing and verification →](Testing-Strategy)
