# <img src="docs/assets/ctt-mark.svg" width="62" alt=""> Colorado Traffic Tracker

Traffic on Colorado's I-25 and I-70, with the history a live map leaves behind.

[Open the dashboard](https://coloradotraffictracker.net/dashboard/) · [Why I built it](https://coloradotraffictracker.net/dashboard/why.html) · [How it works](https://coloradotraffictracker.net/dashboard/system.html) · [About the data](https://coloradotraffictracker.net/dashboard/data.html) · [Wiki](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki)

I snowboard at Keystone and live in Fort Collins. After enough long drives
home, I wanted to know whether leaving an hour earlier usually made a
difference. I started saving traffic readings so I could go back and compare.

I built and maintain the collection services, database, API, dashboard and
deployment. The site collects observations throughout the day, including when
nobody has the dashboard open.

## The roads behind the question

The tracker follows I-25 between Fort Collins and Denver, and I-70 between
Silverthorne and Denver. The map marks the monitored portions of that drive,
using their actual road geometry. The glowing bubbles illustrate estimated
travel time along each path.

<a href="https://coloradotraffictracker.net/dashboard/data.html#dataHeroMap">
  <picture>
    <source media="(max-width: 600px)" srcset="https://coloradotraffictracker.net/readme/current/map-compact.svg">
    <img src="https://coloradotraffictracker.net/readme/current/map.svg" alt="Tracked I-25 and I-70 corridors, with glowing bubbles paced at one second per estimated travel minute." width="960">
  </picture>
</a>

## Collecting within the budget

Running the site made provider limits part of the design. TomTom supplies
traffic flow; CDOT supplies incidents and planned events on a separate
schedule. A failure in one source can leave the other collecting useful data.

I added persistent request accounting for each TomTom account and reserve
complete tile batches before sending them. Collection uses the primary account
first and rolls to the secondary when another full batch will not fit. This
keeps the request budget tied to what the application actually sends.

The API serves stored observations to the dashboard. Opening a chart or moving
through history does not start another provider poll. The
[architecture walkthrough](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Architecture)
follows that boundary from collection to the browser.

## A day on the road

The journal shows the latest 24 hours of corridor-average speeds beside a
baseline drawn from the preceding 13 completed weeks. It matches the Denver
weekday and hour. The shaded band shows variation in that reference history.

<a href="https://coloradotraffictracker.net/dashboard/">
  <picture>
    <source media="(max-width: 600px)" srcset="https://coloradotraffictracker.net/readme/current/journal-compact.svg">
    <img src="https://coloradotraffictracker.net/readme/current/journal.svg" alt="The latest 24 hours of I-25 and I-70 observed corridor speeds, historical baselines and two-standard-deviation reference bands." width="960">
  </picture>
</a>

The map estimates and journal refresh every 15 minutes. Their timestamps show
the snapshot being displayed. [Latest source JSON](https://coloradotraffictracker.net/readme/current/data.json).

## Preserving the history

The observations are the part I want to keep. Retention moves older samples
into archive tables while the same history APIs continue to read them.
Speed-zone and incident histories have their own coverage boundaries, which
are recorded in the [coverage notes](docs/data-history-coverage.md).

That history also changes what I need to verify. The checks cover provider
failures, archived reads, packaged API behavior and browser interactions.
Monitoring looks at successful observations: unchanged speeds can still be
fresh readings. [Testing and verification](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Testing-Strategy)
explains the checks and where their limits are.

The calendar keeps the latest 60 completed Denver days and updates daily.
Each cell is the lowest observed **corridor-average** speed that day. Its
rose-to-gold-to-green gradient compares days within that corridor. Missing
observations stay blank. I-70's monitored extent expanded during this archive,
so its older averages describe a shorter stretch of road.

<a href="https://coloradotraffictracker.net/dashboard/data.html">
  <picture>
    <source media="(max-width: 600px)" srcset="https://coloradotraffictracker.net/readme/current/calendar-compact.svg">
    <img src="https://coloradotraffictracker.net/readme/current/calendar.svg" alt="Two months of daily minimum observed corridor-average speeds for I-25 and I-70, with continuous relative color gradients and explicit gaps." width="960">
  </picture>
</a>

Java 21 · Spring Boot · PostgreSQL / TimescaleDB · JavaScript · Docker · Caddy

[Project story](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Project-Journey) · [API explorer](https://coloradotraffictracker.net/dashboard/api.html) · [CI results](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml)

Code is available under the [MIT license](LICENSE). Traffic data and map assets
retain their source terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
