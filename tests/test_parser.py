"""Unit tests for the a5er parser. Run: python3 -m unittest discover -s tests"""

import unittest
from pathlib import Path

from a5er2html import parse_a5er
from a5er2html.parser import detect_and_decode, parse_kv_pairs, parse_quoted_csv

EX = Path(__file__).resolve().parents[1] / 'examples'


class TestQuotedCsv(unittest.TestCase):
    def test_basic_and_escapes(self):
        row = r'"a,b","say ""hi""",$FFFFFFFF,,0'
        self.assertEqual(
            parse_quoted_csv(row),
            ['a,b', 'say "hi"', '$FFFFFFFF', '', '0'],
        )

    def test_comma_in_type(self):
        self.assertEqual(parse_quoted_csv('"decimal(10, 2)","NOT NULL",1')[0], 'decimal(10, 2)')


class TestKvPairs(unittest.TestCase):
    def test_repeated_keys_become_list(self):
        kv = parse_kv_pairs(['Field="a","A"', 'X=1', 'Field="b","B"'])
        self.assertEqual(kv['Field'], ['"a","A"', '"b","B"'])
        self.assertEqual(kv['X'], '1')

    def test_continuation_line(self):
        kv = parse_kv_pairs(['Comment=first line', 'second line'])
        self.assertEqual(kv['Comment'], 'first line\nsecond line')


class TestEncoding(unittest.TestCase):
    def test_utf8_fixture(self):
        ir = parse_a5er((EX / 'sample-utf8.a5er').read_bytes(), 'utf8.a5er')
        self.assertIn('utf', ir['encoding'].lower())
        self.assertEqual(len(ir['entities']), 8)

    def test_sjis_declared(self):
        ir = parse_a5er((EX / 'sample-sjis.a5er').read_bytes(), 'sjis.a5er')
        self.assertIn('932', ir['encoding'])
        cust = ir['entities'][0]
        self.assertEqual(cust['pName'], 'M_CUSTOMER')
        self.assertEqual(cust['lName'], '顧客マスタ')

    def test_sjis_no_declaration_fallback(self):
        ir = parse_a5er((EX / 'sample-sjis-nodecl.a5er').read_bytes(), 'nodecl.a5er')
        self.assertIn('932', ir['encoding'])
        self.assertEqual(ir['entities'][0]['lName'], '顧客マスタ')


class TestModel(unittest.TestCase):
    def setUp(self):
        self.ir = parse_a5er((EX / 'sample-utf8.a5er').read_bytes(), 'utf8.a5er')

    def test_entities_and_fields(self):
        cust = next(e for e in self.ir['entities'] if e['pName'] == 'M_CUSTOMER')
        self.assertEqual(cust['x'], 40.0)
        self.assertEqual(cust['fields'][0]['pName'], 'customer_id')
        self.assertTrue(cust['fields'][0]['pk'])
        # escaped quote survived
        self.assertIn('"middle"', cust['fields'][1]['comment'])
        # comma inside quoted comment is one token
        self.assertEqual(cust['fields'][2]['comment'], 'Unique. Comma, test: a, b, c')
        # comma inside type
        prod = next(e for e in self.ir['entities'] if e['pName'] == 'M_PRODUCT')
        self.assertEqual(prod['fields'][3]['type'], 'decimal(10, 2)')
        self.assertEqual(prod['fields'][4]['default'], '0')

    def test_relations(self):
        rel = next(r for r in self.ir['relations']
                   if r['entity1'] == 'M_CUSTOMER' and r['entity2'] == 'T_ORDER')
        self.assertEqual(rel['fields1'], ['customer_id'])
        self.assertFalse(rel['entity1Many'])
        self.assertTrue(rel['entity2Many'])
        oto = next(r for r in self.ir['relations'] if r['entity2'] == 'T_PAYMENT')
        self.assertFalse(oto['entity1Many'] and oto['entity2Many'])
        # missing Cardinality defaults to one-many
        batch = next(r for r in self.ir['relations'] if r['entity1'] == 'B_BATCH_JOB')
        self.assertTrue(batch['entity2Many'] and not batch['entity1Many'])

    def test_pages_and_notes(self):
        self.assertEqual(self.ir['pages'][0], 'Main')
        self.assertIn('Batch', self.ir['pages'])
        self.assertEqual(self.ir['rdbms'], 'Microsoft SQL Server 2008')

    def test_relation_type_codes_format21(self):
        rel = next(r for r in self.ir['relations']
                   if r['entity2'] == 'T_PAYMENT' and r['fields2'] == ['payment_method'])
        self.assertFalse(rel['entity1Many'])
        self.assertTrue(rel['entity2Many'])

    def test_left_top_fallback(self):
        """B_JOB_LOG has no Position= line; Page/Left/Top must be used."""
        log = next(e for e in self.ir['entities'] if e['pName'] == 'B_JOB_LOG')
        self.assertEqual((log['page'], log['x'], log['y']), ('Batch', 60.0, 300.0))


