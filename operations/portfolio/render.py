"""CTT artwork shared by the README snapshots and wiki diagrams."""

import base64
import datetime as dt
import html
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("America/Denver")
ROOT = Path(__file__).resolve().parents[2]
FOREST, PANEL, LINE = "#071b12", "#111f17", "#31583e"
INK, MUTED, GREEN, ROSE, GOLD = "#fffded", "#b6c8b9", "#4fbe7d", "#df7680", "#d5a021"
FONT_DIR = ROOT / "operations/visitor-analytics/web/fonts"
MARK = '<path d="M4 34 22 9l10 13L43 5l22 29Z" fill="#fffded"/><path d="m16 27 6-9 5 7 5-3 5 7 6-13 12 18H10Z" fill="#d5a021"/><path d="M10 42c13-8 28-9 47-4-14 0-24 3-31 8 8-1 17 0 26 4-18 1-32-1-42-8Z" fill="#fffded"/>'


def escape(value):
    return html.escape(str(value), quote=True)


def text(x, y, value, size=16, color=INK, mono=False, anchor="start", weight=400):
    family = "IBM Plex Mono,monospace" if mono else "Archivo,Arial,sans-serif"
    return f'<text x="{x:g}" y="{y:g}" fill="{color}" font-family="{family}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{escape(value)}</text>'


def font_css():
    parts = []
    for family, file in [
        ("Archivo", "archivo-latin.woff2"),
        ("IBM Plex Mono", "ibm-plex-mono-latin.woff2"),
    ]:
        encoded = base64.b64encode((FONT_DIR / file).read_bytes()).decode()
        parts.append(
            f"@font-face{{font-family:'{family}';src:url(data:font/woff2;base64,{encoded}) format('woff2');font-weight:100 900;}}"
        )
    return "".join(parts)


def shell(width, height, title, description, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">'
        f'<title id="title">{escape(title)}</title><desc id="desc">{escape(description)}</desc>'
        f"<style>{font_css()} .route-pulse{{offset-rotate:0deg;}} @media(prefers-reduced-motion:reduce){{.motion{{display:none;}}}}</style>"
        f'<rect x=".5" y=".5" width="{width-1}" height="{height-1}" rx="12" fill="{FOREST}" stroke="{LINE}"/>'
        f'<path d="M12 36V12H36 M{width-36} {height-12}H{width-12}V{height-36}" fill="none" stroke="{GOLD}" opacity=".65"/>{body}</svg>'
    )


def heading(width, kicker, title, compact=False):
    return (
        f'<g transform="translate(22 17) scale(.5)">{MARK}</g>'
        + text(73, 35, kicker.upper(), 14, MUTED, True)
        + text(22, 78, title, 23 if compact else 27, weight=600)
        + f'<path d="M22 96H{width-22}" stroke="{LINE}"/>'
    )


def stamp(value):
    if isinstance(value, str):
        value = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.astimezone(ZONE).strftime("%b %-d, %-I:%M %p %Z")


def footer(width, y, label, compact=False):
    return text(22, y, label, 15 if compact else 13, MUTED, True)


def mercator(point):
    lon, lat = point[:2]
    return math.radians(lon), -math.asinh(math.tan(math.radians(lat)))


def projection(features, width, height, padding):
    points = [mercator(p) for f in features for p in f["geometry"]["coordinates"]]
    xs, ys = zip(*points)
    scale = min(
        (width - 2 * padding) / (max(xs) - min(xs)),
        (height - 2 * padding) / (max(ys) - min(ys)),
    )
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return lambda point: (
        width / 2 + (mercator(point)[0] - cx) * scale,
        height / 2 + (mercator(point)[1] - cy) * scale,
    )


def route_path(points, y_offset=0):
    return " ".join(
        f'{"M" if i == 0 else "L"}{x:.2f},{y+y_offset:.2f}'
        for i, (x, y) in enumerate(points)
    )


