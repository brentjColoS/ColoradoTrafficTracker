import tempfile
import unittest
from pathlib import Path
from prepare_experimental import MARKER, enable_html, prepare


class PrepareTests(unittest.TestCase):
    def test_only_explicit_build_context_activation_enables_all_four_pages(self):
        source=Path(__file__).parents[2]/'api-service/src/main/resources/static/dashboard'
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            for name in ('index','system','data','api'):
                html=(source/(name+'.html')).read_text()
                self.assertNotIn(MARKER,html)
                (directory/(name+'.html')).write_text(html)
            prepare(directory);prepare(directory)
            for page in directory.glob('*.html'):
                self.assertEqual(page.read_text().count(MARKER),1)
                self.assertNotIn('content="/visitor-events"',page.read_text())
        with self.assertRaises(ValueError):prepare(source)

    def test_missing_collector_does_not_silently_create_an_enabled_page(self):
        with self.assertRaises(ValueError):enable_html('<html></head></html>')


if __name__=='__main__':unittest.main()
