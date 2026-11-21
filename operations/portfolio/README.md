# Portfolio image publisher

The README embeds three images served at `/readme/current/`: the corridor map,
24-hour traffic journal and 60-day calendar. They share the website's mountain
mark, forest background, Archivo headings and IBM Plex Mono labels. The map and
journal use green for I-25 and rose for I-70; gold identifies historical context.
Compact versions keep the graphics readable on narrow screens.

## What changes, and when

| Asset | Data | Cadence |
| --- | --- | --- |
| Map | Estimated travel minutes and bubble duration | 15 minutes |
| Journal | Original corridor averages and the site's 13-week hourly baseline | 15 minutes |
| Calendar | Minimum observed corridor average per completed Denver day | Daily, after 00:15 America/Denver |
| Background | Reviewed map capture and its coordinate bounds | Manual; only when geometry or presentation needs it |

The publisher reads the existing dashboard API. It makes no TomTom, CDOT or
map-tile requests. The first run backfills 60 days; later runs fetch only missing
completed dates. Local midnight boundaries include 23- and 25-hour days. Missing
values stay missing, and zero observed speed remains a valid daily low.

The calendar uses original `avgCurrentSpeed` observations, before chart
averaging. It does not use `minCurrentSpeed`, which describes a different
measurement. Colors are normalized within each corridor's displayed days. Edge
cells outside the rolling 60-day window are dimmed.

Complete combined-direction half-mile cells determine the map's travel time.
The corridor average is the fallback when full cell coverage is unavailable,
matching `traffic-estimates.js`. A zero-speed cell leaves the estimate unavailable.
One animation second represents one estimated travel minute. The bubbles do not
represent tracked vehicles. Reduced-motion clients receive a static map.

## Install after the reviewed revision is merged

These steps add a static image route and a timer. They do not restart the
application or database. Run them against the checked revision on the VPS.
Inspect existing users, paths and Caddy configuration before applying examples.

1. Create a dedicated system user `ctt-portfolio`, with primary group `caddy`,
   no login shell, and read access to `/opt/colorado-traffic-tracker`. Do not give
   it application secrets or Docker access. Python 3.9 or later and system IANA
   timezone data are required; Ubuntu 24.04 supplies both.
2. Install the service and timer from `deploy/systemd/`. The service's
   `StateDirectory` creates `/var/lib/colorado-traffic-tracker-portfolio`, owned
   by the publisher and readable by Caddy.
3. Start the service once. Verify all six SVGs and `data.json` beneath
   `web/current`. The first backfill has a 128-request hard bound and may take
   longer than subsequent updates. A failure leaves the previous publication
   in place; inspect `journalctl` and retry rather than weakening the bound.
4. Add `Caddyfile.fragment.example` inside the site's existing `route` block,
   before its final reverse proxy. Validate the complete Caddy configuration,
   then reload Caddy.
5. Check `/readme/current/map.svg`, `journal.svg`, `calendar.svg`, their
   `-compact.svg` counterparts and `data.json` over HTTPS. Enable the timer
   only after the first publication is correct.

The timer runs every 15 minutes. The publisher itself determines which Denver
date has completed, so server timezone and DST do not change the daily boundary.
A lock prevents overlapping runs. Provider/API errors, malformed responses and
incomplete pagination fail before replacing the published directory.

## Publication and provenance

Output lives outside Git:

```text
/var/lib/colorado-traffic-tracker-portfolio/
  publisher.lock
  state.json                  # verified daily minima, not application credentials
  web/
    current -> snapshots/<timestamp>/
    snapshots/<timestamp>/
      map.svg                 # also map-compact.svg
      journal.svg             # also journal-compact.svg
      calendar.svg            # also calendar-compact.svg
      data.json
      index.html
```

Every SVG includes its immutable source JSON URL in `<metadata>`. Calendar files
are hard-linked between publications until their daily values change, preserving
both their source link and modification time. The README's adjacent JSON link
is explicitly labeled as the latest data; cached images may be older.

Only the most recent 192 owned, generated snapshot directories are retained
(roughly two days at the normal cadence). Current output, unrelated directories,
symlinks and files without the publisher's schema marker are not pruned. This
does not touch the database, traffic archives, backups or the daily cache.

Caddy serves these public files with `Cache-Control: no-cache` and correct image
types. GitHub proxies embedded images, so generation cadence is not a promise
that an already-open README refreshes. Visible timestamps and source JSON make
the age of a snapshot inspectable.

## Rebuild and review

Run the focused tests without providers or a database:

```bash
python3 -B -m unittest discover -s operations/portfolio -p 'test_*.py' -v
```

For local review, select a disposable output directory:

```bash
python3 -B operations/portfolio/publish.py \
  --base-url https://coloradotraffictracker.net/dashboard-api \
  --output .local/portfolio-preview
```

Use `--rebuild-calendar` after an intentional historical correction. A saved
`data.json` can be rendered offline with `--replay <path>` into a separate review
directory. Do not use replay to replace a live publication with older readings.

## Background maintenance and credits

`assets/corridor-base.webp` is one reviewed capture from About the Data, with
the moving bubbles temporarily hidden. `map-base.json` records its timestamp,
coordinate bounds, corridor geometry and geometry digest. The publisher refuses
to put new-extent travel estimates on the old background. Review and recapture
the viewport if that digest changes. Do not spoof request headers or bulk-fetch
map tiles to work around a denied request.

Map data: © OpenStreetMap contributors, SRTM, GEBCO, SONNY's LiDAR DTM, NASADEM,
ESA WorldCover; Maps © Tracestrack. The capture is reused under Tracestrack's
[CC BY 4.0 terms](https://tracestrack.com/terms-of-service/), with its original
credits visible in the generated map. Fonts reuse the bundled Archivo and IBM
Plex Mono files and their OFL notices under
`operations/visitor-analytics/web/fonts`. The mountain mark comes from the
website header. Keep these credits when exporting the images.

To stop updates, disable the portfolio timer. The last generated images remain
available. To remove the route, remove its Caddy handle and reload Caddy; no
application or database rollback is required.

## Wiki source and publication

`wiki/` is the authoring source for the public GitHub wiki. Its reviewed pages
are copied into the separate wiki Git checkout; they are not maintained as two
independent sets of explanations. GitHub supplies page rendering, while
`_Sidebar.md` and `_Footer.md` supply shared navigation. The graphics reuse
`docs/assets/` from the merged application repository.

Fetch the wiki first and preserve any existing changes. Use the helper against
its clean checkout, review the complete diff, and commit a topic:

```bash
python3 -B operations/portfolio/sync_wiki.py /path/to/ColoradoTrafficTracker.wiki
python3 -B operations/portfolio/sync_wiki.py /path/to/ColoradoTrafficTracker.wiki --check
```

The helper copies only the named Markdown sources. It preserves existing image
assets, creates no commits, and never pushes. Publish the reviewed wiki commit
to its default branch only after the main-repository artwork and image route
are available. Recheck the wiki's current default-branch revision before that
push; do not force over intervening edits.
