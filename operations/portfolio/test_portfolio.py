import copy
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).parent))
import publish
import render

NOW = dt.datetime(2026, 11, 21, 20, 30, tzinfo=dt.timezone.utc)


class HistoryClient:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def get(self, path, **params):
        self.calls.append(params)
        end = publish.instant(params["asOf"])
        start = end - dt.timedelta(minutes=params["windowMinutes"])
        rows = [s for s in self.rows if start <= publish.instant(s["polledAt"]) <= end]
        rows.sort(key=lambda s: publish.instant(s["polledAt"]), reverse=True)
        return {"corridor": params["corridor"], "samples": rows[: params["limit"]]}


def fixture():
    last = publish.completed_date(NOW)
    daily = {
        c: {
            (last - dt.timedelta(days=59 - i)).isoformat(): {
                "minimumMph": 50 + i / 10,
                "validSamples": 2,
                "recordedSamples": 2,
            }
            for i in range(60)
        }
        for c in publish.CORRIDORS
    }
    history = {
        c: [
            {
                "polledAt": publish.iso(NOW - dt.timedelta(hours=23 - i * 10)),
                "avgCurrentSpeed": 55 + i * 4,
            }
            for i in range(3)
        ]
        for c in publish.CORRIDORS
    }
    baselines = {
        c: [
            {
                "dayOfWeek": day,
                "hourOfDay": hour,
                "meanSpeed": 65,
                "standardDeviation": 2,
            }
            for day in range(1, 8)
            for hour in range(24)
        ]
        for c in publish.CORRIDORS
    }
    return {
        "schemaVersion": 1,
        "generatedAt": publish.iso(NOW),
        "asOf": publish.iso(NOW),
        "history": history,
        "baselines": baselines,
        "paces": {c: {"minutes": 53 if c == "I25" else 65} for c in publish.CORRIDORS},
        "daily": daily,
    }


