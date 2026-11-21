import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / '.github/workflows/ci.yml').read_text()
ACTION = (ROOT / '.github/actions/maven-cache/action.yml').read_text()
PREPARE = ROOT / 'scripts/ci/prepare-maven-cache.sh'
INPUTS = re.search(r'cache-dependency-path: \|\n((?:          [^\n]+\n)+)', ACTION).group(1).split()


def fingerprint(root):
    paths = sorted({path for pattern in INPUTS for path in root.glob(pattern) if path.is_file()})
    return hashlib.sha256(b''.join(hashlib.sha256(path.read_bytes()).digest()
                                  for path in paths)).hexdigest()


class MavenCacheTests(unittest.TestCase):
    def test_only_dependency_inputs_change_the_cache_key(self):
        dependencies = ['pom.xml', 'common/pom.xml', 'scripts/ci/maven-cache/pom.xml',
                        '.mvn/maven.config', '.mvn/public-repositories.xml',
                        '.mvn/wrapper/maven-wrapper.properties', 'mvnw',
                        'scripts/ci/prepare-maven-cache.sh']
        unrelated = ['.github/workflows/ci.yml', '.github/actions/maven-cache/action.yml',
                     'api-service/Dockerfile', 'api-service/src/main/java/Example.java']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in dependencies + unrelated:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('original\n')
            baseline = fingerprint(root)
            for name in dependencies + unrelated:
                path = root / name
                path.write_text('changed\n')
                with self.subTest(path=name):
                    self.assertEqual(fingerprint(root) != baseline, name in dependencies)
                path.write_text('original\n')

    def test_all_jobs_share_one_key_and_consumers_cannot_publish_partial_caches(self):
        self.assertEqual(CI.count('uses: ./.github/actions/maven-cache'), 3)
        self.assertNotIn('cache: maven', CI)
        mutations = CI.split('  mutation-tests:\n', 1)[1].split('  api-mutation-complete:', 1)[0]
        self.assertIn("read-only: 'true'", mutations)
        producer = CI.split('  build-and-test:\n', 1)[1].split('  verify-maven-cache:', 1)[0]
        self.assertIn('bash scripts/ci/prepare-maven-cache.sh -U', producer)
        self.assertLess(producer.index('clean verify'), producer.index('-DskipTests install'))
        self.assertIn('org.pitest:pitest-maven:help', producer)

    def test_exact_restore_proof_runs_offline_without_fallback_or_replacement(self):
        proof = CI.split('  verify-maven-cache:\n', 1)[1].split('  resilience-tests:', 1)[0]
        self.assertIn('needs: build-and-test', proof)
        self.assertIn('runs-on: ubuntu-24.04', proof)
        self.assertIn('Maven cache isolation probe', proof)
        self.assertIn("read-only: 'true'", proof)
        self.assertIn('test "$CACHE_HIT" = true', proof)
        self.assertIn('bash scripts/ci/prepare-maven-cache.sh --offline', proof)
        final = CI.split('  ci-complete:\n', 1)[1]
        needs = re.search(r'^    needs: \[([^\]]+)\]$', final, re.MULTILINE).group(1).split(', ')
        self.assertIn('build-and-test', needs)
        self.assertIn('verify-maven-cache', needs)
        self.assertIn('job["result"] != "success"', final)
        self.assertNotIn('continue-on-error:', CI)

    def test_seed_restores_only_public_repository_and_is_disabled_for_consumers(self):
        self.assertIn('uses: actions/cache/restore@', ACTION)
        self.assertIn('path=$HOME/.m2/repository', ACTION)
        self.assertIn('key: ${{ steps.java.outputs.cache-primary-key }}', ACTION)
        self.assertIn("inputs.read-only != 'true'", ACTION)
        self.assertIn('cache-read-only: ${{ inputs.read-only }}', ACTION)
        self.assertNotIn('uses: actions/cache/save@', ACTION)
        self.assertNotIn('secrets.', ACTION)

    def test_runtime_launcher_inherits_current_dependency_management(self):
        ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
        pom = ET.parse(ROOT / 'scripts/ci/maven-cache/pom.xml')
        dependency, = pom.findall('m:dependencies/m:dependency', ns)
        self.assertEqual(dependency.findtext('m:groupId', namespaces=ns), 'org.junit.platform')
        self.assertEqual(dependency.findtext('m:artifactId', namespaces=ns), 'junit-platform-launcher')
        self.assertEqual(dependency.findtext('m:scope', namespaces=ns), 'test')
        self.assertIsNone(dependency.find('m:version', ns))
        parent = pom.findtext('m:parent/m:relativePath', namespaces=ns)
        self.assertEqual((ROOT / 'scripts/ci/maven-cache' / parent).resolve(), ROOT / 'pom.xml')

    def test_preparation_preserves_offline_mode_and_both_failure_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            wrapper = Path(directory) / 'mvnw'
            wrapper.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            wrapper.chmod(0o755)
            result = subprocess.run(['bash', str(PREPARE), '--offline'], cwd=directory,
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.splitlines(), [
                '-B', '-ntp', '--offline', '-s', '.mvn/public-repositories.xml',
                '-Pmutation', 'dependency:go-offline',
                '-B', '-ntp', '--offline', '-s', '.mvn/public-repositories.xml',
                '-f', 'scripts/ci/maven-cache/pom.xml', 'dependency:go-offline'])
            for code in ['exit 7', 'case "$*" in *" -f "*) exit 7;; esac']:
                wrapper.write_text('#!/bin/sh\n' + code + '\n')
                result = subprocess.run(['bash', str(PREPARE), '-U'], cwd=directory,
                                        text=True, capture_output=True)
                self.assertEqual(result.returncode, 7)

    def test_main_retains_visitor_transfer_and_mutation_gates_with_browser_checks(self):
        self.assertIn('Verify private visitor storage and access', CI)
        self.assertIn('python3 -B scripts/ci/probe_maven_transfers.py', CI)
        dashboard = CI.split('  dashboard-tests:\n', 1)[1].split('  verify-maven-cache:', 1)[0]
        for suite in ('dashboard.test.cjs', 'why-page.test.cjs', 'visitor-events.test.cjs'):
            self.assertIn('scripts/tests/' + suite, dashboard)
        final = CI.split('  ci-complete:\n', 1)[1]
        needs = re.search(r'^    needs: \[([^\]]+)\]$', final, re.MULTILINE).group(1).split(', ')
        self.assertTrue({'dashboard-tests', 'browser-tests', 'browser-api-smoke'}.issubset(needs))
        matrix = CI.split('  mutation-tests:\n', 1)[1].split('    steps:', 1)[0]
        self.assertEqual(re.findall(r'- name: (\S+)', matrix),
                         ['routes-service', 'ingest-service', 'api-web', 'api-support', 'api-analytics'])


if __name__ == '__main__':
    unittest.main()