def map_svg(data, base, compact=False):
    width, plot_height = (400, 270) if compact else (960, 300)
    height = 565 if compact else 535
    features = base["corridors"]["features"]
    project = projection(features, width - 2, plot_height, 24 if compact else 30)
    nw, se = [project(p) for p in base["bounds"]]
    image = base64.b64encode(
        (Path(__file__).parent / "assets/corridor-base.webp").read_bytes()
    ).decode()
    body = heading(width, "The two roads", "Fort Collins to the mountains", compact)
    body += f'<defs><clipPath id="map-clip"><rect x="1" y="105" width="{width-2}" height="{plot_height}"/></clipPath><filter id="green-glow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="5"/></filter></defs>'
    body += f'<g clip-path="url(#map-clip)"><image x="{nw[0]+1:.3f}" y="{nw[1]+105:.3f}" width="{se[0]-nw[0]:.3f}" height="{se[1]-nw[1]:.3f}" href="data:image/webp;base64,{image}"/>'
    for feature in features:
        corridor = feature["properties"]["corridor"]
        points = [
            (x + 1, y) for x, y in map(project, feature["geometry"]["coordinates"])
        ]
        path = route_path(points, 105)
        return_path = (
            path + " " + " ".join(f"L{x:.2f},{y+105:.2f}" for x, y in reversed(points))
        )
        pace = data["paces"][corridor]["minutes"]
        color = GREEN if corridor == "I25" else ROSE
        if pace is not None:
            for radius, fill, extra in [
                (8, color, 'filter="url(#green-glow)"'),
                (4.5, INK, f'stroke="{color}" stroke-width="2"'),
            ]:
                body += f'<circle class="motion" r="{radius}" fill="{fill}" {extra}><animateMotion dur="{pace*2}s" repeatCount="indefinite" path="{return_path}" calcMode="paced"/></circle>'
    body += "</g>"
    y = plot_height + 133
    for i, corridor in enumerate(["I25", "I70"]):
        x = 22 + i * (180 if compact else 245)
        color = GREEN if i == 0 else ROSE
        minutes = data["paces"][corridor]["minutes"]
        retained = data["paces"][corridor].get("retained", False)
        value = (
            "unavailable"
            if minutes is None
            else f"{minutes} min" + (" retained" if retained else "")
        )
        body += f'<path d="M{x} {y-5}h18" stroke="{color}" stroke-width="4" stroke-linecap="round"/>'
        body += text(
            x + 26,
            y,
            f"{corridor[:1]}-{corridor[1:]} · {value}",
            15 if compact else 16,
            mono=True,
        )
    body += footer(
        width,
        y + 30,
        (
            "Pulse · 1s / estimated travel min"
            if compact
            else "Pulse · 1s per estimated travel minute"
        ),
        compact,
    )
    body += footer(width, y + 55, "Snapshot " + stamp(data["generatedAt"]), compact)
    if compact:
        body += text(
            22, height - 58, "Map © Tracestrack · OpenStreetMap contributors", 14, MUTED
        )
        body += text(
            22, height - 37, "Data: SRTM · GEBCO · SONNY’s LiDAR DTM", 14, MUTED
        )
        body += text(22, height - 16, "NASADEM · ESA WorldCover", 14, MUTED)
    else:
        body += text(
            22, height - 30, "Map © Tracestrack · OpenStreetMap contributors", 13, MUTED
        )
        body += text(
            22,
            height - 12,
            "SRTM · GEBCO · SONNY’s LiDAR DTM · NASADEM · ESA WorldCover",
            12,
            MUTED,
        )
    return shell(
        width,
        height,
        "Colorado Traffic Tracker corridor map",
        "Tracked I-25 and I-70 paths. Bubbles illustrate estimated travel time, not vehicle positions. Background captured "
        + base["capturedAt"],
        body,
    )


def baseline_at(profiles, value):
    local = value.astimezone(ZONE)
    return next(
        (
            p
            for p in profiles
            if p["dayOfWeek"] == local.isoweekday() and p["hourOfDay"] == local.hour
        ),
        None,
    )


