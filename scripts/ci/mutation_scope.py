"""Omit PIT only when a PR changes recognized non-Java content exclusively."""

import os
from pathlib import PurePosixPath
import re
import subprocess

FRONTEND_TEST_PATHS = frozenset({
    "scripts/tests/dashboard.test.cjs",
    "scripts/tests/dashboard-preview.cjs",
    "scripts/tests/dashboard-batch-fixture.cjs",
    "scripts/tests/dashboard/charts.cjs",
    "scripts/tests/dashboard/continuous-history.cjs",
    "scripts/tests/dashboard/controls.cjs",
    "scripts/tests/dashboard/health.cjs",
    "scripts/tests/dashboard/history-navigation.cjs",
    "scripts/tests/dashboard/illustrations.cjs",
    "scripts/tests/dashboard/incident-details.cjs",
    "scripts/tests/dashboard/incidents.cjs",
    "scripts/tests/dashboard/information.cjs",
    "scripts/tests/dashboard/maps.cjs",
    "scripts/tests/dashboard/series-and-zones.cjs",
    "scripts/tests/dashboard/summaries.cjs",
    "scripts/tests/dashboard/timezones.cjs",
    "scripts/tests/dashboard/transport.cjs",
    "scripts/tests/dashboard/variable-signs.cjs",
    "scripts/tests/fixtures/core.cjs",
    "scripts/tests/fixtures/history.cjs",
    "scripts/tests/fixtures/information.cjs",
    "scripts/tests/fixtures/maps.cjs",
    "scripts/tests/fixtures/related-work.cjs",
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
    base = os.environ["PR_BASE_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", base):
        raise ValueError("PR base must be a full commit SHA")
    diff = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "-z", base, "HEAD"],
        check=True, capture_output=True,
    )
    paths = diff.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    return requires_mutation(path for path in paths if path)


if __name__ == "__main__":
    print(f"required={str(mutation_required()).lower()}")
