/** a5er2html — self-contained HTML ER-diagram viewer for A5:SQL Mk-2 .a5er files.
 * Node.js port of the Python package; same IR, same CLI contract.
 */

export {
  parseA5er,
  detectAndDecode,
  splitSections,
  parseKvPairs,
  parseQuotedCsv,
  unquote,
} from './parser.js';
export { buildHtml, main, getVersion } from './cli.js';