class TestDetectDecode(unittest.TestCase):
    def test_declared_wins(self):
        text, enc = detect_and_decode('# A5:ER ENCODING:UTF8\n[test]\nA=1'.encode())
        self.assertEqual((text, enc), ('# A5:ER ENCODING:UTF8\n[test]\nA=1', 'utf-8-sig'))

    def test_bom_is_stripped(self):
        raw = b'\xef\xbb\xbf# A5:ER ENCODING:UTF8\n[test]\nA=1'
        text, enc = detect_and_decode(raw)
        self.assertEqual(enc, 'utf-8-sig')
        self.assertTrue(text.startswith('# A5:ER'))


class TestEdgeCases(unittest.TestCase):
    """sample-edgecases.a5er: BOM, degenerate entities, cardinality variants…"""

    def setUp(self):
        self.ir = parse_a5er((EX / 'sample-edgecases.a5er').read_bytes(), 'edge.a5er')

    def test_bom_and_format(self):
        self.assertEqual(self.ir['encoding'], 'utf-8-sig')
        self.assertEqual(self.ir['formatVersion'], '21')

    def test_composite_pk_orders(self):
        comp = next(e for e in self.ir['entities'] if e['pName'] == 'E_COMPOSITE')
        self.assertEqual([f['pkOrder'] for f in comp['fields'][:2]], ['0', '1'])
        self.assertTrue(all(f['pk'] for f in comp['fields'][:2]))
        self.assertFalse(comp['fields'][2]['pk'])

    def test_zero_field_entity(self):
        nf = next(e for e in self.ir['entities'] if e['pName'] == 'E_NO_FIELDS')
        self.assertEqual(nf['fields'], [])

    def test_entity_without_page_or_position(self):
        fb = next(e for e in self.ir['entities'] if e['pName'] == 'E_FALLBACK')
        self.assertIsNone(fb['page'])
        self.assertEqual((fb['x'], fb['y']), (0.0, 0.0))
        # short (3-column) field row padded with empty defaults
        self.assertEqual(fb['fields'][0]['type'], 'varchar(50)')
        self.assertEqual(fb['fields'][0]['nullConstraint'], '')
        # multi-line comment continuation preserved
        self.assertIn('\nMulti-line comment:', fb['comment'])

    def test_lowercase_page_lands_on_declared_main(self):
        pages = self.ir['pages']
        self.assertEqual(pages[0], 'Main')
        self.assertEqual(len([p for p in pages if p.lower() == 'main']), 1)
        self.assertIn('Sub', pages)

    def test_cardinality_variants(self):
        by_pair = {(r['entity1'], r['entity2']): r for r in self.ir['relations']}
        m2m = by_pair[('E_SUB_PAGE', 'E_NO_FIELDS')]
        self.assertTrue(m2m['entity1Many'] and m2m['entity2Many'])
        m2one = by_pair[('E_FALLBACK', 'E_COMPOSITE')]
        self.assertTrue(m2one['entity1Many'] and not m2one['entity2Many'])
        ratio = by_pair[('E_COMPOSITE', 'E_FALLBACK')]
        self.assertTrue(ratio['entity1Many'] and not ratio['entity2Many'])
        self.assertEqual(ratio['cardinality'], 'N:1')
        codes = by_pair[('E_LOWER_PAGE', 'E_SUB_PAGE')]
        self.assertTrue(codes['entity1Many'] and codes['entity2Many'])

    def test_dangling_relation_is_kept(self):
        dang = [r for r in self.ir['relations'] if r['entity2'] == 'NO_SUCH_TABLE']
        self.assertEqual(len(dang), 1)

    def test_unknown_section_reported(self):
        self.assertIn('Foobar', self.ir['otherSections'])

    def test_multiline_note(self):
        self.assertEqual(len(self.ir['notes']), 1)
        self.assertIn('\n', self.ir['notes'][0]['text'])


class TestEmptyFile(unittest.TestCase):
    def test_header_only(self):
        ir = parse_a5er((EX / 'sample-empty.a5er').read_bytes(), 'empty.a5er')
        self.assertEqual(ir['entities'], [])
        self.assertEqual(ir['relations'], [])
        self.assertEqual(ir['pages'], ['MAIN'])


if __name__ == '__main__':
    unittest.main()
