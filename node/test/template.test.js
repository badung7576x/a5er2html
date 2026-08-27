/** Drift guard: the Node copy of viewer_template.html must stay byte-identical
 * to the Python package's copy (single source of truth, two shipped copies).
 * If this fails, re-copy:  cp a5er2html/viewer_template.html node/viewer_template.html
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeCopy = fileURLToPath(new URL('../viewer_template.html', import.meta.url));
const pythonCopy = fileURLToPath(new URL('../../a5er2html/viewer_template.html', import.meta.url));

test('viewer template copies are byte-identical across implementations', () => {
  assert.equal(
    readFileSync(nodeCopy).toString('base64'),
    readFileSync(pythonCopy).toString('base64'),
    'viewer_template.html drifted between node/ and a5er2html/ — sync them',
  );
});

test('viewer template has the data placeholder', () => {
  assert.ok(readFileSync(nodeCopy, 'utf8').includes('__A5ER_DATA__'));
});
