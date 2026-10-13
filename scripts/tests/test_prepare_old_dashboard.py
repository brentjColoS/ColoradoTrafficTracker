import importlib.util
from pathlib import Path
import tempfile
import unittest


script = Path(__file__).resolve().parents[1] / "prepare-old-dashboard.py"
spec = importlib.util.spec_from_file_location("prepare_old_dashboard", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OldDashboardTest(unittest.TestCase):
    def fixture(self, root):
        dashboard = Path(root) / "api-service/src/main/resources/static/dashboard"
        dashboard.mkdir(parents=True)
        files = {
            "index.html": b'<link href="/dashboard/dashboard.css?v=original"><script src="/dashboard/dashboard.js"></script>',
            "dashboard.js": b'fetch("/dashboard-api/traffic/history?corridor=I25"); const label="Current speed";',
            "road-sign-display.js": b'const image="/dashboard/road-sign-i25.png"; const style="url(/dashboard/road-sign-i70.png)";',
            "dashboard.css": b'.hero { color: #193b2f; }',
            "road-sign-i25.png": b'\x89PNG\x00original-image',
        }
        for name, content in files.items():
            (dashboard / name).write_bytes(content)
        return dashboard, files

    def test_legacy_urls_are_isolated_without_changing_style_or_images(self):
        with tempfile.TemporaryDirectory() as root:
            dashboard, files = self.fixture(root)
            module.prepare(root)
            for name in ("index.html", "road-sign-display.js"):
                body = (dashboard / name).read_bytes()
                self.assertNotIn(b"/dashboard/", body)
                self.assertIn(b"/dashboard-old/", body)
            body = (dashboard / "dashboard.js").read_bytes()
            self.assertNotIn(b"/dashboard-api/", body)
            self.assertIn(b"/dashboard-old-api/traffic/history?corridor=I25", body)
            self.assertIn(b'const label="Current speed";', body)
            for name in ("dashboard.css", "road-sign-i25.png"):
                self.assertEqual((dashboard / name).read_bytes(), files[name])

    def test_incompatible_source_is_rejected_before_any_file_changes(self):
        with tempfile.TemporaryDirectory() as root:
            dashboard, files = self.fixture(root)
            (dashboard / "road-sign-display.js").write_bytes(b"new dashboard")
            with self.assertRaises(ValueError):
                module.prepare(root)
            for name in ("index.html", "dashboard.js"):
                self.assertEqual((dashboard / name).read_bytes(), files[name])


if __name__ == "__main__":
    unittest.main()
