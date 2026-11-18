import json
import subprocess
import unittest
from unittest.mock import patch

from verify_dependency_cache import build_reference, require_dependency_hit, verify_service


def status(**changes):
    vertex = {'digest': 'sha256:example', 'name': '[dependencies] RUN mvn -q -U -pl routes-service -am dependency:go-offline',
              'completed': '2026-11-18T00:00:00Z', 'cached': True}
    return json.dumps({'vertexes': [{**vertex, **changes}]})


class CacheRestoreTest(unittest.TestCase):
    def test_requires_completed_cached_resolution_not_successful_reexecution(self):
        require_dependency_hit(status(), 'routes-service')
        for changes in [{'cached': False}, {'cached': None}, {'completed': None},
                        {'error': 'failed'}, {'name': 'COPY pom.xml pom.xml'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                require_dependency_hit(status(**changes), 'routes-service')
        with self.assertRaises(ValueError):
            require_dependency_hit(status(), 'api-service')

    def test_merges_vertex_updates_and_rejects_missing_or_ambiguous_records(self):
        require_dependency_hit(status(completed=None) + '\n' + status(), 'routes-service')
        for log in ['', 'No record', '{invalid', status() + '\n' + status(digest='other')]:
            with self.subTest(log=log), self.assertRaises(ValueError):
                require_dependency_hit(log, 'routes-service')

    def test_splits_full_reference_for_the_buildx_history_command(self):
        self.assertEqual(build_reference({'buildx.build.ref': 'builder-name/node/record-id'}),
                         ('builder-name', 'record-id'))
        for ref in ['', 'record-only', 'builder//id', '../node/id', 'builder/node/id;echo', 'a/b/c/d']:
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                build_reference({'buildx.build.ref': ref})

    def test_reads_the_correct_builder_and_bounds_log_retrieval(self):
        result = subprocess.CompletedProcess([], 0, stdout='', stderr=status())
        with patch('verify_dependency_cache.subprocess.run', return_value=result) as run:
            verify_service({'buildx.build.ref': 'builder/node/id'}, 'routes-service')
            self.assertEqual(run.call_args.args[0], ['docker', 'buildx', '--builder', 'builder',
                                                    'history', 'logs', '--progress', 'rawjson', 'id'])
            self.assertEqual(run.call_args.kwargs['timeout'], 30)
            self.assertTrue(run.call_args.kwargs['check'])


if __name__ == '__main__':
    unittest.main()
