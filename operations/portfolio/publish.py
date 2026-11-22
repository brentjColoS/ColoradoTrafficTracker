#!/usr/bin/env python3
"""Publish bounded, read-only traffic snapshots without changing Git history."""

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

import render

UTC = dt.timezone.utc
CORRIDORS = ("I25", "I70")
ASSETS = Path(__file__).parent / "assets"


class PublishError(Exception):
    pass


def instant(value):
    if not isinstance(value, str):
        raise PublishError("Observation timestamp is missing or invalid")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise PublishError("Observation timestamp is missing or invalid") from None
    if parsed.tzinfo is None:
        raise PublishError("Observation timestamp has no timezone")
    return parsed.astimezone(UTC)


def iso(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def speed(value):
    return (
        value
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
        else None
    )


class Client:
    def __init__(self, base_url):
        url = urllib.parse.urlsplit(base_url)
        if (
            url.scheme not in ("http", "https")
            or not url.netloc
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise PublishError("Use a credential-free HTTP(S) dashboard API base URL")
        self.base = base_url.rstrip("/")
        self.requests = 0

    def get(self, path, **params):
        self.requests += 1
        if self.requests > 128:
            raise PublishError(
                "Read budget reached; retry with the previous daily cache or a smaller backfill"
            )
        query = urllib.parse.urlencode(params)
        request = urllib.request.Request(
            self.base + path + ("?" + query if query else ""),
            headers={
                "User-Agent": "ColoradoTrafficTracker portfolio publisher",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read(6_000_001)
            if len(raw) > 6_000_000:
                raise PublishError(
                    "Stored-data response exceeded the bounded response size"
                )
            return json.loads(raw)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            code = getattr(error, "code", None)
            raise PublishError(
                f"Stored-data read failed ({code or type(error).__name__}); last published images remain in place"
            ) from None


def history(client, corridor, since, until):
    cursor = until
    found = {}
    while cursor >= since:
        minutes = min(10080, max(1, math.ceil((cursor - since).total_seconds() / 60)))
        lower = cursor - dt.timedelta(minutes=minutes)
        payload = client.get(
            "/traffic/history",
            corridor=corridor,
            windowMinutes=minutes,
            limit=2000,
            includeIncidents="false",
            preferUsable="false",
            asOf=iso(cursor),
        )
        if payload.get("corridor") != corridor or not isinstance(
            payload.get("samples"), list
        ):
            raise PublishError("History response did not match the requested corridor")
        samples = payload["samples"]
        times = []
        for sample in samples:
            timestamp = instant(sample["polledAt"])
            if timestamp > cursor or timestamp < lower:
                raise PublishError(
                    "History returned an observation outside its requested bounds"
                )
            times.append(timestamp)
            if since <= timestamp < until:
                key = (
                    sample.get("sampleRefId")
                    or sample.get("id")
                    or (sample["polledAt"], sample.get("avgCurrentSpeed"))
                )
                found[key] = {
                    "polledAt": iso(timestamp),
                    "avgCurrentSpeed": speed(sample.get("avgCurrentSpeed")),
                }
        if len(samples) < 2000:
            if lower <= since:
                break
            cursor = lower
        else:
            earliest = min(times)
            if earliest >= cursor:
                raise PublishError(
                    "History pagination made no progress; incomplete data was not published"
                )
            # The inclusive timestamp cursor re-reads boundary ties before deduplication.
            cursor = earliest
    return sorted(found.values(), key=lambda sample: instant(sample["polledAt"]))


def day_bounds(day):
    start = dt.datetime.combine(day, dt.time(), render.ZONE)
    end = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), render.ZONE)
    return start.astimezone(UTC), end.astimezone(UTC)


def completed_date(now):
    return (
        now.astimezone(render.ZONE) - dt.timedelta(minutes=15)
    ).date() - dt.timedelta(days=1)


def daily_minimum(samples):
    valid = [
        s["avgCurrentSpeed"]
        for s in samples
        if speed(s.get("avgCurrentSpeed")) is not None
    ]
    return {
        "minimumMph": min(valid) if valid else None,
        "validSamples": len(valid),
        "recordedSamples": len(samples),
    }


def daily_history(client, cached, now):
    end = completed_date(now)
    first = end - dt.timedelta(days=59)
    result = {corridor: {} for corridor in CORRIDORS}
    for corridor in CORRIDORS:
        previous = cached.get(corridor, {})
        missing = []
        for offset in range(60):
            day = first + dt.timedelta(days=offset)
            record = previous.get(day.isoformat())
            if record is None:
                missing.append(day)
            else:
                count, total = record.get("validSamples"), record.get("recordedSamples")
                minimum = record.get("minimumMph")
                if (
                    not isinstance(count, int)
                    or not isinstance(total, int)
                    or not 0 <= count <= total
                    or (count == 0 and minimum is not None)
                    or (count > 0 and speed(minimum) is None)
                ):
                    raise PublishError(
                        "The daily cache is invalid; review it before rebuilding"
                    )
                result[corridor][day.isoformat()] = record
        if missing:
            # One initial backfill, then only the completed dates absent from the cache.
            samples = history(
                client, corridor, day_bounds(missing[0])[0], day_bounds(missing[-1])[1]
            )
            groups = {day.isoformat(): [] for day in missing}
            for sample in samples:
                key = (
                    instant(sample["polledAt"])
                    .astimezone(render.ZONE)
                    .date()
                    .isoformat()
                )
                if key in groups:
                    groups[key].append(sample)
            for key, rows in groups.items():
                result[corridor][key] = daily_minimum(rows)
        result[corridor] = dict(sorted(result[corridor].items()))
    return result


def pace(snapshot, latest, miles, now):
    observed = snapshot.get("observedAt")
    usable = observed and -dt.timedelta(minutes=5) <= now - instant(
        observed
    ) <= dt.timedelta(hours=1)
    unique = {}
    if usable:
        for cell in snapshot.get("cells", []):
            if cell.get("direction", "COMBINED") != "COMBINED":
                continue
            start, end = cell.get("startMileMarker"), cell.get("endMileMarker")
            value = speed(cell.get("speedMph"))
            if (
                start is not None
                and end is not None
                and value is not None
                and end != start
            ):
                unique[tuple(sorted((start, end)))] = value
    pieces = sorted(unique)
    if any(v == 0 for v in unique.values()):
        return {
            "minutes": None,
            "observedAt": observed,
            "method": "zero-speed observation",
            "retained": False,
        }
    complete = (
        pieces
        and abs(sum(b - a for a, b in pieces) - miles) <= 0.02
        and abs(pieces[-1][1] - pieces[0][0] - miles) <= 0.02
        and all(
            abs(a - pieces[i - 1][1]) <= 0.02 for i, (a, b) in enumerate(pieces) if i
        )
    )
    if complete:
        minutes = sum((b - a) / unique[(a, b)] * 60 for a, b in pieces)
        method = "complete combined-direction map cells"
    else:
        average = speed(latest.get("avgCurrentSpeed"))
        minutes = miles / average * 60 if average is not None and average > 0 else None
        observed = latest.get("polledAt")
        method = "corridor-average fallback"
    if observed and instant(observed) > now + dt.timedelta(minutes=5):
        raise PublishError("Travel estimate observation lies in the future")
    return {
        "minutes": math.floor(minutes + 0.5) if minutes is not None else None,
        "observedAt": observed,
        "method": method,
        "retained": bool(observed and now - instant(observed) > dt.timedelta(hours=1)),
    }


def geometry_digest(features):
    def canonical(value):
        if isinstance(value, dict):
            return {k: canonical(v) for k, v in value.items()}
        if isinstance(value, list):
            return [canonical(v) for v in value]
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value

    selected = sorted(
        [
            {
                "corridor": f["properties"]["corridor"],
                "geometry": f["geometry"],
                "start": f["properties"]["startMileMarker"],
                "end": f["properties"]["endMileMarker"],
            }
            for f in features
        ],
        key=lambda f: f["corridor"],
    )
    return hashlib.sha256(
        json.dumps(canonical(selected), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def collect(client, cached, now, base):
    geometry = client.get("/traffic/map/corridors")
    features = [
        f
        for f in geometry.get("features", [])
        if f.get("properties", {}).get("corridor") in CORRIDORS
    ]
    if {f["properties"]["corridor"] for f in features} != set(
        CORRIDORS
    ) or geometry_digest(features) != base["geometryDigest"]:
        raise PublishError(
            "The corridor extent changed; recapture and review the background before publishing this map"
        )
    data = {
        "schemaVersion": 1,
        "generatedAt": iso(now),
        "asOf": iso(now),
        "history": {},
        "baselines": {},
        "paces": {},
        "daily": {},
        "source": "Stored, archive-inclusive Colorado Traffic Tracker observations",
    }
    for corridor in CORRIDORS:
        data["history"][corridor] = history(
            client, corridor, now - dt.timedelta(days=1), now
        )
        if not any(s["avgCurrentSpeed"] is not None for s in data["history"][corridor]):
            raise PublishError(
                f"No usable {corridor} speeds in the past day; the previous snapshot was retained"
            )
        baseline = client.get(
            "/traffic/analytics/baselines", corridor=corridor, asOf=iso(now)
        )
        if baseline.get("corridor") != corridor or not isinstance(
            baseline.get("profiles"), list
        ):
            raise PublishError("Baseline response did not match the requested corridor")
        data["baselines"][corridor] = baseline["profiles"]
        cells = client.get("/traffic/map/flow-cells/current", corridor=corridor)
        latest = client.get("/traffic/latest", corridor=corridor, preferUsable="true")
        if cells.get("corridor") != corridor or latest.get("corridor") != corridor:
            raise PublishError(
                "Travel-time inputs did not match the requested corridor"
            )
        feature = next(f for f in features if f["properties"]["corridor"] == corridor)
        miles = abs(
            feature["properties"]["endMileMarker"]
            - feature["properties"]["startMileMarker"]
        )
        data["paces"][corridor] = pace(cells, latest, miles, now)
    data["daily"] = daily_history(client, cached, now)
    return data


def atomic_json(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(data, separators=(",", ":"), allow_nan=False) + "\n"
    )
    temporary.replace(path)


def publish(output, data, base):
    output = Path(output)
    web = output / "web"
    versions = web / "snapshots"
    versions.mkdir(parents=True, exist_ok=True)
    previous = web / "current"
    if previous.exists() and (
        not previous.is_symlink() or previous.resolve().parent != versions.resolve()
    ):
        raise PublishError(
            "The current publication must point to an owned snapshot directory"
        )
    prior_data = previous / "data.json"
    old_publication = json.loads(prior_data.read_text()) if prior_data.is_file() else {}
    identifier = instant(data["generatedAt"]).strftime("%Y%m%dT%H%M%S%fZ")
    target = versions / identifier
    staging = Path(tempfile.mkdtemp(prefix=".building-", dir=versions))
    try:
        # mkdtemp starts at 0700; Caddy needs group traversal after publication.
        staging.chmod(0o750)
        for compact in (False, True):
            suffix = "-compact" if compact else ""
            images = {
                "map": render.map_svg(data, base, compact),
                "journal": render.journal_svg(data, compact),
            }
            prior_calendar = previous / ("calendar" + suffix + ".svg")
            if (
                old_publication.get("daily") == data["daily"]
                and prior_calendar.is_file()
            ):
                os.link(prior_calendar, staging / ("calendar" + suffix + ".svg"))
            else:
                images["calendar"] = render.calendar_svg(data["daily"], compact)
            for name, svg in images.items():
                source_url = f"https://coloradotraffictracker.net/readme/snapshots/{identifier}/data.json"
                svg = svg.replace(
                    "</svg>",
                    f"<metadata>Source JSON: {render.escape(source_url)}</metadata></svg>",
                )
                (staging / (name + suffix + ".svg")).write_text(svg)
        atomic_json(staging / "data.json", data)
        (staging / "index.html").write_text(
            '<!doctype html><meta charset="utf-8"><title>CTT snapshot data</title><h1>Traffic snapshot</h1><p>'
            + render.escape(render.stamp(data["generatedAt"]))
            + '</p><p><a href="data.json">Read the JSON used by these images</a></p>'
            + "".join(
                f'<p><img src="{name}.svg" alt="{name}" style="max-width:960px;width:100%"></p>'
                for name in ["map", "journal", "calendar"]
            )
        )
        staging.rename(target)
        atomic_json(
            output / "state.json",
            {
                "schemaVersion": 1,
                "daily": data["daily"],
                "publishedAt": data["generatedAt"],
            },
        )
        link = web / ".next"
        if link.is_symlink():
            link.unlink()
        link.symlink_to(Path("snapshots") / identifier)
        link.replace(web / "current")
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return target


def prune_snapshots(output, keep=192):
    web = Path(output) / "web"
    current = (web / "current").resolve()
    owned = []
    for path in (web / "snapshots").iterdir():
        if (
            path.is_symlink()
            or not path.is_dir()
            or not re.fullmatch(r"\d{8}T\d{12}Z", path.name)
        ):
            continue
        try:
            if json.loads((path / "data.json").read_text()).get("schemaVersion") == 1:
                owned.append(path)
        except (OSError, ValueError):
            continue
    for path in sorted(owned, reverse=True)[keep:]:
        if path.resolve() != current:
            shutil.rmtree(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080/dashboard-api")
    parser.add_argument("--rebuild-calendar", action="store_true")
    parser.add_argument(
        "--replay",
        type=Path,
        help="Render a previously exported data.json without network reads",
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "publisher.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("A portfolio update is already running")
            return 0
        try:
            base = json.loads((ASSETS / "map-base.json").read_text())
            state_path = args.output / "state.json"
            state = json.loads(state_path.read_text()) if state_path.exists() else {}
            if state and state.get("schemaVersion") != 1:
                raise PublishError(
                    "Unknown daily-cache format; review the cache before rebuilding"
                )
            data = (
                json.loads(args.replay.read_text())
                if args.replay
                else collect(
                    Client(args.base_url),
                    {} if args.rebuild_calendar else state.get("daily", {}),
                    dt.datetime.now(UTC),
                    base,
                )
            )
            target = publish(args.output, data, base)
            prune_snapshots(args.output)
            print("Published portfolio snapshot " + target.name)
            return 0
        except (PublishError, OSError, ValueError, KeyError, TypeError) as error:
            print("Portfolio update failed: " + str(error), file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(main())
