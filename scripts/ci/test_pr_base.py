import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from delivery_boundary import verify_boundary
from mutation_scope import mutation_required
from pr_base import pull_request_base


class PullRequestBaseTest(unittest.TestCase):
    def test_shallow_merge_uses_tested_base_after_event_base_moves(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / 'source'
            source.mkdir()

            def git(repo, *args):
                return subprocess.run(['git', '-C', str(repo), *args], check=True,
                                      capture_output=True, text=True).stdout.strip()

            git(source, 'init', '-q', '-b', 'main')
            git(source, 'config', 'user.name', 'CI tests')
            git(source, 'config', 'user.email', 'tests@example.invalid')
            (source / 'README.md').write_text('base')
            git(source, 'add', '.')
            git(source, 'commit', '-qm', 'Initial base')
            stale_base = git(source, 'rev-parse', 'HEAD')
            git(source, 'checkout', '-qb', 'topic')
            (source / 'README.md').write_text('topic')
            git(source, 'commit', '-qam', 'Update documentation')
            head = git(source, 'rev-parse', 'HEAD')
            git(source, 'checkout', '-q', 'main')
            marker = source / '.github/experimental-integration.json'
            marker.parent.mkdir()
            marker.write_text('{"base_branch":"experiment/dashboard-reconstruction"}')
            git(source, 'add', '.')
            git(source, 'commit', '-qm', 'Advance integration')
            base = git(source, 'rev-parse', 'HEAD')
            git(source, 'merge', '--no-ff', '-qm', 'Test merge', 'topic')
            merge = git(source, 'rev-parse', 'HEAD')
            checkout = Path(directory) / 'checkout'
            subprocess.run(['git', 'clone', '-q', '--depth=2', source.as_uri(), str(checkout)], check=True)
            self.assertEqual(git(checkout, 'rev-parse', '--is-shallow-repository'), 'true')
            self.assertNotEqual(subprocess.run(['git', '-C', str(checkout), 'cat-file', '-e', stale_base],
                                              capture_output=True).returncode, 0)
            with patch.dict(os.environ, {
                'GIT_DIR': str(checkout / '.git'), 'GIT_WORK_TREE': str(checkout),
                'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_SHA': merge,
                'GITHUB_REF': 'refs/pull/1/merge', 'PR_HEAD_SHA': head,
                'PR_BASE_SHA': stale_base, 'PR_BASE_REF': 'experiment/dashboard-reconstruction',
            }, clear=True):
                self.assertEqual(pull_request_base(), base)
                self.assertFalse(mutation_required(), 'New base marker is not a topic change')
                with patch('delivery_boundary.Path', return_value=marker):
                    verify_boundary()
                with patch.dict(os.environ, {'PR_BASE_REF': 'main'}), \
                        patch('delivery_boundary.Path', return_value=marker):
                    with self.assertRaisesRegex(ValueError, 'must target'):
                        verify_boundary()
                marker.unlink()
                with patch('delivery_boundary.Path', return_value=marker):
                    with self.assertRaisesRegex(ValueError, 'cannot remove'):
                        verify_boundary()

    def test_wrong_checkout_or_head_cannot_authorize_a_scope_decision(self):
        merge, head, base = 'a' * 40, 'b' * 40, 'c' * 40
        environment = {'GITHUB_SHA': merge, 'PR_HEAD_SHA': head, 'GITHUB_REF': 'refs/pull/1/merge'}
        cases = [
            [head],
            [merge, base],
            [merge, f'{base} {merge}'],
            [merge, f'{base} {head} {merge}'],
        ]
        for outputs in cases:
            results = [subprocess.CompletedProcess([], 0, stdout=value) for value in outputs]
            with self.subTest(outputs=outputs), patch.dict(os.environ, environment, clear=True), \
                    patch('pr_base.subprocess.run', side_effect=results):
                with self.assertRaises(ValueError):
                    pull_request_base()

    def test_missing_history_and_invalid_inputs_fail_closed(self):
        environment = {'GITHUB_SHA': 'a' * 40, 'PR_HEAD_SHA': 'b' * 40, 'GITHUB_REF': 'refs/pull/1/merge'}
        with patch.dict(os.environ, environment, clear=True), \
                patch('pr_base.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'git')):
            with self.assertRaises(subprocess.CalledProcessError):
                pull_request_base()
        for overrides in [{'GITHUB_SHA': 'invalid'}, {'PR_HEAD_SHA': 'invalid'}, {'GITHUB_REF': 'refs/heads/topic'}]:
            with self.subTest(overrides=overrides), patch.dict(os.environ, environment | overrides, clear=True):
                with self.assertRaises(ValueError):
                    pull_request_base()
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(KeyError):
            pull_request_base()


if __name__ == '__main__':
    unittest.main()
