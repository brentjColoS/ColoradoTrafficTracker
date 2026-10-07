import os
from pathlib import Path
import subprocess
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

from mutation_scope import mutation_required, requires_mutation


class MutationScopeTest(unittest.TestCase):
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

    def test_main_and_manual_runs_always_require_mutation(self):
        for event in ["push", "workflow_dispatch", "unknown"]:
            with self.subTest(event=event), patch.dict(os.environ, {"GITHUB_EVENT_NAME": event}):
                self.assertTrue(mutation_required())

    def test_pr_diff_uses_nul_delimiters_for_unusual_filenames(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request", "PR_BASE_SHA": "a" * 40}):
            result = subprocess.CompletedProcess([], 0, stdout=b"docs/a\nfile.md\0")
            with patch("mutation_scope.subprocess.run", return_value=result):
                self.assertFalse(mutation_required())
            result.stdout += b"pom.xml\0"
            with patch("mutation_scope.subprocess.run", return_value=result):
                self.assertTrue(mutation_required())

    def test_diff_failure_does_not_authorize_skipping(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request", "PR_BASE_SHA": "a" * 40}):
            with patch("mutation_scope.subprocess.run", side_effect=subprocess.CalledProcessError(1, "git")):
                with self.assertRaises(subprocess.CalledProcessError):
                    mutation_required()

    def test_missing_or_invalid_base_does_not_authorize_skipping(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request", "PR_BASE_SHA": "invalid"}):
            with self.assertRaises(ValueError):
                mutation_required()
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request"}, clear=True):
            with self.assertRaises(KeyError):
                mutation_required()

    def test_moving_java_into_documentation_still_requires_mutation(self):
        with TemporaryDirectory() as directory:
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
            (repo / "docs").mkdir()
            source.rename(repo / "docs/Example.md")
            git("add", "-A")
            git("commit", "-qm", "Move source into docs")
            with patch.dict(os.environ, {
                "GITHUB_EVENT_NAME": "pull_request", "PR_BASE_SHA": base,
                "GIT_DIR": str(repo / ".git"), "GIT_WORK_TREE": directory,
            }):
                self.assertTrue(mutation_required())
