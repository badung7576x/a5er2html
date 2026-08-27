/** Cross-implementation parity: the Node parser must produce the exact same IR
 * as the Python reference implementation for every fixture (and the real
 * meet_DB.a5er when present). Skips with a notice when no Python is
 * available — that is precisely the audience the Node port serves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseA5er } from '../src/parser.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

const TRACKED_FIXTURES = [
  'examples/sample-utf8.a5er',
  'examples/sample-sjis.a5er',
  'examples/sample-sjis-nodecl.a5er',
  'examples/sample-edgecases.a5er',
  'examples/sample-empty.a5er',
];
// meet_DB.a5er is gitignored private data — an extra real-world fixture
// when present locally, absent in CI.
const OPTIONAL_FIXTURES = ['meet_DB.a5er'];

const PY_DUMP = [
  'import json, os, sys',
  'sys.path.insert(0, sys.argv[1])',
  'from a5er2html import parse_a5er',
  'raw = open(sys.argv[2], "rb").read()',
  'print(json.dumps(parse_a5er(raw, os.path.basename(sys.argv[2])), ensure_ascii=False))',
].join('\n');

function findPython() {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

function pythonIr(python, fixture) {
  const run = spawnSync(python, ['-c', PY_DUMP, REPO, join(REPO, fixture)], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    // PY_DUMP prints json.dumps(..., ensure_ascii=False): raw non-ASCII. On
    // Windows a piped stdout defaults to the ANSI codepage (cp1252), which
    // cannot encode the Japanese fixtures. Force UTF-8 stdio for the child —
    // and only stdio — so parse behavior stays identical on every platform.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(run.status, 0, `python failed on ${fixture}: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

test('IR parity with the Python implementation', (t) => {
  const python = findPython();
  if (!python) {
    t.skip('no python3/python on PATH — skipping cross-implementation parity check');
    return;
  }
  assert.ok(TRACKED_FIXTURES.every((f) => existsSync(join(REPO, f))),
    'all tracked example fixtures are present');
  for (const fixture of [...TRACKED_FIXTURES, ...OPTIONAL_FIXTURES]) {
    const file = join(REPO, fixture);
    if (!existsSync(file)) continue;
    const nodeIr = parseA5er(readFileSync(file), basename(file));
    assert.deepEqual(nodeIr, pythonIr(python, fixture), `IR mismatch for ${fixture}`);
  }
});
