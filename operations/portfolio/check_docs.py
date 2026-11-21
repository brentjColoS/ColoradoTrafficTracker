#!/usr/bin/env python3
"""Check local documentation targets and links to this repository's wiki."""

from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
REPO = "/brentjColoS/ColoradoTrafficTracker"


def main():
    names = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
        cwd=ROOT,
        text=True,
    ).splitlines()
    failures = []
    checked = 0
    for name in sorted(set(names)):
        source = ROOT / name
        if not source.is_file():
            continue
        content = re.sub(r"```.*?```", "", source.read_text(), flags=re.S)
        links = re.findall(r"!?\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)", content)
        links += re.findall(r'(?:href|src|srcset)="([^"\s]+)"', content)
        for link in links:
            url = urlsplit(unquote(link.strip("<>")))
            path = url.path
            target = None
            if url.netloc == "github.com" and path.startswith(REPO + "/wiki/"):
                page = path[len(REPO + "/wiki/") :].rstrip("/")
                target = ROOT / "wiki" / (page + ".md")
            elif url.netloc == "github.com" and path.startswith(REPO + "/blob/main/"):
                target = ROOT / path[len(REPO + "/blob/main/") :]
            elif url.netloc == "github.com" and path.startswith(REPO + "/tree/main/"):
                target = ROOT / path[len(REPO + "/tree/main/") :]
            elif url.netloc == "raw.githubusercontent.com" and path.startswith(
                REPO + "/main/"
            ):
                target = ROOT / path[len(REPO + "/main/") :]
            elif not url.scheme and not url.netloc and path:
                target = source.parent / path
                if source.parent == ROOT / "wiki" and not target.suffix:
                    target = target.with_suffix(".md")
            if target is not None:
                checked += 1
                if not target.exists():
                    failures.append(f"{name}: missing target {link}")
    print(
        f"Checked {checked} repository and wiki targets in {len(set(names))} Markdown files"
    )
    for failure in failures:
        print(failure, file=sys.stderr)
    return bool(failures)


if __name__ == "__main__":
    sys.exit(main())
