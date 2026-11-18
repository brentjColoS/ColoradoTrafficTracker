import fnmatch
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / '.github/workflows/ci.yml').read_text()
WARM = (ROOT / '.github/workflows/dependency-cache.yml').read_text()
ACTION = (ROOT / '.github/actions/maven-cache/action.yml').read_text()
PREPARE = (ROOT / 'scripts/ci/prepare-maven-cache.sh').read_text()


def cache_inputs(workflow):
    return [set(block.split()) for block in re.findall(
        r'cache-dependency-path: \|\n((?:          [^\n]+\n)+)', workflow)]


def fingerprint(root, patterns):
    paths = sorted({path for pattern in patterns for path in root.glob(pattern)
                    if path.is_file()})
    return hashlib.sha256(b''.join(hashlib.sha256(path.read_bytes()).digest()
                                  for path in paths)).hexdigest()


class DependencyCacheTest(unittest.TestCase):
    def test_tests_and_shared_warmer_use_identical_resolution_inputs(self):
        shared, = cache_inputs(ACTION)
        self.assertEqual(CI.count('uses: ./.github/actions/maven-cache'), 2)
        self.assertEqual(WARM.count('uses: ./.github/actions/maven-cache'), 2)
        self.assertEqual(cache_inputs(CI + WARM), [])
        self.assertIn('**/pom.xml', shared)
        self.assertIn('.mvn/maven.config', shared)
        self.assertIn('.mvn/public-repositories.xml', shared)
        self.assertIn('.mvn/wrapper/maven-wrapper.properties', shared)
        self.assertIn('scripts/ci/prepare-maven-cache.sh', shared)
        self.assertIn('mvnw', shared)
        self.assertNotIn('.github/workflows/dependency-cache.yml', shared)
        self.assertNotIn('.github/workflows/ci.yml', shared)

    def test_docker_changes_preserve_key_but_maven_inputs_invalidate_it(self):
        inputs, = cache_inputs(ACTION)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = ['pom.xml', 'common/pom.xml', '.mvn/maven.config',
                     '.mvn/public-repositories.xml', 'mvnw',
                     '.mvn/wrapper/maven-wrapper.properties',
                     'scripts/ci/prepare-maven-cache.sh',
                     '.github/workflows/dependency-cache.yml',
                     '.github/workflows/ci.yml', 'api-service/Dockerfile']
            for name in files:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('original\n')
            baseline = fingerprint(root, inputs)
            for name in files:
                path = root / name
                path.write_text('changed\n')
                selected = any(fnmatch.fnmatchcase(name, pattern) for pattern in inputs)
                with self.subTest(path=name):
                    self.assertEqual(fingerprint(root, inputs) != baseline, selected)
                path.write_text('original\n')

    def test_seed_is_restore_only_and_not_allowed_in_exact_restore_proof(self):
        self.assertIn('uses: actions/cache/restore@', ACTION)
        self.assertNotIn('uses: actions/cache/save@', ACTION)
        self.assertIn("inputs.read-only != 'true'", ACTION)
        self.assertIn('cache-read-only: ${{ inputs.read-only }}', ACTION)
        self.assertIn('path=$HOME/.m2/repository', ACTION)
        self.assertIn('key: ${{ steps.java.outputs.cache-primary-key }}', ACTION)
        self.assertNotIn('fail-on-cache-miss', ACTION)

    def test_maven_proof_requires_exact_restoration_and_offline_resolution(self):
        producer = WARM.split('  maven-dependencies:\n', 1)[1].split('  verify-maven-restore:', 1)[0]
        proof = WARM.split('  verify-maven-restore:\n', 1)[1].split('  container-dependencies:', 1)[0]
        self.assertNotIn('    if:', producer)
        self.assertIn('needs: maven-dependencies', proof)
        self.assertIn("Maven cache isolation probe\\n' >> .github/workflows/dependency-cache.yml", proof)
        self.assertIn("read-only: 'true'", proof)
        self.assertIn('test "$CACHE_HIT" = true', proof)
        self.assertIn('bash scripts/ci/prepare-maven-cache.sh --offline', proof)
        self.assertIn('bash scripts/ci/prepare-maven-cache.sh -U', producer)
        self.assertIn('bash scripts/ci/prepare-maven-cache.sh -U', CI)
        self.assertNotIn('continue-on-error:', proof + producer)

    def test_preparation_forwards_online_or_offline_mode_and_propagates_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            wrapper = Path(directory) / 'mvnw'
            wrapper.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n')
            wrapper.chmod(0o755)
            for mode in ['-U', '--offline']:
                result = subprocess.run(['bash', str(ROOT / 'scripts/ci/prepare-maven-cache.sh'), mode],
                                        cwd=directory, capture_output=True, text=True)
                with self.subTest(mode=mode):
                    self.assertEqual(result.returncode, 7)
                    self.assertEqual(result.stdout.splitlines(), [
                        '-B', '-ntp', mode, '-s', '.mvn/public-repositories.xml',
                        '-Pmutation,mutation-common', 'dependency:go-offline'])

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
                     '.github/actions/maven-cache/action.yml',
                     'scripts/ci/prepare-maven-cache.sh', 'scripts/ci/test_dependency_cache.py',
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
            "if: github.ref == 'refs/heads/experiment/dashboard-reconstruction'"), 1)
        self.assertIn("github.event_name == 'pull_request'", WARM)
        self.assertIn('persist-credentials: false', WARM)
        self.assertNotIn('secrets.', WARM)

    def test_dependency_refresh_does_not_compile_publish_or_weaken_image_checks(self):
        self.assertIn('-Pmutation,mutation-common dependency:go-offline', PREPARE)
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
