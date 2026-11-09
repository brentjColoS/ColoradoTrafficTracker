import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

from mutation_scope import (MODULES, known_module_layout, mutation_modules,
                            mutation_required, requires_mutation, scope_outputs, selected_modules)


class MutationScopeTest(unittest.TestCase):
    def test_api_source_and_tests_select_all_api_shards_only(self):
        self.assertEqual(mutation_modules([
            "api-service/src/main/java/com/example/api_service/Controller.java",
            "api-service/src/test/java/com/example/api_service/ControllerTest.java",
            "docs/api.md",
        ]), {"api-service"})

    def test_audited_browser_cases_do_not_repeat_java_mutations(self):
        self.assertFalse(requires_mutation([
            "scripts/tests/browser/specs/history.spec.ts",
            "scripts/tests/browser/fixtures/dashboard.ts",
            "scripts/tests/browser/specs/visual.spec.ts-snapshots/chart-range-chromium-linux.png",
        ]))
        for path in ["scripts/tests/browser/specs/new.spec.ts", "scripts/tests/browser/package-lock.json",
                     "scripts/tests/browser/playwright.config.ts", "scripts/tests/browser/support/api-runtime.ts"]:
            with self.subTest(path=path):
                self.assertTrue(requires_mutation([path]))

    def test_ingestion_source_and_tests_select_the_complete_ingest_gate(self):
        for path in ["ingest-service/src/main/java/Helper.java",
                     "ingest-service/src/test/java/HelperTest.java"]:
            with self.subTest(path=path):
                self.assertEqual(mutation_modules([path]), {"ingest-service"})

    def test_routes_changes_include_its_http_consumers(self):
        self.assertEqual(mutation_modules(["routes-service/src/main/java/Routes.java"]),
                         {"routes-service", "api-service", "ingest-service"})

    def test_shared_build_resources_and_unknown_inputs_select_every_gate(self):
        for path in ["common/src/main/java/Geometry.java", "common/src/test/java/GeometryTest.java",
                     "api-service/pom.xml", "pom.xml", "api-service/src/main/resources/application.yml",
                     "ingest-service/src/test/resources/fixture.json", ".github/workflows/ci.yml",
                     "new-service/src/main/java/New.java", "scripts/ci/mutation_scope.py",
                     "api-service/src/main/java/../../../common/Shared.java",
                     "ingest-service/src/main/java/fixture.json"]:
            with self.subTest(path=path):
                self.assertEqual(mutation_modules(["api-service/src/main/java/Api.java", path]), MODULES)

    def test_mixed_service_changes_take_the_union(self):
        self.assertEqual(mutation_modules([
            "api-service/src/main/java/Api.java", "ingest-service/src/main/java/Ingest.java",
            "scripts/tests/dashboard/maps.cjs",
        ]), {"api-service", "ingest-service"})

    def test_scope_outputs_distinguish_api_aggregation_from_other_modules(self):
        self.assertEqual(scope_outputs({"ingest-service"}), {
            "required": "true", "common": "false", "routes": "false",
            "ingest": "true", "api": "false",
        })
        self.assertEqual(set(scope_outputs(MODULES).values()), {"true"})
        self.assertEqual(set(scope_outputs(set()).values()), {"false"})

    def test_layout_guard_recognizes_current_reactor_and_rejects_new_dependencies(self):
        root = Path(__file__).resolve().parents[2]
        self.assertTrue(known_module_layout(root))
        with TemporaryDirectory() as directory:
            copy = Path(directory)
            for pom in ["pom.xml", *(module + "/pom.xml" for module in MODULES)]:
                destination = copy / pom
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(root / pom, destination)
            for module in ["api-service", "ingest-service"]:
                pom = copy / module / "pom.xml"
                original = pom.read_text()
                pom.write_text(original.replace("<artifactId>common</artifactId>",
                                                "<artifactId>routes-service</artifactId>"))
                self.assertFalse(known_module_layout(copy))
                pom.write_text(original)
            pom = copy / "pom.xml"
            original = pom.read_text()
            pom.write_text(original.replace("</modules>", "<module>new-service</module></modules>"))
            self.assertFalse(known_module_layout(copy))
            pom.write_text(original.replace("<dependencies>", """<dependencies>
                <dependency><groupId>com.example</groupId><artifactId>api-service</artifactId></dependency>
                """, 1))
            self.assertFalse(known_module_layout(copy))

    def test_unknown_dependency_layout_cannot_select_fewer_jobs(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request"}), \
                patch("mutation_scope.pull_request_base", return_value="a" * 40), \
                patch("mutation_scope.known_module_layout", return_value=False), \
                patch("mutation_scope.subprocess.run", return_value=subprocess.CompletedProcess(
                    [], 0, stdout=b"api-service/src/main/java/Api.java\0")):
            self.assertEqual(selected_modules(), MODULES)

    def test_cli_selects_api_only_from_an_actual_pr_merge_and_writes_the_summary(self):
        with TemporaryDirectory() as directory:
            repo = Path(directory)
            def git(*args):
                return subprocess.run(["git", "-C", directory, *args], check=True,
                                      capture_output=True, text=True).stdout.strip()
            git("init", "-q", "-b", "base")
            git("config", "user.name", "CI tests")
            git("config", "user.email", "tests@example.invalid")
            source = repo / "api-service/src/main/java/Example.java"
            source.parent.mkdir(parents=True)
            source.write_text("class Example {}")
            git("add", ".")
            git("commit", "-qm", "Initial source")
            git("checkout", "-qb", "topic")
            source.write_text("class Example { int value; }")
            git("commit", "-qam", "Change API source")
            head = git("rev-parse", "HEAD")
            git("checkout", "-q", "base")
            git("merge", "--no-ff", "-qm", "Tested PR merge", "topic")
            summary = repo / "summary.md"
            env = dict(os.environ, GITHUB_EVENT_NAME="pull_request",
                       GITHUB_SHA=git("rev-parse", "HEAD"), PR_HEAD_SHA=head,
                       GITHUB_REF="refs/pull/123/merge", GITHUB_STEP_SUMMARY=str(summary),
                       GIT_DIR=str(repo / ".git"), GIT_WORK_TREE=directory)
            result = subprocess.run(
                [sys.executable, "-B", str(Path(__file__).with_name("mutation_scope.py"))],
                cwd=directory, env=env, check=True, capture_output=True, text=True)
            self.assertEqual(dict(line.split("=", 1) for line in result.stdout.splitlines()), {
                "required": "true", "common": "false", "routes": "false",
                "ingest": "false", "api": "true",
            })
            self.assertIn("| api-service | yes |", summary.read_text())
            self.assertIn("| ingest-service | no |", summary.read_text())

    def test_documentation_and_static_assets_do_not_change_java_mutations(self):
        self.assertFalse(requires_mutation([
            "README.md", "docs/operations.md",
            "api-service/src/main/resources/static/dashboard/dashboard.js",
            "api-service/src/main/resources/static/dashboard/dashboard.css",
        ]))

    def test_java_and_build_inputs_always_require_mutation(self):
        for path in [
            "common/src/main/java/Shared.java", "api-service/src/test/java/ApiTest.java",
            "ingest-service/src/main/resources/application.yml",
            "pom.xml", "routes-service/pom.xml", "mvnw",
            ".mvn/wrapper/maven-wrapper.properties", ".github/workflows/ci.yml",
            "scripts/ci/mutation_scope.py", "unknown-file",
        ]:
            with self.subTest(path=path):
                self.assertTrue(requires_mutation(["docs/notes.md", path]))

    def test_known_frontend_tests_do_not_change_java_mutations(self):
        self.assertFalse(requires_mutation([
            "api-service/src/main/resources/static/dashboard/dashboard.js",
            "scripts/tests/dashboard.test.cjs",
            "scripts/tests/dashboard-preview.cjs",
            "scripts/tests/flow-diagram.test.cjs",
            "scripts/tests/stored-observations.test.cjs",
            "scripts/tests/traffic-estimates.test.cjs",
        ]))

    def test_organized_frontend_suites_and_fixtures_are_recognized(self):
        tests = Path(__file__).resolve().parents[1] / "tests"
        paths = ["scripts/tests/dashboard-batch-fixture.cjs"]
        for directory in ["dashboard", "fixtures"]:
            paths.extend("scripts/tests/" + directory + "/" + file.name
                         for file in (tests / directory).glob("*.cjs"))
        for path in paths:
            with self.subTest(path=path):
                self.assertFalse(requires_mutation([
                    "api-service/src/main/resources/static/dashboard/dashboard.js", path,
                ]))

    def test_frontend_tests_never_hide_java_or_unknown_changes(self):
        for path in [
            "api-service/src/main/java/Example.java",
            "api-service/src/test/java/ExampleTest.java",
            "scripts/tests/unknown.cjs", "scripts/tests/dashboard.test.cjs.extra",
            "scripts/tests/historical-incident-sql.test.cjs", ".node-version",
            "scripts/tests/dashboard/unreviewed.cjs", "scripts/tests/fixtures/unreviewed.cjs",
            "scripts/tests/fixtures/core.java", "scripts/tests/fixtures/core.cjs.extra",
            "scripts/tests/dashboard/../../ci/mutation_scope.py",
            "scripts/tests/nested/dashboard.test.cjs", "scripts/ci/test_mutation_scope.py",
            "scripts/start-historical-replay.sh", ".github/workflows/ci.yml",
        ]:
            with self.subTest(path=path):
                self.assertTrue(requires_mutation([
                    "scripts/tests/dashboard.test.cjs",
                    "scripts/tests/dashboard-preview.cjs",
                    "scripts/tests/dashboard/maps.cjs", "scripts/tests/fixtures/core.cjs", path,
                ]))

    def test_main_and_manual_runs_always_require_mutation(self):
        for event in ["push", "workflow_dispatch", "unknown"]:
            with self.subTest(event=event), patch.dict(os.environ, {"GITHUB_EVENT_NAME": event}):
                self.assertEqual(selected_modules(), MODULES)

    def test_pr_diff_uses_nul_delimiters_for_unusual_filenames(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request"}), \
                patch("mutation_scope.pull_request_base", return_value="a" * 40):
            result = subprocess.CompletedProcess([], 0, stdout=b"docs/a\nfile.md\0")
            with patch("mutation_scope.subprocess.run", return_value=result):
                self.assertFalse(mutation_required())
            result.stdout += b"pom.xml\0"
            with patch("mutation_scope.subprocess.run", return_value=result):
                self.assertTrue(mutation_required())

    def test_diff_failure_does_not_authorize_skipping(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request"}), \
                patch("mutation_scope.pull_request_base", return_value="a" * 40):
            with patch("mutation_scope.subprocess.run", side_effect=subprocess.CalledProcessError(1, "git")):
                with self.assertRaises(subprocess.CalledProcessError):
                    mutation_required()

    def test_invalid_merge_checkout_does_not_authorize_skipping(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request"}), \
                patch("mutation_scope.pull_request_base", side_effect=ValueError("Invalid merge")):
            with self.assertRaises(ValueError):
                mutation_required()

    def test_moves_select_source_and_destination_modules_even_when_git_detects_a_rename(self):
        for target, expected in [
            ("docs/Example.md", {"api-service"}),
            ("scripts/tests/dashboard/controls.cjs", {"api-service"}),
            ("ingest-service/src/main/java/Example.java", {"api-service", "ingest-service"}),
            ("common/src/main/java/Example.java", MODULES),
        ]:
            with self.subTest(target=target), TemporaryDirectory() as directory:
                repo = Path(directory)
                def git(*args):
                    result = subprocess.run(
                        ["git", "-C", directory, *args],
                        check=True, capture_output=True, text=True,
                    )
                    return result.stdout.strip()
                git("init", "-q")
                git("config", "user.name", "CI tests")
                git("config", "user.email", "tests@example.invalid")
                source = repo / "api-service/src/main/java/Example.java"
                source.parent.mkdir(parents=True)
                source.write_text("class Example {}")
                git("add", ".")
                git("commit", "-qm", "Add Java source")
                base = git("rev-parse", "HEAD")
                destination = repo / target
                destination.parent.mkdir(parents=True)
                source.rename(destination)
                git("add", "-A")
                git("commit", "-qm", "Move source into allowed path")
                with patch.dict(os.environ, {
                    "GITHUB_EVENT_NAME": "pull_request",
                    "GIT_DIR": str(repo / ".git"), "GIT_WORK_TREE": directory,
                }), patch("mutation_scope.pull_request_base", return_value=base):
                    self.assertEqual(selected_modules(), expected)
