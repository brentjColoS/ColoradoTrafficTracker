import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from browser_runtime import record, verify


class BrowserRuntimeTest(unittest.TestCase):
    def test_rejects_wrong_revision_and_modified_or_missing_jars(self):
        with TemporaryDirectory() as directory, patch('browser_runtime.revision', return_value='checked-head'):
            root = Path(directory)
            for service in ['api-service', 'routes-service']:
                target = root / service / 'target'
                target.mkdir(parents=True)
                (target / 'application.jar').write_bytes(service.encode())
            output = root / 'runtime'
            record(root, output)
            verify(output)
            jar = output / 'api-service.jar'
            original = jar.read_bytes()
            jar.write_bytes(b'other build')
            with self.assertRaisesRegex(ValueError, 'differs'):
                verify(output)
            jar.write_bytes(original)
            with patch('browser_runtime.revision', return_value='other-head'):
                with self.assertRaisesRegex(ValueError, 'revision'):
                    verify(output)
            jar.unlink()
            with self.assertRaises(FileNotFoundError):
                verify(output)

    def test_no_ambiguous_jar_or_incomplete_manifest_is_accepted(self):
        with TemporaryDirectory() as directory, patch('browser_runtime.revision', return_value='checked-head'):
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'Exactly one'):
                record(root, root / 'runtime')
            output = root / 'runtime'
            (output / 'manifest.json').write_text(json.dumps({'revision': 'checked-head', 'files': {}}))
            with self.assertRaisesRegex(ValueError, 'JAR set'):
                verify(output)
