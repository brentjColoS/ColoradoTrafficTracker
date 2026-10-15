#!/usr/bin/env python3
"""Export the sign-feature dashboard with an explicitly frozen public snapshot."""
import argparse
from datetime import datetime
import html
import json
from pathlib import Path
import shutil

PUBLIC_FIELDS = (
    "id", "mileMarker", "direction", "longitude", "latitude", "location",
    "regularLimitMph", "reportedLimitMph", "status", "displayStatus",
    "communicationStatus", "sourceUpdatedAt", "activatedAt", "fetchedAt", "lastAttemptAt",
)
STATUSES = {"AVAILABLE", "COMMUNICATION_ERROR", "UNAVAILABLE", "FETCH_FAILED", "STALE", "NOT_OBSERVED"}


def prepare(source, snapshot_file, output):
    if output.exists():
        raise ValueError("Use a new output directory; existing previews are preserved")
    if snapshot_file.stat().st_size > 256 * 1024:
        raise ValueError("Saved snapshot exceeds the demo size limit")
    snapshot = json.loads(snapshot_file.read_text())
    captured = datetime.fromisoformat(snapshot["generatedAt"].replace("Z", "+00:00"))
    if captured.tzinfo is None or snapshot.get("corridor") != "I70" or snapshot.get("provider") != "CDOT":
        raise ValueError("Expected a dated I-70 CDOT capture")
    catalog = json.loads((source / "common/src/main/resources/i70-variable-speed-signs.json").read_text())
    devices = {device["id"]: device for device in catalog}
    rows = snapshot.get("signs", [])
    if not rows or len(rows) > 64 or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Expected one bounded record per captured sign")
    signs = []
    for row in rows:
        device = devices.get(row["id"])
        if not device or any(row.get(key) != device[key] for key in ("mileMarker", "direction", "longitude", "latitude")):
            raise ValueError("Captured sign is outside the reviewed catalog")
        if row.get("status") not in STATUSES:
            raise ValueError("Unknown captured sign status")
        clean = {key: row.get(key) for key in PUBLIC_FIELDS}
        clean["location"] = device["location"]
        if len(json.dumps(clean)) > 4096:
            raise ValueError("Captured sign exceeds the normalized size limit")
        signs.append(clean)
    public = {"corridor":"I70", "provider":"CDOT", "generatedAt":snapshot["generatedAt"],
              "fetchedAt":snapshot["generatedAt"], "signs":signs}
    dashboard = output / "dashboard"
    shutil.copytree(source / "api-service/src/main/resources/static/dashboard", dashboard)
    page = (dashboard / "index.html").read_text()
    stamp = html.escape(captured.isoformat())
    page = page.replace("<html ", f'<html data-replay-enabled="false" data-variable-limit-demo-at="{stamp}" ')
    page = page.replace("</head>", '<meta name="robots" content="noindex,nofollow">'
        '<style>.variable-limit-demo-banner{margin:12px 0;padding:10px 14px;border:1px solid var(--gold-data);'
        'background:var(--panel);color:var(--ink);font:13px/1.6 Archivo,sans-serif;}'
        '.variable-limit-demo-banner strong{display:block}.variable-limit-demo-banner a{color:inherit}</style></head>')
    banner = (f'<aside class="variable-limit-demo-banner" role="note"><strong>Variable speed limit demo</strong>'
        f'Saved CDOT sign readings: <time datetime="{stamp}" id="variableLimitCapture">{stamp}</time>. '
        'Sign readings are frozen, not live; traffic charts use the existing experimental traffic data. '
        '<a href="/dashboard-experimental/">Back to experimental</a>.</aside>')
    marker = '<main'
    start = page.index(">", page.index(marker)) + 1
    page = page[:start] + banner + page[start:]
    page = page.replace('<script src="variable-speed-signs.js?v=i70-variable-limits-1"></script>',
        '<script src="variable-speed-signs.js?v=i70-variable-limits-1"></script>'
        '<script src="variable-limit-demo.js?v=variable-limit-demo-1"></script>'
        '<script>document.getElementById("variableLimitCapture").textContent=new Intl.DateTimeFormat('
        'undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",'
        'timeZoneName:"short",timeZone:"America/Denver"}).format(new Date('
        f'"{stamp}"));</script>')
    (dashboard / "index.html").write_text(page)
    for filename, before, after in (
        ("dashboard.js", "I-70 current posted limits:", "I-70 saved posted limits:"),
        ("corridor-map.js", "Current CDOT limits", "Saved CDOT limits"),
        ("corridor-map.js", "CDOT-reported posted limit", "CDOT-reported limit at capture"),
    ):
        file = dashboard / filename
        text = file.read_text()
        if before not in text:
            raise ValueError("Sign feature source does not match the demo export")
        file.write_text(text.replace(before, after))
    (dashboard / "variable-limit-snapshot.json").write_text(json.dumps(public, separators=(",", ":")) + "\n")
    return len(signs)


def prepare_live(source, output):
    if output.exists():
        raise ValueError("Use a new output directory; existing previews are preserved")
    dashboard = output / "dashboard"
    shutil.copytree(source / "api-service/src/main/resources/static/dashboard", dashboard)
    page = (dashboard / "index.html").read_text()
    page = page.replace("<html ", '<html data-replay-enabled="false" data-variable-limit-demo-live="true" ')
    page = page.replace("</head>", '<meta name="robots" content="noindex,nofollow">'
        '<style>.variable-limit-demo-banner{margin:12px 0;padding:10px 14px;border:1px solid var(--gold-data);'
        'background:var(--panel);color:var(--ink);font:13px/1.6 Archivo,sans-serif;}'
        '.variable-limit-demo-banner strong{display:block}.variable-limit-demo-banner a{color:inherit}</style></head>')
    banner = ('<aside class="variable-limit-demo-banner" role="note"><strong>Live CDOT variable speed limits</strong>'
        '<span id="variableLimitLiveStatus">Loading live sign observations.</span> '
        'Initial coverage fills in over about 21 minutes. Sign reports and traffic observations have separate update times. '
        '<a href="/dashboard-experimental/">Back to experimental</a>.</aside>')
    start = page.index(">", page.index("<main")) + 1
    page = page[:start] + banner + page[start:]
    marker = '<script src="variable-speed-signs.js?v=i70-variable-limits-1"></script>'
    if marker not in page:
        raise ValueError("Sign feature source does not match the demo export")
    page = page.replace(marker, marker + '<script src="variable-limit-demo.js?v=variable-limit-live-1"></script>')
    (dashboard / "index.html").write_text(page)
    return len(json.loads((source / "common/src/main/resources/i70-variable-speed-signs.json").read_text()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--snapshot", type=Path)
    mode.add_argument("--live", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    count = prepare_live(args.source, args.output) if args.live else prepare(args.source, args.snapshot, args.output)
    print(f"Prepared {'live reads for' if args.live else 'saved reports for'} {count} I-70 sign devices")
