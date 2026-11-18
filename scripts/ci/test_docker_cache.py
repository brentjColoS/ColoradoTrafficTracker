from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / '.github/workflows/ci.yml').read_text()
PIN = 'moby/buildkit:v0.35.0@sha256:aa632b921ef07411d2cb77292cd34213d4f7b384001d6fceef1e1f25bf9752bb'


class DockerCacheTests(unittest.TestCase):
    def test_producer_and_fresh_consumer_use_the_same_verified_builder(self):
        self.assertEqual(re.findall(r'driver-opts: image=(\S+)', CI), [PIN, PIN])
        proof = CI.split('  verify-docker-cache:\n', 1)[1].split('  windows-backup-tests:', 1)[0]
        self.assertIn('needs: container-builds', proof)
        self.assertIn('runs-on: ubuntu-24.04', proof)
        self.assertIn('common/src/main/resources/cache-reuse-probe', proof)
        self.assertIn('DOCKER_BUILD_RECORD_RETENTION_DAYS: 7', proof)
        self.assertEqual(proof.count('target: dependencies'), 3)
        self.assertNotIn('cache-to:', proof)
        for service, key in [('routes-service', 'ROUTES'), ('ingest-service', 'INGEST'), ('api-service', 'API')]:
            self.assertIn(f'file: {service}/Dockerfile', proof)
            self.assertIn(f'cache-from: type=gha,scope={service}-dependencies-v1,timeout=2m', proof)
            self.assertIn(f'{key}_METADATA:', proof)
        self.assertIn('run: python3 -B scripts/ci/verify_dependency_cache.py', proof)

    def test_only_cache_export_is_optional_not_build_or_required_reuse_proof(self):
        producer = CI.split('  container-builds:\n', 1)[1].split('  verify-docker-cache:', 1)[0]
        build, export = producer.split('      - name: Publish dependency cache\n', 1)
        self.assertNotIn('ignore-error', build)
        self.assertIn('cache-to: type=gha,mode=max,scope=${{ matrix.service }}-dependencies-v1,timeout=2m,ignore-error=true', export)
        self.assertNotIn('continue-on-error:', CI)
        final = CI.split('  ci-complete:\n', 1)[1]
        self.assertIn('container-builds, verify-docker-cache,', final)
        self.assertIn('job["result"] != "success"', final)

    def test_local_regression_resolves_exported_dependencies_without_network(self):
        script = (ROOT / 'scripts/test-container-build-cache.sh').read_text()
        self.assertIn('expect_step "$service" reuse dependency:go-offline CACHED', script)
        self.assertIn('docker run --rm --network none --entrypoint mvn', script)
        self.assertIn('-q -o -s .mvn/public-repositories.xml', script)
        self.assertIn('docker image rm "$image"', script)
        self.assertNotIn('prune', script)


if __name__ == '__main__':
    unittest.main()
