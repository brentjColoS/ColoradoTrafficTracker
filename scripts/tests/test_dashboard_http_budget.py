"""Verify the rendered experimental worker budget fits its existing container envelope."""
import json
import os
from pathlib import Path
import subprocess
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]


class DashboardHttpBudgetTest(unittest.TestCase):
    def render(self, maximum=None):
        env = dict(os.environ)
        env.update(EXPERIMENT_DASHBOARD_IMAGE='capacity-fixture:only',
                   EXPERIMENT_DB_USERNAME='fixture_reader',
                   SPRING_DATASOURCE_PASSWORD=uuid4().hex,
                   EXPERIMENT_API_SECURITY_KEYS=uuid4().hex)
        for key in ['EXPERIMENT_HTTP_THREADS_MAX', 'EXPERIMENT_PIDS_LIMIT',
                    'EXPERIMENT_MEMORY_LIMIT', 'EXPERIMENT_CPU_LIMIT']:
            env.pop(key, None)
        if maximum is not None:
            env['EXPERIMENT_HTTP_THREADS_MAX'] = str(maximum)
        result = subprocess.run(
            ['docker', 'compose', '--env-file', os.devnull,
             '-f', str(ROOT / 'docker-compose.experimental-dashboard.yml'),
             'config', '--format', 'json'], env=env, capture_output=True,
            text=True, check=True, timeout=15)
        return json.loads(result.stdout)['services']['experimental-dashboard']

    def test_default_preserves_container_and_data_boundaries_with_worker_headroom(self):
        service = self.render()
        settings = service['environment']
        self.assertEqual(settings['SERVER_TOMCAT_THREADS_MAX'], '64')
        self.assertEqual(service['pids_limit'], 128)
        self.assertEqual(int(service['mem_limit']), 1536 * 1024 * 1024)
        self.assertEqual(float(service['cpus']), 1.5)
        self.assertEqual(settings['SPRING_DATASOURCE_HIKARI_READ_ONLY'], 'true')
        self.assertEqual(settings['SPRING_FLYWAY_ENABLED'], 'false')

    def test_explicit_worker_override_does_not_raise_other_limits(self):
        service = self.render(32)
        self.assertEqual(service['environment']['SERVER_TOMCAT_THREADS_MAX'], '32')
        self.assertEqual(service['pids_limit'], 128)
        self.assertEqual(int(service['mem_limit']), 1536 * 1024 * 1024)
        self.assertEqual(float(service['cpus']), 1.5)


if __name__ == '__main__':
    unittest.main()
