"""Keep a marked experimental integration out of the production delivery line."""

import json
import os
from pathlib import Path
import re
import subprocess


MARKER = ".github/experimental-integration.json"


def marker_branch(content):
    marker = json.loads(content)
    if not isinstance(marker, dict) or set(marker) != {"base_branch"}:
        raise ValueError("Experimental marker must contain only base_branch")
    branch = marker["base_branch"]
    if not isinstance(branch, str) or not re.fullmatch(r"experiment/[a-z0-9][a-z0-9-]*", branch):
        raise ValueError("Experimental integration must use an experiment/ branch")
    return branch


def base_marker(base):
    if not re.fullmatch(r"[0-9a-f]{40}", base):
        raise ValueError("PR base must be a full commit SHA")
    subprocess.run(["git", "cat-file", "-e", f"{base}^{{commit}}"], check=True)
    files = subprocess.run(
        ["git", "ls-tree", "--name-only", base, "--", MARKER],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    if not files:
        return None
    return subprocess.run(
        ["git", "show", f"{base}:{MARKER}"], check=True, capture_output=True, text=True,
    ).stdout


def verify_boundary():
    marker = Path(MARKER)
    branches = {marker_branch(marker.read_text())} if marker.exists() else set()
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    if event == "pull_request":
        original = base_marker(os.environ["PR_BASE_SHA"])
        if original is not None:
            if not marker.exists():
                raise ValueError("An experimental topic cannot remove its integration marker")
            branches.add(marker_branch(original))
        if len(branches) > 1:
            raise ValueError("An experimental topic cannot change its integration destination")
        if branches and os.environ["PR_BASE_REF"] not in branches:
            raise ValueError("Experimental changes must target their marked integration, not main")
    elif branches and event == "push":
        if os.environ["GITHUB_REF_NAME"] not in branches:
            raise ValueError("Experimental changes cannot enter the production push workflow")
    elif branches and event != "workflow_dispatch":
        raise ValueError("Unknown event cannot authorize an experimental delivery")
    print("Delivery boundary verified; CI does not authorize deployment.")


if __name__ == "__main__":
    verify_boundary()
