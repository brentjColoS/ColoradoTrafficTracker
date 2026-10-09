import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from delivery_boundary import MARKER, base_marker, marker_branch, verify_boundary


CONTENT = '{"base_branch":"experiment/dashboard-reconstruction"}'
BASE = "a" * 40


class DeliveryBoundaryTest(unittest.TestCase):
    def verify(self, current, original, event="pull_request", base_ref="main"):
        with patch.dict(os.environ, {
            "GITHUB_EVENT_NAME": event, "PR_BASE_SHA": BASE,
            "PR_BASE_REF": base_ref, "GITHUB_REF_NAME": base_ref,
        }, clear=True), patch("delivery_boundary.Path.exists", return_value=current is not None), \
            patch("delivery_boundary.Path.read_text", return_value=current), \
            patch("delivery_boundary.base_marker", return_value=original):
            verify_boundary()

    def test_ordinary_main_pr_remains_allowed(self):
        self.verify(None, None)

    def test_experimental_pr_requires_its_destination(self):
        self.verify(CONTENT, CONTENT, base_ref="experiment/dashboard-reconstruction")
        with self.assertRaisesRegex(ValueError, "must target"):
            self.verify(CONTENT, None)

    def test_removing_marker_does_not_bypass_destination(self):
        with self.assertRaisesRegex(ValueError, "cannot remove"):
            self.verify(None, CONTENT)
        with self.assertRaisesRegex(ValueError, "cannot remove"):
            self.verify(None, CONTENT, base_ref="experiment/dashboard-reconstruction")

    def test_topic_cannot_retarget_integration(self):
        with self.assertRaisesRegex(ValueError, "cannot change"):
            self.verify('{"base_branch":"experiment/other"}', CONTENT)

    def test_production_push_rejects_marked_tree(self):
        with self.assertRaisesRegex(ValueError, "production push"):
            self.verify(CONTENT, None, event="push")
        self.verify(CONTENT, None, event="push", base_ref="experiment/dashboard-reconstruction")

    def test_manual_topic_validation_is_not_deployment(self):
        self.verify(CONTENT, None, event="workflow_dispatch", base_ref="feature/example")

    def test_unknown_marked_event_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "Unknown event"):
            self.verify(CONTENT, None, event="unknown")

    def test_invalid_markers_cannot_authorize_main(self):
        for content in ['{}', '[]', '{"base_branch":"main"}',
                        '{"base_branch":null}', '{"base_branch":"experiment/a","extra":true}',
                        '{"base_branch":"experiment/a; echo bad"}', 'not json']:
            with self.subTest(content=content), self.assertRaises(ValueError):
                marker_branch(content)

    def test_missing_base_does_not_look_like_missing_marker(self):
        with self.assertRaises(ValueError):
            base_marker("invalid")
        with patch("delivery_boundary.subprocess.run", side_effect=subprocess.CalledProcessError(1, "git")):
            with self.assertRaises(subprocess.CalledProcessError):
                base_marker(BASE)

    def test_base_marker_survives_worktree_deletion(self):
        with TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.run(["git", "-C", directory, *args],
                                      check=True, capture_output=True, text=True).stdout.strip()
            git("init", "-q")
            git("config", "user.name", "CI tests")
            git("config", "user.email", "tests@example.invalid")
            marker = Path(directory) / MARKER
            marker.parent.mkdir()
            marker.write_text(CONTENT)
            git("add", ".")
            git("commit", "-qm", "Mark integration")
            revision = git("rev-parse", "HEAD")
            marker.unlink()
            with patch.dict(os.environ, {"GIT_DIR": str(Path(directory) / ".git"),
                                         "GIT_WORK_TREE": directory}):
                self.assertEqual(base_marker(revision), CONTENT)


if __name__ == "__main__":
    unittest.main()