def journal_svg(data, compact=False):
    width, height = (400, 630) if compact else (960, 630)
    body = heading(width, "The traffic journal", "A day on the road", compact)
    end = dt.datetime.fromisoformat(data["asOf"].replace("Z", "+00:00"))
    start = end - dt.timedelta(days=1)
    body += text(
        22, 124, "Observed speeds and a 13-week baseline", 14 if compact else 16, MUTED
    )
    for i, corridor in enumerate(["I25", "I70"]):
        top, plot_height = 165 + i * 192, 132
        left, right = (47, width - 20)
        samples = data["history"][corridor]
        rows = []
        for s in samples:
            when = dt.datetime.fromisoformat(s["polledAt"].replace("Z", "+00:00"))
            profile = baseline_at(data["baselines"][corridor], when)
            rows.append((when, s["avgCurrentSpeed"], profile))
        values = [v for _, v, _ in rows if v is not None]
        for _, _, p in rows:
            if (
                p
                and p.get("meanSpeed") is not None
                and p.get("standardDeviation") is not None
            ):
                values += [
                    max(0, p["meanSpeed"] - 2 * p["standardDeviation"]),
                    p["meanSpeed"] + 2 * p["standardDeviation"],
                ]
        low = max(0, math.floor((min(values) - 2) / 5) * 5)
        high = max(low + 10, math.ceil((max(values) + 2) / 5) * 5)
        x = lambda t: left + (right - left) * (t - start).total_seconds() / 86400
        y = lambda v: top + plot_height - (v - low) / (high - low) * plot_height
        color = GREEN if i == 0 else ROSE
        body += text(22, top - 14, "I-25" if i == 0 else "I-70", 18, color, True)
        last = next(
            (when for when, value, _ in reversed(rows) if value is not None), None
        )
        if last:
            label = last.astimezone(ZONE).strftime("%-I:%M %p")
            if last.astimezone(ZONE).date() != end.astimezone(ZONE).date():
                label = last.astimezone(ZONE).strftime("%b %-d ") + label
            body += text(
                right,
                top - 14,
                "Last observed " + label + " · mph",
                12 if compact else 14,
                MUTED,
                True,
                "end",
            )
        for tick in [low, (low + high) / 2, high]:
            body += f'<path d="M{left} {y(tick):.2f}H{right}" stroke="{LINE}"/>'
            body += text(left - 8, y(tick) + 5, f"{tick:g}", 14, MUTED, True, "end")
        observed, baseline, upper, lower = [], [], [], []
        groups, previous, previous_baseline = [], None, False

        def flush_band():
            if len(upper) > 1:
                groups.append(" ".join(upper + list(reversed(lower))) + " Z")
            upper.clear()
            lower.clear()

        for when, value, p in rows:
            gap = previous is None or (when - previous).total_seconds() > 5400
            if gap:
                flush_band()
            if value is not None:
                observed.append(f'{"M" if gap else "L"}{x(when):.2f},{y(value):.2f}')
            else:
                gap = True
            if (
                p
                and p.get("meanSpeed") is not None
                and p.get("standardDeviation") is not None
            ):
                mean, std = p["meanSpeed"], p["standardDeviation"]
                baseline.append(
                    f'{"M" if gap or not previous_baseline else "L"}{x(when):.2f},{y(mean):.2f}'
                )
                upper.append(
                    f'{"M" if not upper else "L"}{x(when):.2f},{y(mean+2*std):.2f}'
                )
                lower.append(f"L{x(when):.2f},{y(max(0,mean-2*std)):.2f}")
                previous_baseline = True
            else:
                flush_band()
                previous_baseline = False
            previous = when if value is not None else None
        flush_band()
        for band in groups:
            body += f'<path d="{band}" fill="{GOLD}" opacity=".10"/>'
        body += f'<path d="{" ".join(baseline)}" fill="none" stroke="{GOLD}" stroke-width="1.6" stroke-dasharray="5 5"/>'
        body += f'<path d="{" ".join(observed)}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round"/>'
        when = start.replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1)
        while when < end:
            if when.astimezone(ZONE).hour % 6 == 0 and left + 24 < x(when) < right - 24:
                body += text(
                    x(when),
                    top + plot_height + 25,
                    when.astimezone(ZONE).strftime("%-I %p"),
                    14,
                    MUTED,
                    True,
                    "middle",
                )
            when += dt.timedelta(hours=1)
    legend = "Gold: baseline · shaded: ±2σ reference band"
    if not any(data["baselines"].values()):
        legend = "Historical baseline unavailable in this snapshot"
    body += text(22, 560, legend, 13 if compact else 15, MUTED)
    body += footer(width, height - 38, "Through " + stamp(end), compact)
    body += footer(
        width,
        height - 15,
        (
            "Stored observations · both directions"
            if compact
            else "Stored observations · combined directions"
        ),
        compact,
    )
    return shell(
        width,
        height,
        "I-25 and I-70 traffic journal",
        "Observed corridor-average speeds over the preceding 24 hours and the site's 13-week hourly baseline. Missing observations remain gaps.",
        body,
    )


