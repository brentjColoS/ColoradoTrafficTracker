import hashlib
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import signal
import sys
from tempfile import TemporaryDirectory
import unittest
import time
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('dashboard_assets', Path(__file__).parents[1] / 'verify-dashboard-assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class DashboardAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.jar = Path(self.temp.name) / 'app.jar'
        self.css = 'body { color: green; }'
        self.js = [b'const first = "caf\xc3\xa9";', b'const second = first;']
        self.bundle = b''.join(script + b'\n;\n' for script in self.js)
        self.bundle_name = 'dashboard-scripts.js?v=' + hashlib.sha256(self.bundle).hexdigest()
        self.template = ('<html lang="en"><head><title>Traffic</title>'
            '<link rel="stylesheet" href="dashboard.css?v=reviewed">'
            '</head><body><h1>Current story</h1>'
            '<script src="one.js" defer></script><script src="two.js" defer></script></body></html>')
        with zipfile.ZipFile(self.jar, 'w') as jar:
            for name, body in [('index.html', self.template), ('dashboard.css', self.css),
                               ('one.js', self.js[0]), ('two.js', self.js[1])]:
                jar.writestr(assets.PREFIX + name, body)
        self.responses = {'index.html': self.template.encode(), 'dashboard.css?v=reviewed': self.css.encode(),
                          'one.js': self.js[0], 'two.js': self.js[1], self.bundle_name: self.bundle}

    def inline_page(self):
        return ('<html data-replay-enabled="false" lang="en"><head><title>Traffic</title>'
            '<style>\n' + self.css + '\n</style><script src="' + self.bundle_name + '" defer></script>\n'
            '<script id="dashboardBootstrap" type="application/json">{"fresh":true}</script>'
            '</head><body><h1>Current story</h1></body></html>').encode()

    def test_linked_and_inlined_packaged_pages_are_both_verified(self):
        self.assertTrue(assets.verify(self.jar)['packagedContractValid'])
        self.assertEqual(len(assets.verify(self.jar, self.responses.__getitem__)['checked']), 1)
        self.responses['index.html'] = self.inline_page()
        self.assertEqual(len(assets.verify(self.jar, self.responses.__getitem__)['checked']), 1)

    def test_preserved_absolute_asset_prefixes_remain_supported(self):
        template = self.template.replace('href="dashboard.css', 'href="/dashboard-old/dashboard.css') \
            .replace('src="one.js', 'src="/dashboard-old/one.js').replace('src="two.js', 'src="/dashboard-old/two.js')
        with zipfile.ZipFile(self.jar, 'w') as jar:
            for name, body in [('index.html', template), ('dashboard.css', self.css),
                               ('one.js', self.js[0]), ('two.js', self.js[1])]:
                jar.writestr(assets.PREFIX + name, body)
        self.responses['index.html'] = template.encode()
        self.assertTrue(assets.verify(self.jar, self.responses.__getitem__)['packagedContractValid'])

    def test_stale_or_missing_css_bundle_and_html_are_rejected(self):
        originals = dict(self.responses)
        cases = [('dashboard.css?v=reviewed', b'body {color:blue}'), ('one.js', b'old script'),
                 ('index.html', self.template.replace('Current story', 'Old story').encode()),
                 ('index.html', self.template.replace('<link rel="stylesheet" href="dashboard.css?v=reviewed">', '').encode())]
        for name, body in cases:
            with self.subTest(name=name, body=body):
                self.responses = dict(originals, **{name: body})
                with self.assertRaises(ValueError):
                    assets.verify(self.jar, self.responses.__getitem__)
        self.responses = dict(originals, **{'index.html': self.inline_page(), self.bundle_name: b'wrong bundle'})
        with self.assertRaisesRegex(ValueError, 'bundle bytes'):
            assets.verify(self.jar, self.responses.__getitem__)

    def test_wrong_inline_css_and_reordered_or_stale_bundle_cannot_pass(self):
        for body in [self.inline_page().replace(b'green', b'blue'),
                     self.inline_page().replace(self.bundle_name.encode(), b'dashboard-scripts.js?v=old')]:
            self.responses['index.html'] = body
            with self.assertRaises(ValueError):
                assets.verify(self.jar, self.responses.__getitem__)
        self.responses['index.html'] = self.inline_page()
        self.responses[self.bundle_name] = b''.join(script+b'\n;\n' for script in reversed(self.js))
        with self.assertRaises(ValueError):
            assets.verify(self.jar, self.responses.__getitem__)

    def test_script_closing_whitespace_cannot_hide_executable_html(self):
        self.responses['index.html'] = self.inline_page().replace(
            b'{"fresh":true}</script>', b'{"fresh":true}</script ><script>alert(1)</script>')
        with self.assertRaises(ValueError):
            assets.verify(self.jar, self.responses.__getitem__)
        self.responses['index.html'] = self.inline_page().replace(
            b'type="application/json"', b'type="text/javascript"')
        with self.assertRaisesRegex(ValueError, 'non-executable JSON'):
            assets.verify(self.jar, self.responses.__getitem__)

    def test_traversal_credentials_and_redirects_are_rejected(self):
        for name in ['../secret.js', '/other/secret.js', 'vendor/../../secret.css']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                assets.local_asset(name)
        for origin in ['file:///tmp/', 'https://user:secret@example.invalid/dashboard/', 'https://example.invalid/?key=private']:
            with self.assertRaises(ValueError):
                assets.http_reader(origin)
        with self.assertRaisesRegex(ValueError, 'redirected'):
            assets.NoRedirect().redirect_request(None, None, None, None, None, None)

    def test_audit_container_never_starts_and_is_removed_after_copy_failure(self):
        identity = 'a'*64
        with patch.object(assets.subprocess, 'check_output', return_value=identity) as lookup, \
                patch.object(assets.subprocess, 'run', side_effect=[None, subprocess.CalledProcessError(1, 'cp'),
                    subprocess.CompletedProcess([], 0)]) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                with assets.image_jar('checked-image', 'docker'):
                    self.fail('A failed copy cannot reach verification')
            self.assertEqual(run.call_args_list[-1].args[0], ['docker', 'rm', identity])
            create = run.call_args_list[0].args[0]
            name = create[create.index('--name')+1]
            self.assertEqual(create[-4:], ['--network', 'none', '--read-only', 'checked-image'])
            self.assertIn('io.coloradotraffictracker.audit-owner='+name, create)
            self.assertIn('name=^/'+name+'$', lookup.call_args.args[0])
            self.assertIn('label=io.coloradotraffictracker.audit-owner='+name, lookup.call_args.args[0])

    def test_cleanup_failure_cannot_replace_the_original_failure(self):
        with patch.object(assets.subprocess, 'check_output', return_value='a'*64), \
                patch.object(assets.subprocess, 'run', side_effect=[None, subprocess.CalledProcessError(1, 'cp'),
                    subprocess.CompletedProcess([], 9)]), contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(subprocess.CalledProcessError) as failure:
                with assets.image_jar('checked-image', 'docker'):
                    self.fail('A failed copy cannot reach verification')
            self.assertEqual(failure.exception.cmd, 'cp')
            self.assertIn('Audit cleanup could not be confirmed', errors.getvalue())

    def test_create_timeout_after_daemon_success_still_removes_owned_container(self):
        for failure in [subprocess.TimeoutExpired('create', 20), subprocess.CalledProcessError(1, 'create')]:
            with self.subTest(failure=type(failure).__name__), \
                    patch.object(assets.subprocess, 'check_output', return_value='a'*64), \
                    patch.object(assets.subprocess, 'run', side_effect=[failure, subprocess.CompletedProcess([], 0)]) as run:
                with self.assertRaises(type(failure)):
                    with assets.image_jar('checked-image', 'docker'):
                        self.fail('Failed creation cannot reach verification')
                self.assertEqual(run.call_args_list[-1].args[0], ['docker', 'rm', 'a'*64])

    def test_failed_creation_without_an_owned_container_never_removes_other_resources(self):
        with patch.object(assets.subprocess, 'check_output', return_value=''), \
                patch.object(assets.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'create')) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                with assets.image_jar('checked-image', 'docker'): pass
            self.assertEqual(run.call_count, 1)

    def test_cleanup_failure_after_success_cannot_pass_silently(self):
        with patch.object(assets.subprocess, 'check_output', return_value='a'*64), \
                patch.object(assets.subprocess, 'run', side_effect=[None, None, subprocess.CompletedProcess([], 9)]):
            with self.assertRaisesRegex(ValueError, 'cleanup could not be confirmed'):
                with assets.image_jar('checked-image', 'docker'): pass

    def test_lost_removal_acknowledgement_is_not_a_false_failure(self):
        for removal in [subprocess.CompletedProcess([], 9), subprocess.TimeoutExpired('rm', 10)]:
            with self.subTest(removal=type(removal).__name__), \
                    patch.object(assets.subprocess, 'check_output', side_effect=['a'*64, '']), \
                    patch.object(assets.subprocess, 'run', side_effect=[None, None, removal]):
                with assets.image_jar('checked-image', 'docker'): pass

    def test_ambiguous_owned_identity_never_removes_any_container(self):
        with patch.object(assets.subprocess, 'check_output', return_value='a'*64+'\n'+'b'*64), \
                patch.object(assets.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Unexpected owned audit identity'):
                with assets.image_jar('checked-image', 'docker'): pass
            self.assertEqual([call.args[0][1] for call in run.call_args_list], ['create', 'cp'])

    def test_lookup_failure_preserves_the_creation_error(self):
        with patch.object(assets.subprocess, 'check_output', side_effect=subprocess.TimeoutExpired('ps', 10)), \
                patch.object(assets.subprocess, 'run', side_effect=subprocess.CalledProcessError(17, 'create')) as run, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(subprocess.CalledProcessError) as failure:
                with assets.image_jar('checked-image', 'docker'): pass
            self.assertEqual(failure.exception.returncode, 17)
            self.assertEqual(run.call_count, 1)
            self.assertIn('Inspect only this labelled container', errors.getvalue())

    def test_termination_during_creation_runs_cleanup_without_a_traceback(self):
        docker = Path(self.temp.name) / 'docker'
        state = Path(self.temp.name) / 'owned.json'
        ready = state.with_suffix('.ready')
        docker.write_text('''#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
state = Path(os.environ['TEST_AUDIT_STATE'])
if sys.argv[1] == 'create':
    state.write_text(json.dumps(sys.argv[sys.argv.index('--name')+1]))
    state.with_suffix('.ready').touch()
    time.sleep(30)
elif sys.argv[1] == 'ps' and state.exists():
    name = json.loads(state.read_text())
    if 'name=^/'+name+'$' in sys.argv and 'label=io.coloradotraffictracker.audit-owner='+name in sys.argv: print('a'*64)
elif sys.argv[1] == 'rm': state.unlink()
''')
        docker.chmod(0o700)
        process = subprocess.Popen([sys.executable, str(Path(__file__).parents[1] / 'verify-dashboard-assets.py'),
            '--image', 'review-image', '--docker', str(docker)],
            env=dict(os.environ, TEST_AUDIT_STATE=str(state)), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic()+5
            while not ready.exists() and time.monotonic() < deadline: time.sleep(0.02)
            self.assertTrue(ready.exists(), 'Audit creation did not reach daemon fixture')
            process.send_signal(signal.SIGTERM)
            _, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 143, stderr)
            self.assertFalse(state.exists())
            self.assertNotIn('Traceback', stderr)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_cli_reports_one_actionable_failure_without_a_traceback(self):
        result = subprocess.run([sys.executable, str(Path(__file__).parents[1] / 'verify-dashboard-assets.py'),
            '--jar', str(Path(self.temp.name) / 'missing.jar')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Dashboard asset verification failed:', result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_missing_index_and_oversized_http_response_fail(self):
        empty = Path(self.temp.name) / 'empty.jar'
        with zipfile.ZipFile(empty, 'w'):
            pass
        with self.assertRaisesRegex(ValueError, 'index'):
            assets.verify(empty)
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read1.return_value = b'x' * (assets.LIMIT+1)
        opener = unittest.mock.Mock()
        opener.open.return_value = response
        with patch.object(assets.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(ValueError, 'size bound'):
                assets.http_reader('http://127.0.0.1/dashboard/')('index.html')
