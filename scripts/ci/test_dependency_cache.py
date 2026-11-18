import fnmatch
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / '.github/workflows/ci.yml').read_text()
WARM = (ROOT / '.github/workflows/dependency-cache.yml').read_text()


def cache_inputs(workflow):
    return [set(block.split()) for block in re.findall(
        r'cache-dependency-path: \|\n((?:            [^\n]+\n)+)', workflow)]


class DependencyCacheTest(unittest.TestCase):
    def test_tests_and_shared_warmer_use_identical_resolution_inputs(self):
        shared, = cache_inputs(WARM)
        self.assertEqual(len(cache_inputs(CI)), 2)
        for inputs in cache_inputs(CI):
            self.assertEqual(inputs, shared)
        self.assertIn('**/pom.xml', shared)
        self.assertIn('.mvn/maven.config', shared)
        self.assertIn('.mvn/public-repositories.xml', shared)
        self.assertIn('.mvn/wrapper/maven-wrapper.properties', shared)
        self.assertIn('.github/workflows/dependency-cache.yml', shared)
        self.assertNotIn('.github/workflows/ci.yml', shared)

    def test_refresh_covers_dependency_inputs_without_running_on_source_only_edits(self):
        push = WARM.split('  push:\n', 1)[1].split('  pull_request:\n', 1)[0]
        patterns = re.findall(r"^      - ['\"]?([^'\"\n]+)['\"]?$", push, re.M)
        def triggers(path):
            return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)
        for path in ['pom.xml', 'common/pom.xml', 'api-service/pom.xml',
                     '.mvn/maven.config', '.mvn/public-repositories.xml',
                     '.mvn/wrapper/maven-wrapper.properties', 'mvnw',
                     'routes-service/Dockerfile', 'ingest-service/Dockerfile',
                     'api-service/Dockerfile', '.dockerignore',
                     '.github/workflows/dependency-cache.yml']:
            with self.subTest(path=path):
                self.assertTrue(triggers(path))
        for path in ['api-service/src/main/java/Controller.java',
                     'common/src/main/java/Geometry.java', 'docs/operations.md',
                     'api-service/src/main/resources/static/dashboard/dashboard.js',
                     '.github/workflows/ci.yml']:
            with self.subTest(path=path):
                self.assertFalse(triggers(path))

    def test_only_accepted_pushes_and_isolated_pr_refs_run_cache_publication(self):
        events = WARM.split('\npermissions:', 1)[0]
        self.assertIn('branches: [experiment/dashboard-reconstruction]', events)
        self.assertIn('  pull_request:', events)
        self.assertEqual(events.count('branches: [experiment/dashboard-reconstruction]'), 2)
        self.assertNotIn('pull_request_target', events)
        self.assertNotIn('workflow_run:', events)
        self.assertNotIn('schedule:', events)
        self.assertEqual(WARM.count(
            "if: github.ref == 'refs/heads/experiment/dashboard-reconstruction'"), 2)
        self.assertIn("github.event_name == 'pull_request'", WARM)
        self.assertIn('persist-credentials: false', WARM)
        self.assertNotIn('secrets.', WARM)

    def test_dependency_refresh_does_not_compile_publish_or_weaken_image_checks(self):
        self.assertIn('-Pmutation,mutation-common dependency:go-offline', WARM)
        self.assertIn('target: dependencies', WARM)
        self.assertNotIn('matrix:', WARM)
        self.assertEqual(WARM.count('target: dependencies'), 6)
        self.assertIn('push: false', WARM)
        self.assertNotIn('continue-on-error:', WARM)
        self.assertIn('scope=${{ matrix.service }}-dependencies-v1', CI)
        for service in ['routes-service', 'ingest-service', 'api-service']:
            self.assertIn(f'file: {service}/Dockerfile', WARM)
            self.assertIn(f'cache-from: type=gha,scope={service}-dependencies-v1,timeout=2m', WARM)
            self.assertIn(f'cache-to: type=gha,mode=max,scope={service}-dependencies-v1,', WARM)
        build = CI.split('- name: Build service image\n', 1)[1].split(
            '- name: Publish dependency cache\n', 1)[0]
        self.assertNotIn('target:', build)
        self.assertNotIn('continue-on-error:', build)

    def test_proof_uses_a_separate_runner_and_never_exports_a_replacement(self):
        proof = WARM.split('  verify-cache-restore:\n', 1)[1]
        self.assertIn('needs: container-dependencies', proof)
        self.assertIn('runs-on: ubuntu-24.04', proof)
        self.assertIn('cache-reuse-probe', proof)
        self.assertIn('run: python3 -B scripts/ci/verify_dependency_cache.py', proof)
        self.assertEqual(proof.count('cache-from:'), 3)
        self.assertNotIn('cache-to:', proof)
        pins = re.findall(r'driver-opts: image=(\S+)', CI + WARM)
        self.assertEqual(len(pins), 3)
        self.assertEqual(set(pins), {'moby/buildkit:v0.35.0@sha256:aa632b921ef07411d2cb77292cd34213d4f7b384001d6fceef1e1f25bf9752bb'})


if __name__ == '__main__':
    unittest.main()