class PortfolioTests(unittest.TestCase):
    def test_geometry_guard_ignores_numeric_encoding_but_detects_extent_change(self):
        features = [
            {
                "properties": {
                    "corridor": "I25",
                    "startMileMarker": 271,
                    "endMileMarker": 208,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-105, 40], [-105, 39]],
                },
            }
        ]
        equivalent = copy.deepcopy(features)
        equivalent[0]["properties"]["startMileMarker"] = 271.0
        equivalent[0]["geometry"]["coordinates"][0] = [-105.0, 40.0]
        self.assertEqual(
            publish.geometry_digest(features), publish.geometry_digest(equivalent)
        )
        equivalent[0]["properties"]["endMileMarker"] = 209
        self.assertNotEqual(
            publish.geometry_digest(features), publish.geometry_digest(equivalent)
        )

    def test_daily_low_uses_original_corridor_averages_and_keeps_zero(self):
        result = publish.daily_minimum(
            [
                {"avgCurrentSpeed": 61, "minCurrentSpeed": 3},
                {"avgCurrentSpeed": 58.5},
                {"avgCurrentSpeed": 0},
                {"avgCurrentSpeed": None},
                {"avgCurrentSpeed": float("nan")},
            ]
        )
        self.assertEqual(
            result, {"minimumMph": 0, "validSamples": 3, "recordedSamples": 5}
        )
        self.assertEqual(
            publish.daily_minimum([{"avgCurrentSpeed": None}])["minimumMph"], None
        )

    def test_denver_days_include_both_dst_transitions(self):
        self.assertEqual(
            (
                publish.day_bounds(dt.date(2026, 3, 8))[1]
                - publish.day_bounds(dt.date(2026, 3, 8))[0]
            ).total_seconds()
            / 3600,
            23,
        )
        self.assertEqual(
            (
                publish.day_bounds(dt.date(2026, 11, 1))[1]
                - publish.day_bounds(dt.date(2026, 11, 1))[0]
            ).total_seconds()
            / 3600,
            25,
        )

    def test_calendar_waits_until_day_is_complete_and_grace_has_passed(self):
        self.assertEqual(
            publish.completed_date(dt.datetime(2026, 11, 21, 0, 5, tzinfo=render.ZONE)),
            dt.date(2026, 11, 19),
        )
        self.assertEqual(
            publish.completed_date(
                dt.datetime(2026, 11, 21, 0, 15, tzinfo=render.ZONE)
            ),
            dt.date(2026, 11, 20),
        )

    def test_saturated_history_pages_overlap_without_losing_boundary_rows(self):
        rows = [
            {
                "id": i,
                "polledAt": publish.iso(NOW - dt.timedelta(seconds=i)),
                "avgCurrentSpeed": 50 + i % 20,
            }
            for i in range(2100)
        ]
        client = HistoryClient(rows)
        result = publish.history(
            client, "I25", NOW - dt.timedelta(hours=1), NOW + dt.timedelta(seconds=1)
        )
        self.assertEqual(len(result), 2100)
        self.assertEqual(len(client.calls), 2)

    def test_non_advancing_history_is_rejected(self):
        rows = [
            {"id": i, "polledAt": publish.iso(NOW), "avgCurrentSpeed": 50}
            for i in range(2001)
        ]
        with self.assertRaisesRegex(publish.PublishError, "no progress"):
            publish.history(
                HistoryClient(rows), "I25", NOW - dt.timedelta(hours=1), NOW
            )

    def test_calendar_reuses_cached_days_and_fetches_only_missing_day(self):
        data = fixture()
        cached = copy.deepcopy(data["daily"])
        day = publish.completed_date(NOW)
        for c in cached:
            del cached[c][day.isoformat()]
        client = HistoryClient(
            [
                {
                    "id": 1,
                    "polledAt": publish.iso(
                        publish.day_bounds(day)[0] + dt.timedelta(hours=3)
                    ),
                    "avgCurrentSpeed": 42,
                }
            ]
        )
        result = publish.daily_history(client, cached, NOW)
        self.assertTrue(all(len(days) == 60 for days in result.values()))
        self.assertEqual(len(client.calls), 2)
        self.assertTrue(all(p["windowMinutes"] == 1440 for p in client.calls))
        self.assertEqual(result["I25"][day.isoformat()]["minimumMph"], 42)
        untouched = HistoryClient([])
        self.assertEqual(publish.daily_history(untouched, result, NOW), result)
        self.assertEqual(untouched.calls, [])

    def test_incomplete_cells_use_average_without_inventing_zero_travel_time(self):
        snapshot = {
            "observedAt": publish.iso(NOW),
            "cells": [
                {
                    "startMileMarker": 208,
                    "endMileMarker": 208.5,
                    "speedMph": 60,
                    "direction": "COMBINED",
                }
            ],
        }
        result = publish.pace(
            snapshot, {"polledAt": publish.iso(NOW), "avgCurrentSpeed": 60}, 63, NOW
        )
        self.assertEqual(result["minutes"], 63)
        snapshot["cells"][0]["speedMph"] = 0
        self.assertIsNone(
            publish.pace(snapshot, {"avgCurrentSpeed": 60}, 63, NOW)["minutes"]
        )

    def test_directional_companions_are_not_double_counted(self):
        cells = [
            {
                "startMileMarker": i / 2,
                "endMileMarker": (i + 1) / 2,
                "speedMph": 60,
                "direction": "COMBINED",
            }
            for i in range(2)
        ]
        cells.append(
            {"startMileMarker": 0, "endMileMarker": 1, "speedMph": 1, "direction": "E"}
        )
        result = publish.pace(
            {"observedAt": publish.iso(NOW), "cells": cells}, {}, 1, NOW
        )
        self.assertEqual(result["minutes"], 1)
        self.assertEqual(result["method"], "complete combined-direction map cells")

    def test_shared_artwork_is_self_contained_and_has_real_calendar_values(self):
        data = fixture()
        base = json.loads((publish.ASSETS / "map-base.json").read_text())
        for compact in (False, True):
            for svg in [
                render.map_svg(data, base, compact),
                render.journal_svg(data, compact),
                render.calendar_svg(data["daily"], compact),
            ]:
                parsed = ET.fromstring(svg)
                for element in parsed.iter():
                    self.assertFalse(element.tag.endswith("foreignObject"))
                    for key, value in element.attrib.items():
                        if key not in ("href", "style"):
                            self.assertFalse(
                                "NaN" in value or "Infinity" in value,
                                "Non-finite SVG coordinate",
                            )
            calendar = ET.fromstring(render.calendar_svg(data["daily"], compact))
            recorded = [
                r
                for r in calendar.iter("{http://www.w3.org/2000/svg}rect")
                if r.find("{http://www.w3.org/2000/svg}title") is not None
            ]
            self.assertEqual(len(recorded), 126)
        self.assertNotEqual(render.heat_color(0), render.heat_color(0.25))

    def test_failed_generation_keeps_current_snapshot_and_cache(self):
        data = fixture()
        base = json.loads((publish.ASSETS / "map-base.json").read_text())
        with tempfile.TemporaryDirectory() as folder:
            first = publish.publish(folder, data, base)
            before = (Path(folder) / "state.json").read_bytes()
            next_data = copy.deepcopy(data)
            next_data["generatedAt"] = publish.iso(NOW + dt.timedelta(minutes=15))
            with patch.object(
                render, "journal_svg", side_effect=ValueError("render failed")
            ):
                with self.assertRaises(ValueError):
                    publish.publish(folder, next_data, base)
            self.assertEqual((Path(folder) / "web/current").resolve(), first.resolve())
            self.assertEqual((Path(folder) / "state.json").read_bytes(), before)
            self.assertFalse(list((Path(folder) / "web/snapshots").glob(".building-*")))

    def test_calendar_file_and_its_source_remain_unchanged_between_daily_updates(self):
        data = fixture()
        base = json.loads((publish.ASSETS / "map-base.json").read_text())
        with tempfile.TemporaryDirectory() as folder:
            first = publish.publish(folder, data, base)
            metadata = (first / "calendar.svg").read_bytes()
            inode = (first / "calendar.svg").stat().st_ino
            data["generatedAt"] = publish.iso(NOW + dt.timedelta(minutes=15))
            second = publish.publish(folder, data, base)
            self.assertEqual((second / "calendar.svg").read_bytes(), metadata)
            self.assertEqual((second / "calendar.svg").stat().st_ino, inode)
            self.assertEqual(
                json.loads((second / "data.json").read_text())["generatedAt"],
                data["generatedAt"],
            )

    def test_calendar_reuse_follows_published_data_after_an_interrupted_switch(self):
        data = fixture()
        base = json.loads((publish.ASSETS / "map-base.json").read_text())
        with tempfile.TemporaryDirectory() as folder:
            first = publish.publish(folder, data, base)
            newer = copy.deepcopy(data)
            newer["generatedAt"] = publish.iso(NOW + dt.timedelta(minutes=15))
            day = next(iter(newer["daily"]["I25"]))
            newer["daily"]["I25"][day]["minimumMph"] = 10
            publish.atomic_json(
                Path(folder) / "state.json",
                {"schemaVersion": 1, "daily": newer["daily"]},
            )
            second = publish.publish(folder, newer, base)
            self.assertNotEqual(
                (second / "calendar.svg").stat().st_ino,
                (first / "calendar.svg").stat().st_ino,
            )
            self.assertIn("10.00 mph", (second / "calendar.svg").read_text())

    def test_retention_only_removes_owned_derived_snapshots(self):
        with tempfile.TemporaryDirectory() as folder:
            versions = Path(folder) / "web/snapshots"
            versions.mkdir(parents=True)
            for i in range(3):
                p = versions / f"20261121T20300{i}000000Z"
                p.mkdir()
                (p / "data.json").write_text('{"schemaVersion":1}')
            current = versions / "20261121T203002000000Z"
            (versions.parent / "current").symlink_to(current)
            private = versions / "notes"
            private.mkdir()
            (private / "keep").write_text("not generated traffic artwork")
            publish.prune_snapshots(folder, keep=2)
            self.assertTrue(current.is_dir())
            self.assertTrue((private / "keep").exists())
            self.assertEqual(
                len([d for d in versions.iterdir() if d.name.startswith("2026")]), 2
            )


if __name__ == "__main__":
    unittest.main()
