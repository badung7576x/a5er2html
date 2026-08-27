#!/usr/bin/env node
/** Command-line interface: .a5er file -> self-contained HTML viewer.
 *
 * Usage:
 *   a5er2html input.a5er [-o output.html]
 *   node src/cli.js input.a5er [-o output.html]
 *
 * Output defaults to <input>.html next to the source file. The generated HTML
 * is fully offline (no server, no network) — open it in any browser.
 */

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseA5er } from './parser.js';

const TEMPLATE_PATH = fileURLToPath(new URL('../viewer_template.html', import.meta.url));
const PLACEHOLDER = '__A5ER_DATA__';

const USAGE = `usage: a5er2html [-h] [-o OUTPUT] input

Generate a self-contained HTML ER-diagram viewer from a .a5er file.

positional arguments:
  input                source .a5er file

options:
  -h, --help           show this help message and exit
  -o, --output OUTPUT  output .html path (default: <input>.html)`;

/** Inject the parsed IR into the viewer template as a JSON payload. */
export function buildHtml(ir) {
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  if (!template.includes(PLACEHOLDER)) {
    throw new Error('viewer template is missing the data placeholder');
  }
  // '<' is escaped so the payload cannot break out of its <script> tag.
  const payload = JSON.stringify(ir).replace(/</g, '\\u003c');
  // Function replacement inserts the payload verbatim: a plain string would
  // be treated as a replacement PATTERN, so '$&' / '$`' / "$'" / '$$' inside
  // .a5er content would corrupt the output (Python str.replace has no such
  // semantics — this preserves parity).
  return template.replaceAll(PLACEHOLDER, () => payload);
}

/** Package version, read lazily so importing this module stays cheap. */
export function getVersion() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

function usageError(message) {
  console.error(USAGE);
  console.error(`a5er2html: error: ${message}`);
  return 2;
}

/** Python Path.with_suffix('.html') semantics: replace the last extension,
 * keep hidden dotfiles intact ('.a5er' -> '.a5er.html'). */
function defaultOutput(p) {
  const base = basename(p);
  const dir = dirname(p);
  const dot = base.lastIndexOf('.');
  const htmlName = (dot > 0 ? base.slice(0, dot) : base) + '.html';
  return dir === '.' ? htmlName : join(dir, htmlName);
}

const LONG_OPTS = ['--output', '--help', '--version'];
/** CLI entry point. Returns the process exit code (0 ok, 1 I/O, 2 usage). */
export function main(argv = []) {
  let input;
  let output;
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '-o' || a === '--output') {
      output = args.shift();
      if (output === undefined) {
        return usageError('argument -o/--output: expected one argument');
      }
    } else if (a.startsWith('--output=')) {
      output = a.slice('--output='.length);
    } else if (a.startsWith('-o') && !a.startsWith('--') && a.length > 2) {
      output = a.slice(2); // argparse attached short form: -oFILE
    } else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return 0;
    } else if (a === '-v' || a === '--version') {
      console.log(`a5er2html ${getVersion()}`);
      return 0;
    } else if (a.startsWith('--')) {
      // argparse-style unambiguous long-option prefix abbreviation (--out…)
      const matches = LONG_OPTS.filter((o) => o.startsWith(a));
      if (matches.length === 1) {
        args.unshift(matches[0]);
        continue;
      }
      return usageError(matches.length === 0
        ? `unrecognized arguments: ${a}`
        : `ambiguous option: ${a} could match ${matches.join(', ')}`);
    } else if (a.startsWith('-') && a !== '-') {
      return usageError(`unrecognized arguments: ${a}`);
    } else if (input === undefined) {
      input = a;
    } else {
      return usageError(`unrecognized arguments: ${a}`);
    }
  }
  if (input === undefined) {
    return usageError('the following arguments are required: input');
  }

  let raw;
  try {
    raw = readFileSync(input);
  } catch (err) {
    if (err.code === 'ENOENT') console.error(`Error: file not found: ${input}`);
    else console.error(`Error: cannot read ${input}: ${err.message}`);
    return 1;
  }

  const ir = parseA5er(raw, basename(input));
  if (ir.entities.length === 0) {
    console.error('Warning: no [Entity] sections found — HTML is still generated.');
  }

  const out = output || defaultOutput(input);
  writeFileSync(out, buildHtml(ir), 'utf8');

  console.log(`OK  ${input} -> ${out}`);
  console.log(`    encoding=${ir.encoding.replaceAll('-sig', '')}  format=${ir.formatVersion || '?'}  `
    + `pages=${ir.pages.length}  entities=${ir.entities.length}  `
    + `relations=${ir.relations.length}  notes=${ir.notes.length}`);
  return 0;
}

// Bin entry point: run only when executed directly (node src/cli.js or the
// installed `a5er2html` command), not when imported by tests.
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
