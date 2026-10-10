"""Adapt a committed legacy build context to its isolated public prefixes."""

from pathlib import Path
import sys


def prepare(root):
    dashboard = Path(root) / "api-service/src/main/resources/static/dashboard"
    replacements = {
        "index.html": (b"/dashboard/", b"/dashboard-old/"),
        "dashboard.js": (b"/dashboard-api/", b"/dashboard-old-api/"),
        "road-sign-display.js": (b"/dashboard/", b"/dashboard-old/"),
    }
    prepared = {}
    for name, (old, new) in replacements.items():
        path = dashboard / name
        content = path.read_bytes()
        if old not in content or new in content:
            raise ValueError(f"{name} does not match an unmodified legacy dashboard")
        prepared[path] = content.replace(old, new)
    for path, content in prepared.items():
        path.write_bytes(content)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: prepare-old-dashboard.py <archived-source-directory>")
    prepare(sys.argv[1])
