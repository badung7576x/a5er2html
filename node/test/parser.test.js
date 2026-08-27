/** Unit tests for the a5er parser (port of tests/test_parser.py).
 * Run: npm test  (node --test test/)  */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseA5er,
  detectAndDecode,
  parseKvPairs,
  parseQuotedCsv,
} from '../src/parser.js';

const EX = join(fileURLToPath(new URL('../../examples', import.meta.url)));
const read = (name) => readFileSync(join(EX, name));

test('quoted CSV: basics, escapes, empty slots', () => {
  const row = '"a,b","say ""hi""",$FFFFFFFF,,0';
  assert.deepEqual(parseQuotedCsv(row), ['a,b', 'say "hi"', '$FFFFFFFF', '', '0']);
});

test('quoted CSV: comma inside type is one token', () => {
  assert.equal(parseQuotedCsv('"decimal(10, 2)","NOT NULL",1')[0], 'decimal(10, 2)');
});

test('kv pairs: repeated keys become an array', () => {
  const kv = parseKvPairs(['Field="a","A"', 'X=1', 'Field="b","B"']);
  assert.deepEqual(kv.Field, ['"a","A"', '"b","B"']);
  assert.equal(kv.X, '1');
});

test('kv pairs: continuation line joins with newline', () => {
  const kv = parseKvPairs(['Comment=first line', 'second line']);
  assert.equal(kv.Comment, 'first line\nsecond line');
});

test('encoding: utf8 fixture', () => {
  const ir = parseA5er(read('sample-utf8.a5er'), 'utf8.a5er');
  assert.ok(ir.encoding.toLowerCase().includes('utf'));
  assert.equal(ir.entities.length, 8);
});

test('encoding: sjis declared', () => {
  const ir = parseA5er(read('sample-sjis.a5er'), 'sjis.a5er');
  assert.ok(ir.encoding.includes('932'));
  const cust = ir.entities[0];
  assert.equal(cust.pName, 'M_CUSTOMER');
  assert.equal(cust.lName, '顧客マスタ');
});

test('encoding: sjis without declaration falls back', () => {
  const ir = parseA5er(read('sample-sjis-nodecl.a5er'), 'nodecl.a5er');
  assert.ok(ir.encoding.includes('932'));
  assert.equal(ir.entities[0].lName, '顧客マスタ');
});

const utf8Ir = parseA5er(read('sample-utf8.a5er'), 'utf8.a5er');
const findEntity = (pName) => utf8Ir.entities.find((e) => e.pName === pName);
const findRelation = (pred) => utf8Ir.relations.find(pred);

test('model: entities and fields', () => {
  const cust = findEntity('M_CUSTOMER');
  assert.equal(cust.x, 40);
  assert.equal(cust.fields[0].pName, 'customer_id');
  assert.ok(cust.fields[0].pk);
  // escaped quote survived
  assert.ok(cust.fields[1].comment.includes('"middle"'));
  // comma inside quoted comment is one token
  assert.equal(cust.fields[2].comment, 'Unique. Comma, test: a, b, c');
  // comma inside type
  const prod = findEntity('M_PRODUCT');
  assert.equal(prod.fields[3].type, 'decimal(10, 2)');
  assert.equal(prod.fields[4].default, '0');
});

test('model: relations', () => {
  const rel = findRelation((r) => r.entity1 === 'M_CUSTOMER' && r.entity2 === 'T_ORDER');
  assert.deepEqual(rel.fields1, ['customer_id']);
  assert.equal(rel.entity1Many, false);
  assert.equal(rel.entity2Many, true);
  const oto = findRelation((r) => r.entity2 === 'T_PAYMENT');
  assert.equal(oto.entity1Many && oto.entity2Many, false);
  // missing Cardinality defaults to one-many
  const batch = findRelation((r) => r.entity1 === 'B_BATCH_JOB');
  assert.equal(batch.entity2Many && !batch.entity1Many, true);
});

test('model: pages and notes', () => {
  assert.equal(utf8Ir.pages[0], 'Main');
  assert.ok(utf8Ir.pages.includes('Batch'));
  assert.equal(utf8Ir.rdbms, 'Microsoft SQL Server 2008');
});

test('model: FORMAT 21 RelationType codes', () => {
  const rel = findRelation((r) => r.entity2 === 'T_PAYMENT' && r.fields2[0] === 'payment_method');
  assert.equal(rel.entity1Many, false);
  assert.equal(rel.entity2Many, true);
});

test('model: Page/Left/Top fallback when Position= is absent', () => {
  const log = findEntity('B_JOB_LOG');
  assert.deepEqual([log.page, log.x, log.y], ['Batch', 60, 300]);
});

