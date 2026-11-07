"""Select whole-module PIT gates conservatively from the tested PR merge."""

import os
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
import subprocess

from pr_base import pull_request_base

FRONTEND_TEST_PATHS = frozenset({
    "scripts/tests/dashboard.test.cjs",
    "scripts/tests/dashboard-preview.cjs",
    "scripts/tests/flow-diagram.test.cjs",
    "scripts/tests/stored-observations.test.cjs",
    "scripts/tests/traffic-estimates.test.cjs",
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


MODULES = frozenset({"common", "routes-service", "ingest-service", "api-service"})
OUTPUTS = {"common": "common", "routes": "routes-service",
           "ingest": "ingest-service", "api": "api-service"}
# Routes has HTTP consumers in both services, beyond the Maven dependency graph.
SERVICE_IMPACT = {
    "api-service": frozenset({"api-service"}),
    "ingest-service": frozenset({"ingest-service"}),
    "routes-service": MODULES - {"common"},
}


def mutation_modules(paths):
    selected = set()
    for path in paths:
        documentation = path.startswith("docs/") or (
            "/" not in path and PurePosixPath(path).suffix == ".md"
        )
        dashboard = path.startswith("api-service/src/main/resources/static/")
        if documentation or dashboard or path in FRONTEND_TEST_PATHS:
            continue
        parts = PurePosixPath(path).parts
        java = (len(parts) >= 5 and parts[1:4] in (
            ("src", "main", "java"), ("src", "test", "java"))
            and path.endswith(".java") and ".." not in parts)
        if java and parts[0] in SERVICE_IMPACT:
            selected.update(SERVICE_IMPACT[parts[0]])
        else:
            return MODULES
    return frozenset(selected)


def requires_mutation(paths):
    return bool(mutation_modules(paths))


def known_module_layout(root):
    ns = {"m": "http://maven.apache.org/POM/4.0.0"}

    def reactor_dependencies(pom):
        return {
            node.findtext("m:artifactId", namespaces=ns)
            for node in pom.findall(".//m:dependencies/m:dependency", ns)
            if (node.findtext("m:groupId", namespaces=ns) == "com.example"
                or node.findtext("m:artifactId", namespaces=ns) in MODULES)
        }

    parent = ET.parse(root / "pom.xml")
    modules = {node.text for node in parent.findall(".//m:modules/m:module", ns)}
    if modules != MODULES:
        return False
    if reactor_dependencies(parent):
        return False
    for module in modules:
        dependencies = reactor_dependencies(ET.parse(root / module / "pom.xml"))
        if dependencies != (set() if module == "common" else {"common"}):
            return False
    return True


def selected_modules():
    if os.environ.get("GITHUB_EVENT_NAME") != "pull_request":
        return MODULES
    base = pull_request_base()
    diff = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "-z", base, "HEAD"],
        check=True, capture_output=True,
    )
    paths = diff.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    if not known_module_layout(Path(__file__).resolve().parents[2]):
        return MODULES
    return mutation_modules(path for path in paths if path)


def mutation_required():
    return bool(selected_modules())


def scope_outputs(modules):
    return {"required": str(bool(modules)).lower(), **{
        output: str(module in modules).lower() for output, module in OUTPUTS.items()
    }}


if __name__ == "__main__":
    modules = selected_modules()
    for output, value in scope_outputs(modules).items():
        print(f"{output}={value}")
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a") as report:
            report.write("## Mutation scope\n\n| Module | PIT selected |\n| --- | --- |\n")
            for module in sorted(MODULES):
                report.write(f"| {module} | {'yes' if module in modules else 'no'} |\n")
            report.write("\nSelected modules run their complete existing mutation scope. "
                         "Full Maven verification and packaging always run.\n")
