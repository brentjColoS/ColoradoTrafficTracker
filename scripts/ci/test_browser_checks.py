import http.server
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
from tempfile import TemporaryDirectory
import threading
import time
import unittest


RUNNER = Path(__file__).with_name('browser-checks.sh')


class BrowserChecksTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="ctt-browser-'")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        runner = self.root / 'scripts/ci/browser-checks.sh'
        runner.parent.mkdir(parents=True)
        shutil.copyfile(RUNNER, runner)
        self.runner = runner
        package = self.root / 'scripts/tests/browser/node_modules/@playwright/test'
        package.mkdir(parents=True)
        self.package = package / 'package.json'
        self.package.write_text('{"version":"1.65.0"}')
        (package / 'cli.js').write_text('process.exit(Number(process.env.TEST_RESULT || 0));')
        binary = self.root / 'bin/docker'
        binary.parent.mkdir()
        binary.write_text('''#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
with open(os.environ['TEST_DOCKER_LOG'], 'a') as log:
    log.write(json.dumps(sys.argv[1:])+'\\n')
state = Path(os.environ['TEST_DOCKER_STATE'])
if sys.argv[1] == 'run' and '--detach' in sys.argv:
    if os.environ.get('TEST_CREATE_FAILURE') == 'before': sys.exit(17)
    name = sys.argv[sys.argv.index('--name')+1]
    owner = sys.argv[sys.argv.index('--label')+1]
    if os.environ.get('TEST_CREATE_FAILURE') == 'foreign': owner = 'another-owner'
    state.write_text(json.dumps({'name': name, 'owner': owner}))
    state.with_suffix('.ready').touch()
    if os.environ.get('TEST_CREATE_BLOCK') == 'true': time.sleep(30)
    if os.environ.get('TEST_CREATE_FAILURE') in ['after', 'foreign']: sys.exit(17)
    print('a'*64)
elif sys.argv[1] == 'ps':
    if os.environ.get('TEST_LOOKUP_FAILURE') == 'true': sys.exit(6)
    if os.environ.get('TEST_INVALID_ID') == 'true':
        print('a'*64+'\\n'+'b'*64)
        sys.exit(0)
    if state.exists():
        saved = json.loads(state.read_text())
        if 'name=^/'+saved['name']+'$' in sys.argv and 'label='+saved['owner'] in sys.argv: print('a'*64)
elif sys.argv[1] == 'rm':
    if os.environ.get('TEST_REMOVE_FAILURE') == 'true': sys.exit(9)
    state.unlink(missing_ok=True)
    if os.environ.get('TEST_REMOVE_ACK_LOST') == 'timeout': time.sleep(30)
    if os.environ.get('TEST_REMOVE_ACK_LOST') == 'true': sys.exit(9)
elif sys.argv[1] == 'port':
    print(os.environ['TEST_PORT'])
elif sys.argv[1] == 'run':
    sys.exit(int(os.environ.get('TEST_RESULT', '0')))
''')
        binary.chmod(0o700)
        self.log = self.root / 'docker.log'
        self.state = self.root / 'docker-state.json'
        self.environment = dict(os.environ, PATH=str(binary.parent)+os.pathsep+os.environ['PATH'],
                                TEST_DOCKER_LOG=str(self.log), TEST_DOCKER_STATE=str(self.state), TEST_RESULT='0')

    def run_mode(self, mode, **environment):
        return subprocess.run(['bash', str(self.runner), mode],
                              env=dict(self.environment, **environment),
                              capture_output=True, text=True, timeout=20)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_ui_uses_both_projects_and_keeps_failures(self):
        result = self.run_mode('ui', TEST_RESULT='7')
        self.assertEqual(result.returncode, 7, result.stderr)
        run = next(call for call in self.calls() if call[0] == 'run')
        self.assertIn('--project=chromium', run)
        self.assertIn('--project=mobile-chromium', run)
        self.assertNotIn('--update-snapshots', run)

    def test_visual_check_never_updates_references_implicitly(self):
        self.assertEqual(self.run_mode('visual').returncode, 0)
        self.assertNotIn('--update-snapshots', self.calls()[-1])
        self.assertEqual(self.run_mode('update-visual').returncode, 0)
        self.assertIn('--update-snapshots', self.calls()[-1])

    def test_package_image_mismatch_and_unknown_mode_fail_before_docker(self):
        self.package.write_text('{"version":"1.66.0"}')
        self.assertNotEqual(self.run_mode('ui').returncode, 0)
        self.assertFalse(self.log.exists())
        self.assertEqual(self.run_mode('unknown').returncode, 2)
        self.assertFalse(self.log.exists())

    def run_ready_api(self, **environment):
        class Ready(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"wsEndpointPath":"/"}')
            def log_message(self, *args):
                pass
        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Ready) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                result = self.run_mode('api', TEST_PORT=f'127.0.0.1:{server.server_port}', **environment)
            finally:
                server.shutdown()
                thread.join()
        return result

    def test_api_failure_removes_only_its_owned_loopback_browser(self):
        result = self.run_ready_api(TEST_RESULT='7')
        self.assertEqual(result.returncode, 7, result.stderr)
        start = next(call for call in self.calls() if '--detach' in call)
        self.assertIn('127.0.0.1::3000', start)
        self.assertIn(str(self.root)+':/work:ro', start)
        self.assertNotIn('/var/run/docker.sock:/var/run/docker.sock', start)
        self.assertEqual([call for call in self.calls() if call[0] == 'rm'], [['rm', '--force', 'a'*64]])

    def test_unexpected_public_browser_port_is_rejected_and_cleaned_up(self):
        result = self.run_mode('api', TEST_PORT='0.0.0.0:3000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('loopback-only', result.stderr)
        self.assertEqual(self.calls()[-1], ['rm', '--force', 'a'*64])

    def test_creation_error_after_daemon_success_still_removes_owned_browser(self):
        result = self.run_mode('api', TEST_CREATE_FAILURE='after')
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertFalse(self.state.exists())
        self.assertEqual(self.calls()[-1], ['rm', '--force', 'a'*64])

    def test_precreation_failure_and_foreign_owner_are_not_removed(self):
        for failure in ['before', 'foreign']:
            with self.subTest(failure=failure):
                result = self.run_mode('api', TEST_CREATE_FAILURE=failure)
                self.assertEqual(result.returncode, 17, result.stderr)
                self.assertFalse(any(call[0] == 'rm' for call in self.calls()))

    def test_removal_failure_is_actionable_and_preserves_original_failure(self):
        for status in ['0', '7']:
            with self.subTest(status=status):
                result = self.run_ready_api(TEST_RESULT=status, TEST_REMOVE_FAILURE='true')
                self.assertEqual(result.returncode, int(status) or 1, result.stderr)
                self.assertIn('cleanup could not be confirmed', result.stderr)
                self.assertIn(json.loads(self.state.read_text())['name'], result.stderr)

    def test_lost_removal_acknowledgement_does_not_create_a_false_failure(self):
        for acknowledgement in ['true', 'timeout']:
            with self.subTest(acknowledgement=acknowledgement):
                result = self.run_ready_api(TEST_REMOVE_ACK_LOST=acknowledgement)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(self.state.exists())

    def test_diagnostic_destination_failure_cannot_skip_removal(self):
        (self.root/'scripts/tests/browser/api-test-results').write_text('not a directory')
        result = self.run_ready_api()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('diagnostics unavailable', result.stderr)
        self.assertFalse(self.state.exists())

    def test_ambiguous_resource_identity_never_removes_anything(self):
        result = self.run_ready_api(TEST_RESULT='7', TEST_INVALID_ID='true')
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn('Unexpected owned browser identity', result.stderr)
        self.assertFalse(any(call[0] == 'rm' for call in self.calls()))

    def test_daemon_lookup_failure_preserves_the_test_failure(self):
        result = self.run_ready_api(TEST_RESULT='7', TEST_LOOKUP_FAILURE='true')
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn('cleanup could not be confirmed', result.stderr)
        self.assertFalse(any(call[0] == 'rm' for call in self.calls()))

    def assert_creation_interrupt(self, signum, expected):
        process = subprocess.Popen(['bash', str(self.runner), 'api'],
            env=dict(self.environment, TEST_CREATE_BLOCK='true'), start_new_session=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic()+5
            while not self.state.with_suffix('.ready').exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(self.state.with_suffix('.ready').exists(), 'Browser creation did not reach the daemon fixture')
            os.killpg(process.pid, signum)
            _, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, expected, stderr)
            self.assertFalse(self.state.exists())
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()

    def test_termination_during_creation_cleans_up_before_exiting(self):
        self.assert_creation_interrupt(signal.SIGTERM, 143)

    def test_interrupt_during_creation_cleans_up_before_exiting(self):
        self.assert_creation_interrupt(signal.SIGINT, 130)