def heat_color(fraction):
    stops = [(217, 149, 158), (224, 173, 53), (131, 201, 154)]
    a, b, t = (
        (stops[0], stops[1], fraction * 2)
        if fraction <= 0.5
        else (stops[1], stops[2], (fraction - 0.5) * 2)
    )
    return "#" + "".join(f"{round(x+(y-x)*t):02x}" for x, y in zip(a, b))


def calendar_svg(daily, compact=False):
    width, height = (400, 740) if compact else (960, 460)
    dates = sorted(daily["I25"])
    body = heading(
        width, "The traffic archive", "The slowest part of each day", compact
    )
    body += text(
        22,
        122,
        f'{dt.date.fromisoformat(dates[0]).strftime("%b %-d")}–{dt.date.fromisoformat(dates[-1]).strftime("%b %-d")} · 60 completed days',
        14 if compact else 16,
        MUTED,
    )
    first, last = map(dt.date.fromisoformat, [dates[0], dates[-1]])
    grid_start = first - dt.timedelta(days=first.weekday())
    weeks = ((last - grid_start).days + 7) // 7
    panel_width = width if compact else width / 2
    for i, corridor in enumerate(["I25", "I70"]):
        px = 0 if compact else i * panel_width
        py = 158 + i * 270 if compact else 158
        cell = min(22, (panel_width - 70 - (weeks - 1) * 4) / weeks)
        gap = 4
        gx = px + (panel_width - (weeks * cell + (weeks - 1) * gap)) / 2
        gy = py + 28
        body += text(
            px + 22,
            py,
            "I-25 · Front Range" if i == 0 else "I-70 · Mountains / Denver",
            17,
            GREEN if i == 0 else ROSE,
            True,
        )
        values = [
            v["minimumMph"]
            for v in daily[corridor].values()
            if v["minimumMph"] is not None
        ]
        low, high = (min(values), max(values)) if values else (0, 0)
        month = None
        for week in range(weeks):
            d = grid_start + dt.timedelta(weeks=week)
            if month != d.month:
                body += text(
                    gx + week * (cell + gap),
                    gy - 8,
                    d.strftime("%b"),
                    12 if not compact else 15,
                    MUTED,
                    True,
                )
                month = d.month
            for weekday in range(7):
                day = d + dt.timedelta(days=weekday)
                record = daily[corridor].get(day.isoformat())
                value = record.get("minimumMph") if record else None
                fill = (
                    heat_color((value - low) / (high - low) if high != low else 0.5)
                    if value is not None
                    else "#233129"
                )
                title = (
                    f"{day.isoformat()}: {value:.2f} mph daily minimum of observed corridor averages"
                    if value is not None
                    else f"{day.isoformat()}: no recorded value in this window"
                )
                body += f'<rect x="{gx+week*(cell+gap):.2f}" y="{gy+weekday*(cell+gap):.2f}" width="{cell:.2f}" height="{cell:.2f}" rx="2" fill="{fill}" opacity="{1 if record else .3}"><title>{escape(title)}</title></rect>'
                if first <= day <= last:
                    body += '<g pointer-events="none" aria-hidden="true">' + text(
                        gx + week * (cell + gap) + cell / 2,
                        gy + weekday * (cell + gap) + cell * 0.72,
                        day.day,
                        13 if compact else 12,
                        FOREST if value is not None else MUTED,
                        True,
                        "middle",
                        600,
                    ) + "</g>"
        for weekday, label in enumerate(("M", "T", "W", "TH", "F", "S", "SN")):
            body += text(
                gx - 10,
                gy + weekday * (cell + gap) + cell * 0.8,
                label,
                12 if not compact else 15,
                MUTED,
                True,
                "end",
            )
        legend_y = gy + 7 * (cell + gap) + 17
        label = (
            f"{low:.1f}–{high:.1f} mph · relative to this corridor"
            if values
            else "No valid observations in this period"
        )
        body += text(px + 22, legend_y, label, 12 if not compact else 14, MUTED, True)
    body += footer(
        width,
        height - 39,
        (
            "Lowest observed daily averages"
            if compact
            else "Minimum of original corridor averages"
        ),
        compact,
    )
    body += footer(
        width,
        height - 15,
        (
            "Denver days · gaps stay gray"
            if compact
            else "Denver days · daily refresh · gaps stay gray"
        ),
        compact,
    )
    return shell(
        width,
        height,
        "Daily minimum speeds over the past two months",
        "Each numbered square represents a completed America/Denver date. Rose, gold and green compare each corridor's original daily minima within the displayed period. Missing observations stay gray; padding outside the period is unnumbered. Colors are relative, not severity grades.",
        body,
    )


