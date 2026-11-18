import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
import threading
import unittest


RUNNER = Path(__file__).with_name('browser-checks.sh')


class BrowserChecksTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
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
import json, os, sys
with open(os.environ['TEST_DOCKER_LOG'], 'a') as log:
    log.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[1] == 'run' and '--detach' in sys.argv:
    print('a'*64)
elif sys.argv[1] == 'port':
    print(os.environ['TEST_PORT'])
elif sys.argv[1] == 'run':
    sys.exit(int(os.environ.get('TEST_RESULT', '0')))
''')
        binary.chmod(0o700)
        self.log = self.root / 'docker.log'
        self.environment = dict(os.environ, PATH=str(binary.parent)+os.pathsep+os.environ['PATH'],
                                TEST_DOCKER_LOG=str(self.log), TEST_RESULT='0')

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

    def test_api_failure_removes_only_its_owned_loopback_browser(self):
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
                result = self.run_mode('api', TEST_RESULT='7', TEST_PORT=f'127.0.0.1:{server.server_port}')
            finally:
                server.shutdown()
                thread.join()
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
