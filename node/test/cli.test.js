/** End-to-end tests for the HTML builder and CLI (port of tests/test_cli.py).
 * Run: npm test  (node --test test/)  */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml, main, parseA5er } from '../src/index.js';

const EX = join(fileURLToPath(new URL('../../examples', import.meta.url)));
const read = (name) => readFileSync(join(EX, name));

const utf8Ir = parseA5er(read('sample-utf8.a5er'), 'sample-utf8.a5er');
const utf8Html = buildHtml(utf8Ir);
const payloadOf = (html) => {
  const m = html.match(/<script id="a5er-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'data script tag found');
  return m[1];
};

test('buildHtml: placeholder replaced, document intact', () => {
  assert.ok(!utf8Html.includes('__A5ER_DATA__'));
  assert.ok(utf8Html.includes('<!DOCTYPE html>'));
});

test('buildHtml: payload is valid JSON with the full IR', () => {
  const data = JSON.parse(payloadOf(utf8Html));
  assert.equal(data.entities.length, 8);
  assert.equal(data.source, 'sample-utf8.a5er');
});

test('buildHtml: payload escapes < so </script> cannot break out', () => {
  assert.ok(!payloadOf(utf8Html).includes('<'));
});

test('CLI: generate to explicit output', () => {
  const td = mkdtempSync(join(tmpdir(), 'a5er2html-'));
  const out = join(td, 'v.html');
  assert.equal(main([join(EX, 'sample-sjis.a5er'), '-o', out]), 0);
  const html = readFileSync(out, 'utf8');
  assert.ok(html.includes('A5ER Viewer'));
  assert.ok(!html.includes('__A5ER_DATA__'));
});

test('CLI: default output next to source', () => {
  const td = mkdtempSync(join(tmpdir(), 'a5er2html-'));
  const src = join(td, 'copy.a5er');
  writeFileSync(src, read('sample-empty.a5er'));
  assert.equal(main([src]), 0);
  let stat;
  try { stat = readFileSync(join(td, 'copy.html'), 'utf8'); } catch { stat = null; }
  assert.ok(stat, 'copy.html exists next to the source');
});

test('CLI: hidden dotfile keeps its name (.a5er -> .a5er.html)', () => {
  const td = mkdtempSync(join(tmpdir(), 'a5er2html-'));
  const src = join(td, '.a5er');
  writeFileSync(src, read('sample-empty.a5er'));
  assert.equal(main([src]), 0);
  assert.ok(readFileSync(join(td, '.a5er.html'), 'utf8'));
});

test('CLI: missing input fails with exit code 1', () => {
  assert.equal(main(['/no/such/file.a5er']), 1);
});

test('CLI: usage errors fail with exit code 2', () => {
  assert.equal(main([]), 2);
  assert.equal(main(['--nope']), 2);
});

test('CLI: --help succeeds', () => {
  assert.equal(main(['--help']), 0);
});

test('buildHtml/main: replacement-pattern sequences in .a5er content are inert', () => {
  // '$&', '$`', "$'", '$$' must not be interpreted by replaceAll — a plain
  // string replacement would expand them and corrupt the payload.
  const td = mkdtempSync(join(tmpdir(), 'a5er2html-'));
  const src = join(td, 'dollar.a5er');
  writeFileSync(src, [
    '# A5:ER FORMAT:21',
    '[Entity]',
    'PName=T_DOLLAR',
    'LName=dollar $$ sequences',
    'Comment=cost is 5$& and 6$` and 7$\' and 8$$',
    'Field="amount","AMOUNT","int","NOT NULL",0,"$`","$&",$FFFFFFFF,""',
    '[Note]',
    'Text="note with $$ and $& inside"',
    '',
  ].join('\n'), 'utf8');
  const out = join(td, 'dollar.html');
  assert.equal(main([src, '-o', out]), 0);
  const html = readFileSync(out, 'utf8');
  assert.ok(!html.includes('__A5ER_DATA__'), 'placeholder must be fully replaced');
  const payload = JSON.parse(payloadOf(html));
  assert.equal(payload.entities[0].comment,
    "cost is 5$& and 6$` and 7$' and 8$$");
  assert.equal(payload.notes[0].text, 'note with $$ and $& inside');
});

test('CLI: --version prints the package version and exits 0', () => {
  assert.equal(main(['--version']), 0);
});

test('CLI: -oFILE attached short form', () => {
  const td = mkdtempSync(join(tmpdir(), 'a5er2html-'));
  const out = join(td, 'attached.html');
  assert.equal(main([`-o${out}`, join(EX, 'sample-empty.a5er')]), 0);
  assert.ok(readFileSync(out, 'utf8'));
});

test('CLI: unambiguous long-option prefix abbreviation', () => {
  const td = mkdtempSync(join(tmpdir(), 'a5er2html-'));
  const out = join(td, 'abbrev.html');
  assert.equal(main(['--out', out, join(EX, 'sample-empty.a5er')]), 0);
  assert.ok(readFileSync(out, 'utf8'));
  assert.equal(main(['--hel']), 0); // abbreviates to --help
  assert.equal(main(['--']), 2); // ambiguous prefix
});
