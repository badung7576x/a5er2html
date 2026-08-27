"""End-to-end tests for the HTML builder and CLI. Run: python3 -m unittest discover -s tests"""

import json
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from a5er2html import build_html, main, parse_a5er

EX = Path(__file__).resolve().parents[1] / 'examples'


class TestBuildHtml(unittest.TestCase):
    def setUp(self):
        self.ir = parse_a5er((EX / 'sample-utf8.a5er').read_bytes(), 'sample-utf8.a5er')
        self.html = build_html(self.ir)

    def test_placeholder_replaced(self):
        self.assertNotIn('__A5ER_DATA__', self.html)
        self.assertIn('<!DOCTYPE html>', self.html)

    def test_payload_is_valid_json(self):
        m = re.search(
            r'<script id="a5er-data" type="application/json">(.*?)</script>',
            self.html, re.DOTALL)
        self.assertIsNotNone(m)
        data = json.loads(m.group(1))
        self.assertEqual(len(data['entities']), 8)
        self.assertEqual(data['source'], 'sample-utf8.a5er')

    def test_payload_escapes_lt(self):
        """'<' must be escaped so </script> cannot break out of the JSON tag."""
        m = re.search(
            r'<script id="a5er-data" type="application/json">(.*?)</script>',
            self.html, re.DOTALL)
        self.assertNotIn('<', m.group(1))


class TestCli(unittest.TestCase):
    def test_generate_to_explicit_output(self):
        with TemporaryDirectory() as td:
            out = Path(td) / 'v.html'
            rc = main([str(EX / 'sample-sjis.a5er'), '-o', str(out)])
            self.assertEqual(rc, 0)
            html = out.read_text(encoding='utf-8')
            self.assertIn('A5ER Viewer', html)
            self.assertNotIn('__A5ER_DATA__', html)

    def test_default_output_next_to_source(self):
        with TemporaryDirectory() as td:
            src = Path(td) / 'copy.a5er'
            src.write_bytes((EX / 'sample-empty.a5er').read_bytes())
            rc = main([str(src)])
            self.assertEqual(rc, 0)
            self.assertTrue((Path(td) / 'copy.html').is_file())

    def test_missing_input_fails(self):
        self.assertEqual(main(['/no/such/file.a5er']), 1)


if __name__ == '__main__':
    unittest.main()
