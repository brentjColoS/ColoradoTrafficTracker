"""Omit PIT only when a PR changes recognized non-Java content exclusively."""

import os
from pathlib import PurePosixPath
import subprocess

from pr_base import pull_request_base

FRONTEND_TEST_PATHS = frozenset({
    "scripts/tests/dashboard.test.cjs",
    "scripts/tests/dashboard-preview.cjs",
})


def requires_mutation(paths):
    for path in paths:
        documentation = path.startswith("docs/") or (
            "/" not in path and PurePosixPath(path).suffix == ".md"
        )
        dashboard = path.startswith("api-service/src/main/resources/static/")
        if not (documentation or dashboard or path in FRONTEND_TEST_PATHS):
            return True
    return False


def mutation_required():
    if os.environ.get("GITHUB_EVENT_NAME") != "pull_request":
        return True
    base = pull_request_base()
    diff = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "-z", base, "HEAD"],
        check=True, capture_output=True,
    )
    paths = diff.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    return requires_mutation(path for path in paths if path)


if __name__ == "__main__":
    print(f"required={str(mutation_required()).lower()}")
