import os
import subprocess
import unittest
from unittest.mock import patch
from browser_scope import browser_required, required


class BrowserScopeTest(unittest.TestCase):
    def test_only_reviewed_documentation_can_omit_execution(self):
        self.assertFalse(browser_required(['README.md', 'docs/ci-cd-pipeline.md']))
        for path in ['scripts/tests/browser/specs/new.spec.ts', 'api-service/src/main/resources/static/dashboard/index.html',
                     'ingest-service/src/main/java/New.java', '.github/workflows/ci.yml', 'unknown-file', 'package-lock.json']:
            with self.subTest(path=path):
                self.assertTrue(browser_required(['docs/plan.md', path]))

    def test_main_and_manual_runs_always_execute(self):
        for event in ['push', 'workflow_dispatch']:
            with patch.dict(os.environ, {'GITHUB_EVENT_NAME': event}):
                self.assertTrue(required())

    def test_invalid_pr_or_failed_diff_cannot_omit_tests(self):
        with patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'pull_request'}), \
             patch('browser_scope.pull_request_base', side_effect=ValueError('invalid merge')):
            with self.assertRaises(ValueError):
                required()
        with patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'pull_request'}), \
             patch('browser_scope.pull_request_base', return_value='base'), \
             patch('browser_scope.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'git')):
            with self.assertRaises(subprocess.CalledProcessError):
                required()
