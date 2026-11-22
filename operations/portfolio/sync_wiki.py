#!/usr/bin/env python3
"""Copy reviewed wiki sources into an existing wiki checkout; never push."""

import argparse
from pathlib import Path
import subprocess
import sys

SOURCE = Path(__file__).resolve().parents[2] / "wiki"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check that the checkout matches, without writing",
    )
    args = parser.parse_args()
    target = args.checkout.resolve()
    remote = subprocess.run(
        ["git", "-C", str(target), "remote", "get-url", "origin"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    if not remote.endswith("brentjColoS/ColoradoTrafficTracker.wiki.git"):
        parser.error("Choose the ColoradoTrafficTracker.wiki.git checkout")
    status = subprocess.run(
        ["git", "-C", str(target), "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    if status and not args.check:
        parser.error(
            "Preserve or commit the checkout's existing changes before copying reviewed sources"
        )
    changed = []
    for source in sorted(SOURCE.glob("*.md")):
        destination = target / source.name
        if not destination.exists() or destination.read_bytes() != source.read_bytes():
            changed.append(source.name)
            if not args.check:
                destination.write_bytes(source.read_bytes())
    print(
        ("Different pages: " if args.check else "Copied pages: ")
        + (", ".join(changed) if changed else "none")
    )
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    sys.exit(main())
