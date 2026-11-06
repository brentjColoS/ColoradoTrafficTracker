"""Local-script selection contracts; all operational commands use fakes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]


class ScriptSelectionTest(unittest.TestCase):
    def test_callers_preserve_explicit_environment_and_distinct_default_paths(self):
        for script, command, preferred, fallback in [
            ('compose-health-watchdog.sh', 'run', '.env', '.env.example'),
            ('local-recovery-drill.sh', 'status', '.env', '.env.example'),
            ('overnight-test.sh', 'start', 'overnight-test.env', '.env'),
        ]:
            for choice in ('explicit', 'environment', 'preferred', 'fallback'):
                with self.subTest(script=script, choice=choice), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary) / 'working repo'
                    (root / 'scripts').mkdir(parents=True)
                    shutil.copy2(REPO / 'scripts' / script, root / 'scripts' / script)
                    if (REPO / 'scripts/lib').exists():
                        shutil.copytree(REPO / 'scripts/lib', root / 'scripts/lib')
                    config = ('TOMTOM_API_KEY=\nCOMPOSE_HEALTH_WATCHDOG_SERVICES=api-service\n'
                              'COMPOSE_HEALTH_WATCHDOG_MAX_CHECKS=1\n')
                    names = {fallback, 'explicit config.env', 'environment.env'}
                    if choice != 'fallback':
                        names.add(preferred)
                    for name in names:
                        (root / name).write_text(config)
                    fake = root / 'bin'; fake.mkdir()
                    docker = fake / 'docker'
                    docker.write_text('#!/usr/bin/env python3\nimport json,os,sys\n'
                                      'with open(os.environ["COMMAND_LOG"],"a") as log: log.write(json.dumps(sys.argv[1:])+"\\n")\n'
                                      'print("healthy" if sys.argv[1]=="inspect" else "fixture-container")\n')
                    docker.chmod(0o755)
                    curl = fake / 'curl'; curl.write_text('#!/bin/sh\nprintf 200\n'); curl.chmod(0o755)
                    log = root / 'commands.jsonl'
                    env = dict(os.environ, PATH=str(fake)+os.pathsep+os.environ['PATH'], COMMAND_LOG=str(log))
                    env.pop('APP_ENV_FILE', None)
                    for key in list(env):
                        if key.startswith('COMPOSE_HEALTH_WATCHDOG_') or key == 'TOMTOM_API_KEY':
                            env.pop(key)
                    args = ['bash', str(root / 'scripts' / script), command]
                    selected = root / (preferred if choice == 'preferred' else fallback)
                    if choice in ('explicit', 'environment'):
                        env['APP_ENV_FILE'] = 'environment.env'
                        selected = root / 'environment.env'
                    if choice == 'explicit':
                        args.append('explicit config.env'); selected = root / 'explicit config.env'
                    result = subprocess.run(args, cwd='/', env=env, text=True, capture_output=True, timeout=10)
                    if script == 'overnight-test.sh':
                        self.assertNotEqual(0, result.returncode)
                        self.assertIn(f'TOMTOM_API_KEY is missing from {selected}', result.stdout+result.stderr)
                        self.assertFalse(log.exists(), 'validation must precede Compose startup')
                    else:
                        self.assertEqual(0, result.returncode, result.stdout+result.stderr)
                        commands = [json.loads(line) for line in log.read_text().splitlines()]
                        compose = [args for args in commands if args[0] == 'compose']
                        self.assertTrue(compose)
                        self.assertTrue(all(args[1:3] == ['--env-file', str(selected)] for args in compose))


class LocalComposeHelperTest(unittest.TestCase):
    def run_helper(self, code, *args):
        with tempfile.TemporaryDirectory() as temporary:
            env = os.environ.copy(); env.pop('APP_ENV_FILE', None)
            return subprocess.run(['bash', '-c', 'set -euo pipefail\nROOT_DIR="$1"\nsource "$2"\n'+code,
                                   '--', temporary, str(REPO / 'scripts/lib/local-compose.sh'), *args],
                                  env=env, text=True, capture_output=True, check=True).stdout.strip()

    def test_absolute_paths_are_preserved_and_shell_characters_are_literal(self):
        for path in ('/tmp/a folder/config.env', '/tmp/$(exit 23).env'):
            self.assertEqual(path, self.run_helper('resolve_path "$3"', path))

    def test_pid_checks_accept_a_live_process_and_reject_empty_or_invalid_ids(self):
        self.assertEqual('alive', self.run_helper('pid_alive "$$" && printf alive'))
        for pid in ('', 'not-a-pid', '99999999'):
            self.assertEqual('absent', self.run_helper('if pid_alive "$3"; then exit 23; else printf absent; fi', pid))


if __name__ == '__main__':
    unittest.main()