def technology_logo(name, label, x, y, accent, brand_color=None, compact=False):
    root = ET.parse(ROOT / "docs/assets/tool-logos" / f"{name}.svg").getroot()
    if "viewBox" not in root.attrib:
        root.set("viewBox", f"0 0 {root.get('width')} {root.get('height')}")
    size, radius = (24, 16) if compact else (30, 21)
    root.attrib.update(x=str(x - size / 2), y=str(y - size / 2),
                       width=str(size), height=str(size))
    if brand_color:
        root.set("fill", f"#{brand_color}")
    ids = {node.get("id"): f"tech-{name}-{node.get('id')}"
           for node in root.iter() if node.get("id")}
    for node in root.iter():
        if node.get("id"):
            node.set("id", ids[node.get("id")])
        for key, value in list(node.attrib.items()):
            for original, unique in ids.items():
                value = value.replace(f"url(#{original})", f"url(#{unique})")
                if value == f"#{original}":
                    value = f"#{unique}"
            node.set(key, value)
    return (
        f'<g aria-label="{escape(label)} logo"><title>{escape(label)}</title>'
        f'<circle cx="{x}" cy="{y}" r="{radius}" fill="#f3f2e7" stroke="{accent}" stroke-width="1.2"/>'
        + ET.tostring(root, encoding="unicode")
        + "</g>"
    )


def technology_svg(compact=False):
    width, height = (400, 640) if compact else (960, 454)
    body = heading(width, "Built with", "Tools behind the tracker", compact)
    sources = json.loads((ROOT / "docs/assets/tool-logos/sources.json").read_text())
    brand_colors = {source["name"]: source.get("color")
                    for source in sources["additionalSources"]}
    groups = [
        ("BACKEND", "Java 21", "Spring Boot", GREEN,
         '<path d="m7 5-5 5 5 5m6-10 5 5-5 5m-2-14-2 18"/>',
         [("java", "Java 21"), ("springboot", "Spring Boot")]),
        ("STORAGE", "PostgreSQL", "TimescaleDB · Flyway", GOLD,
         '<ellipse cx="10" cy="4" rx="8" ry="3"/><path d="M2 4v12c0 4 16 4 16 0V4M2 10c0 4 16 4 16 0"/>',
         [("postgresql", "PostgreSQL"), ("timescale", "TimescaleDB"), ("flyway", "Flyway")]),
        ("DASHBOARD", "JavaScript", "Canvas · MapLibre GL JS", ROSE,
         '<rect x="1" y="2" width="18" height="16" rx="2"/><path d="M1 7h18M5 14l3-3 3 2 4-3"/>',
         [("javascript", "JavaScript"), ("canvas", "HTML Canvas"), ("maplibre", "MapLibre GL JS")]),
        ("TESTING", "JUnit · PIT · Playwright", "Unit · mutation · browser", GREEN,
         '<rect x="1" y="1" width="18" height="18" rx="3"/><path d="m5 10 3 3 7-7"/>',
         [("junit", "JUnit"), ("pitest", "PIT"), ("playwright", "Playwright")]),
        ("BUILD & DEPLOYMENT", "Maven · GitHub Actions", "Docker Compose · Caddy", GOLD,
         '<path d="m10 1 9 5v10l-9 5-9-5V6Zm0 10 9-5M10 11 1 6m9 5v10M5 3.5l9 5"/>',
         [("maven", "Maven"), ("githubactions", "GitHub Actions"), ("docker", "Docker Compose"), ("caddy", "Caddy")]),
    ]
    compact_y = 114
    for index, (label, primary, secondary, color, icon, logos) in enumerate(groups):
        if compact:
            x, y = 24, compact_y
            if index:
                body += f'<path d="M24 {y-10}H376" stroke="{LINE}"/>'
            body += (
                f'<g transform="translate({x} {y})" stroke="{color}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">{icon}</g>'
                + text(x + 32, y + 15, label, 13, color, True)
            )
            for position, (name, logo_label) in enumerate(logos):
                column, row = position % 2, position // 2
                center_x, center_y = x + 16 + column * 178, y + 40 + row * 38
                body += technology_logo(name, logo_label, center_x, center_y,
                                        color, brand_colors.get(name), compact=True)
                body += text(center_x + 24, center_y + 5, logo_label, 15)
            compact_y += 72 if len(logos) <= 2 else 112
            continue
        x, y = ((24 + index * 316, 118) if index < 3
                else (24 + (index - 3) * 478, 288))
        if index in (1, 2):
            body += f'<path d="M{x-18} 118V258" stroke="{LINE}"/>'
        if index == 3:
            body += f'<path d="M24 274H936M484 288V430" stroke="{LINE}"/>'
        body += (
            f'<g transform="translate({x} {y})" stroke="{color}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">{icon}</g>'
            + text(x + 32, y + 15, label, 13, color, True)
            + text(x, y + 56, primary,
                   23 if index >= 3 else 26, weight=600)
            + text(x, y + 84, secondary, 16 if index == 2 else 18,
                   MUTED if index == 3 else INK)
        )
        for position, (name, logo_label) in enumerate(logos):
            center = x + 22 + position * 54
            body += technology_logo(name, logo_label, center,
                                    y + 120, color,
                                    brand_colors.get(name))
    license_text = (ROOT / "docs/assets/tool-logos/LICENSE").read_text()
    body += (
        "<metadata>Devicon logos, revision 32fe1d3b3f36ad11f90ab94f7db59738139c2bf6. "
        "Product names and marks belong to their respective owners.\n"
        + escape(license_text)
        + "\nAdditional vector marks: Simple Icons, CC0-1.0, revision "
        "549ca1d13f2a864889439f6242452c6b4f6514af. "
        "PIT logo by Ling Yeung, unmodified geometry from pitest.org / hcoles/pitest-site, "
        "https://creativecommons.org/licenses/by-nc-sa/3.0/. "
        "The HTML5 mark identifies the HTML Canvas API. "
        "See docs/assets/tool-logos/sources.json for source records.</metadata>"
    )
    return shell(
        width, height,
        "Colorado Traffic Tracker technology stack",
        "Backend: Java 21 and Spring Boot. Storage: PostgreSQL, TimescaleDB and Flyway. "
        "Dashboard: JavaScript, Canvas and MapLibre GL JS. Testing: JUnit, PIT mutation testing "
        "and Playwright browser tests. Build and deployment: Maven, GitHub Actions, Docker Compose and Caddy.",
        body,
    )