test('detectAndDecode: declared ASCII stays strict, falls through to cp932', () => {
  // WHATWG aliases 'ascii' to windows-1252 (total); Python's ascii codec is
  // strict — SJIS bytes must fall through to cp932 like the reference.
  const sjisBody = Buffer.concat([
    Buffer.from('# A5:ER ENCODING:ASCII\n[Entity]\nPName=', 'latin1'),
    Buffer.from([0x82, 0xa0]), // 'あ' in cp932
    Buffer.from('\n', 'latin1'),
  ]);
  const { text, encoding } = detectAndDecode(sjisBody);
  assert.equal(encoding, 'cp932');
  assert.ok(text.includes('あ'));
});

test('detectAndDecode: pure-ASCII file declared ASCII decodes as ascii', () => {
  const { encoding } = detectAndDecode(Buffer.from('# A5:ER ENCODING:ASCII\n[Entity]\nPName=X\n', 'latin1'));
  assert.equal(encoding, 'ascii');
});

test('detectAndDecode: declared encoding wins', () => {
  const { text, encoding } = detectAndDecode(Buffer.from('# A5:ER ENCODING:UTF8\n[test]\nA=1', 'utf8'));
  assert.deepEqual([text, encoding], ['# A5:ER ENCODING:UTF8\n[test]\nA=1', 'utf-8-sig']);
});

test('detectAndDecode: BOM is stripped', () => {
  const raw = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('# A5:ER ENCODING:UTF8\n[test]\nA=1', 'utf8'),
  ]);
  const { text, encoding } = detectAndDecode(raw);
  assert.equal(encoding, 'utf-8-sig');
  assert.ok(text.startsWith('# A5:ER'));
});

// ------------------------- sample-edgecases.a5er -------------------------

const edgeIr = parseA5er(read('sample-edgecases.a5er'), 'edge.a5er');
const findEdge = (pName) => edgeIr.entities.find((e) => e.pName === pName);

test('edgecases: BOM and FORMAT', () => {
  assert.equal(edgeIr.encoding, 'utf-8-sig');
  assert.equal(edgeIr.formatVersion, '21');
});

test('edgecases: composite PK orders', () => {
  const comp = findEdge('E_COMPOSITE');
  assert.deepEqual(comp.fields.slice(0, 2).map((f) => f.pkOrder), ['0', '1']);
  assert.ok(comp.fields.slice(0, 2).every((f) => f.pk));
  assert.equal(comp.fields[2].pk, false);
});

test('edgecases: zero-field entity', () => {
  assert.deepEqual(findEdge('E_NO_FIELDS').fields, []);
});

test('edgecases: entity without page or position', () => {
  const fb = findEdge('E_FALLBACK');
  assert.equal(fb.page, null);
  assert.deepEqual([fb.x, fb.y], [0, 0]);
  // short (3-column) field row padded with empty defaults
  assert.equal(fb.fields[0].type, 'varchar(50)');
  assert.equal(fb.fields[0].nullConstraint, '');
  // multi-line comment continuation preserved
  assert.ok(fb.comment.includes('\nMulti-line comment:'));
});

test('edgecases: lowercase page lands on declared Main', () => {
  const pages = edgeIr.pages;
  assert.equal(pages[0], 'Main');
  assert.equal(pages.filter((p) => p.toLowerCase() === 'main').length, 1);
  assert.ok(pages.includes('Sub'));
});

test('edgecases: cardinality variants', () => {
  const byPair = new Map(edgeIr.relations.map((r) => [`${r.entity1}|${r.entity2}`, r]));
  const m2m = byPair.get('E_SUB_PAGE|E_NO_FIELDS');
  assert.equal(m2m.entity1Many && m2m.entity2Many, true);
  const m2one = byPair.get('E_FALLBACK|E_COMPOSITE');
  assert.equal(m2one.entity1Many && !m2one.entity2Many, true);
  const ratio = byPair.get('E_COMPOSITE|E_FALLBACK');
  assert.equal(ratio.entity1Many && !ratio.entity2Many, true);
  assert.equal(ratio.cardinality, 'N:1');
  const codes = byPair.get('E_LOWER_PAGE|E_SUB_PAGE');
  assert.equal(codes.entity1Many && codes.entity2Many, true);
});

test('edgecases: dangling relation is kept', () => {
  const dang = edgeIr.relations.filter((r) => r.entity2 === 'NO_SUCH_TABLE');
  assert.equal(dang.length, 1);
});

test('edgecases: unknown section reported', () => {
  assert.ok(edgeIr.otherSections.includes('Foobar'));
});

test('edgecases: multiline note', () => {
  assert.equal(edgeIr.notes.length, 1);
  assert.ok(edgeIr.notes[0].text.includes('\n'));
});

// ------------------------- sample-empty.a5er -------------------------

test('empty file: header only', () => {
  const ir = parseA5er(read('sample-empty.a5er'), 'empty.a5er');
  assert.deepEqual(ir.entities, []);
  assert.deepEqual(ir.relations, []);
  assert.deepEqual(ir.pages, ['MAIN']);
});