def wordmark():
    return shell(
        960,
        130,
        "Colorado Traffic Tracker",
        "Documentation for the I-25 and I-70 traffic project",
        f'<g transform="translate(25 28) scale(1.1)">{MARK}</g>'
        + text(135, 60, "Colorado Traffic Tracker", 32, weight=600)
        + text(
            137, 92, "The roads, the data, and the decisions behind them", 17, MUTED
        ),
    )


def architecture():
    body = heading(
        960, "How the pieces fit", "Collection continues when the page is closed"
    )
    body += f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="{GREEN}"/></marker></defs>'
    boxes = [
        (30, 150, 180, "TomTom", "Traffic flow"),
        (30, 275, 180, "CDOT", "Roadway reports"),
        (280, 155, 190, "ingest-service", "Collect and preserve"),
        (535, 155, 180, "PostgreSQL", "Live + archive"),
        (760, 155, 170, "api-service", "Stored-data reads"),
        (760, 305, 170, "Dashboard", "Explore and compare"),
        (280, 325, 190, "routes-service", "Corridor definitions"),
    ]
    for x, y, w, title, sub in boxes:
        body += (
            f'<rect x="{x}" y="{y}" width="{w}" height="78" rx="8" fill="{PANEL}" stroke="{LINE}"/>'
            + text(x + 14, y + 30, title, 18, weight=500)
            + text(x + 14, y + 55, sub, 13, MUTED)
        )
    for d in [
        "M210 189H280",
        "M210 314H245V210H280",
        "M470 194H535",
        "M715 194H760",
        "M845 233V305",
        "M375 325V233",
    ]:
        body += f'<path d="{d}" fill="none" stroke="{GREEN}" stroke-width="2" marker-end="url(#arrow)"/>'
    body += footer(
        960,
        440,
        "Provider calls belong to collection. Opening the dashboard reads stored observations.",
    )
    return shell(
        960,
        465,
        "Colorado Traffic Tracker architecture",
        "TomTom and CDOT feed ingestion. Corridor definitions constrain collection. PostgreSQL retains current and archived observations. The API serves the dashboard without triggering provider collection.",
        body,
    )
