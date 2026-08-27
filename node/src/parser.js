/** a5er file parser — Node.js port of `a5er2html/parser.py` (behavioral parity).
 *
 * Parses A5:SQL Mk-2 ER-diagram files (.a5er) — a plain-text INI-like format —
 * into a JSON-serializable intermediate representation (IR).
 *
 * Format facts (verified against a real FORMAT:15 file, MareMare/ExcelToA5er):
 * - Header comment lines start with '#'; '# A5:ER ENCODING:UTF8|SJIS' declares
 *   the file encoding. Older files may omit the declaration (usually SJIS).
 * - Repeated sections: [Entity], [Relation], [Note], plus one [Manager].
 * - Key=value lines; Field= / Position= / PageInfo= values are quoted CSV
 *   ('"' quoted, embedded '"' escaped as '""', unquoted tokens allowed).
 *
 * Field CSV column layout (9 slots):
 *   1 logical_name, 2 physical_name, 3 data_type, 4 nullability,
 *   5 pk_order (blank = not PK), 6 default, 7 comment, 8 color, 9 extra
 *
 * Known accepted divergences from the Python implementation (documented;
 * all are on inputs A5:SQL Mk-2 never writes):
 * - CR-only line endings: JS /m regex anchors treat '\r' as a line
 *   terminator, Python re.M only '\n'.
 * - Corrupt Shift_JIS bytes: Python cp932 maps some invalid bytes to
 *   private-use chars; WHATWG shift_jis rejects them (U+FFFD fallback).
 * - FLOAT_RE is stricter than Python float(): '1_000', 'inf', 'nan' are not
 *   accepted as Position/Left/Top numbers.
 * - str.splitlines() splits on more exotic controls (\v \f \x85 \u2028…)
 *   than the \r\n/\r/\n split used here.
 */
// ---------------------------------------------------------------- primitives

/** Split a quoted-CSV row. '""' inside quotes is an escaped quote.
 *
 * Handles: commas inside quotes, empty slots (',,'), unquoted tokens
 * ($FFFFFFFF, bare numbers), and unterminated quotes (lenient tail).
 */
export function parseQuotedCsv(text) {
  const tokens = [];
  let buf = '';
  let inQuote = false;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < n && text[i + 1] === '"') { // escaped quote
          buf += '"';
          i += 2;
          continue;
        }
        inQuote = false;
      } else {
        buf += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      tokens.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
    i += 1;
  }
  tokens.push(buf);
  return tokens;
}

/** Strip one layer of surrounding quotes, honoring '""' escapes. */
export function unquote(value) {
  value = value.trim();
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    return parseQuotedCsv(value)[0];
  }
  return value;
}

// ------------------------------------------------------------------ decoding

const ENC_HEADER = /A5:ER ENCODING[:=]\s*([A-Za-z0-9_-]+)/;

/** Python-style float() acceptance: strict decimal/exponent form.
 * Rejects what Number() would happily parse ('0x10', '', 'Infinity'). */
const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function toFloat(value) {
  if (Array.isArray(value)) return null; // Python float(list) raises
  const s = String(value ?? '');
  return FLOAT_RE.test(s) ? Number(s) : null;
}

/** Strict 7-bit ASCII, like Python's 'ascii' codec. WHATWG maps the label
 * 'ascii' to windows-1252 (a total function that never fails), so a declared
 * ENCODING:ASCII over Shift_JIS bytes would mojibake instead of falling
 * through to cp932 — this restores the Python fallback chain. */
function decodeStrictAscii(raw) {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] > 0x7f) throw new Error('non-ASCII byte');
  }
  return raw.toString('latin1');
}

/** Return { text, encoding }. Sniffs the ENCODING header first.
 *
 * The header itself is ASCII in both UTF-8 and Shift_JIS files, so a raw
 * byte scan (via binary-safe latin1 decoding) is safe. Files without a
 * declaration are tried as UTF-8 (strict) then Shift_JIS (cp932).
 *
 * Parity notes with the Python implementation:
 * - WHATWG 'shift_jis' IS Windows-31J (cp932), including NEC/IBM extensions.
 * - 'utf-8-sig' is emulated with TextDecoder's default BOM stripping; the
 *   plain 'utf-8' attempt keeps the BOM character, like Python does.
 * - Reported encoding names match Python's: 'utf-8-sig', 'utf-8', 'cp932',
 *   'cp932(replaced)'.
 */
export function detectAndDecode(raw) {
  // toString('latin1') is 1 byte = 1 char, so this mirrors raw[:512] exactly.
  const declared = raw.toString('latin1').slice(0, 512).match(ENC_HEADER);
  let candidates;
  if (declared) {
    const name = declared[1].toUpperCase();
    if (name === 'UTF8' || name === 'UTF-8') {
      candidates = [
        { label: 'utf-8', keepBom: false, report: 'utf-8-sig' },
        { label: 'utf-8', keepBom: true, report: 'utf-8' },
      ];
    } else if (['SJIS', 'SHIFT_JIS', 'CP932', 'MS932'].includes(name)) {
      candidates = [{ label: 'shift_jis', keepBom: false, report: 'cp932' }];
    } else { // unknown declaration: try declared name, then fallbacks
      const norm = name.toLowerCase().replaceAll('-', '');
      candidates = norm === 'ascii' || norm === 'usascii'
        ? [
            { ascii: true, report: 'ascii' },
            { label: 'utf-8', keepBom: true, report: 'utf-8' },
            { label: 'shift_jis', keepBom: false, report: 'cp932' },
          ]
        : [
            { label: norm, keepBom: false, report: norm },
            { label: name.toLowerCase(), keepBom: false, report: norm },
            { label: 'utf-8', keepBom: true, report: 'utf-8' },
            { label: 'shift_jis', keepBom: false, report: 'cp932' },
          ];
    }
  } else {
    candidates = [
      { label: 'utf-8', keepBom: true, report: 'utf-8' },
      { label: 'shift_jis', keepBom: false, report: 'cp932' },
    ];
  }

  for (const c of candidates) {
    try {
      const text = c.ascii
        ? decodeStrictAscii(raw)
        : new TextDecoder(c.label, { fatal: true, ignoreBOM: c.keepBom }).decode(raw);
      return { text, encoding: c.report };
    } catch { // undecodable bytes (TypeError) or unknown label (RangeError)
      continue;
    }
  }
  return { text: new TextDecoder('shift_jis').decode(raw), encoding: 'cp932(replaced)' };
}

// ------------------------------------------------------------------ sections

const SECTION_RE = /^\[([A-Za-z_]+)\]\s*$/gm;
const KV_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Split file into [section_name, body_lines] pairs, in file order. */
export function splitSections(text) {
  const matches = [...text.matchAll(SECTION_RE)];
  const result = [];
  for (let idx = 0; idx < matches.length; idx++) {
    const m = matches[idx];
    const end = idx + 1 < matches.length ? matches[idx + 1].index : text.length;
    const body = text.slice(m.index + m[0].length, end).split(/\r\n|\r|\n/);
    result.push([m[1], body]);
  }
  return result;
}

/** Parse body lines into a kv object.
 *
 * A key that appears more than once (Field=, PageInfo=) maps to an ARRAY of
 * all its raw values in order. Lines without a `Key=` prefix (multi-line
 * value continuation) are appended to the most recent value.
 */
export function parseKvPairs(lines) {
  const kv = {};
  let last = null; // { key, idx } — idx null when the value is not yet an array
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(KV_RE);
    if (m) {
      const key = m[1];
      const value = m[2].trim();
      if (key in kv) {
        if (!Array.isArray(kv[key])) kv[key] = [kv[key]];
        kv[key].push(value);
        last = { key, idx: kv[key].length - 1 };
      } else {
        kv[key] = value;
        last = { key, idx: null };
      }
    } else if (last) { // continuation of a multi-line value
      const { key, idx } = last;
      const cont = '\n' + line.replace(/\s+$/, '');
      if (idx === null) kv[key] += cont;
      else kv[key][idx] += cont;
    }
  }
  return kv;
}

// ------------------------------------------------------------------- model

function fieldRow(value) {
  const cols = parseQuotedCsv(value);
  while (cols.length < 9) cols.push('');
  const col = (i) => cols[i].trim();
  const pkOrder = col(4);
  return {
    lName: col(0),
    pName: col(1),
    type: col(2),
    nullConstraint: col(3),
    pk: pkOrder !== '',
    pkOrder,
    default: col(5),
    comment: col(6),
    color: col(7),
  };
}

/** Prefer Position="page",x,y; fall back to Page=/Left=,/Top=. */
function position(kv) {
  const pos = kv.Position;
  if (pos) {
    const cols = parseQuotedCsv(pos);
    const nums = [];
    let page = null;
    for (let c of cols) {
      c = c.trim();
      if (!c) continue;
      if (FLOAT_RE.test(c)) nums.push(Number(c));
      else page = page || c;
    }
    if (nums.length >= 2) return [page, nums[0], nums[1]];
  }
  const page = kv.Page || null;
  const left = toFloat(kv.Left ?? 0);
  const top = toFloat(kv.Top ?? 0);
  // Python wraps both floats in one try: either both parse or both default 0.
  if (left === null || top === null) return [page, 0, 0];
  return [page, left, top];
}

/** Map Cardinality= to per-side multiplicity, lenient to variants.
 * Understood forms (case-insensitive): 'OneToMany'/'ManyToOne'/'OneToOne'/
 * 'ManyToMany', and ratio strings such as '1:N', 'N:1', '1:1', 'N:N'.
 * Default when absent/unrecognized: one side Entity1, many side Entity2
 * (Fields2 holds the FK — the overwhelmingly common A5M2 layout).
 */
function cardinalityInfo(value) {
  let e1Many = false;
  let e2Many = false;
  let recognized = false;
  const v = (value ?? '').trim();
  if (v) {
    const low = v.toLowerCase();
    if (low.includes('manytomany') || ['n:n', 'n:m', 'm:n'].includes(low)) {
      e1Many = true;
      e2Many = true;
      recognized = true;
    } else if (low.includes('onetomany')) {
      e2Many = true;
      recognized = true;
    } else if (low.includes('manytoone')) {
      e1Many = true;
      recognized = true;
    } else if (low.includes('onetoone') || low === '1:1') {
      recognized = true;
    } else if (v.includes(':')) {
      const sep = v.indexOf(':');
      e1Many = ['N', 'M'].includes(v.slice(0, sep).trim().toUpperCase());
      e2Many = ['N', 'M'].includes(v.slice(sep + 1).trim().toUpperCase());
      recognized = true;
    }
  }
  if (!recognized) { // absent/unrecognized: assume 1:N (Entity2 = FK side)
    e1Many = false;
    e2Many = true;
  }
  return { raw: v, entity1Many: e1Many, entity2Many: e2Many };
}

/** Per-side multiplicity for a [Relation] section, format-version aware.
 *
 * Newer files (FORMAT >= ~16, verified on FORMAT 21) encode the connector
 * symbol in RelationType1/RelationType2 numeric codes — code 3 is the
 * crow's-foot ("many") end; 0/1/2 are one-ish ends. Legacy files instead
 * use a single Cardinality= token. Priority: RelationType codes, then
 * Cardinality=, then the 1:N default (Entity2 holds the FK).
 */
function relationMultiplicity(kv) {
  const t1 = String(kv.RelationType1 ?? '').trim();
  const t2 = String(kv.RelationType2 ?? '').trim();
  if (t1 || t2) {
    const e1 = ['3', 'N', 'n'].includes(t1);
    const e2 = ['3', 'N', 'n'].includes(t2);
    return [e1, e2, `${e1 ? 'N' : '1'}:${e2 ? 'N' : '1'}`];
  }
  const card = cardinalityInfo(kv.Cardinality);
  return [card.entity1Many, card.entity2Many, card.raw];
}

/** Parse raw .a5er bytes into the viewer IR. */
export function parseA5er(raw, sourceName = '') {
  const { text, encoding } = detectAndDecode(raw);

  const fmtMatch = text.match(/A5:ER FORMAT[:=]\s*(\S+)/);
  const toolMatch = text.match(/^(#.*?Version\s+[^\s]+)/m);

  let manager = {};
  const entities = [];
  const relations = [];
  const notes = [];
  const otherSections = new Set();

  for (const [name, body] of splitSections(text)) {
    if (name === 'Entity') {
      const kv = parseKvPairs(body);
      const [page, x, y] = position(kv);
      entities.push({
        pName: kv.PName ?? '',
        lName: kv.LName ?? '',
        comment: kv.Comment ?? '',
        page,
        x,
        y,
        fields: fieldRows(kv),
      });
    } else if (name === 'Relation') {
      const kv = parseKvPairs(body);
      const [e1m, e2m, cardRaw] = relationMultiplicity(kv);
      const [page, x, y] = position(kv);
      relations.push({
        entity1: kv.Entity1 ?? '',
        entity2: kv.Entity2 ?? '',
        fields1: splitFieldList(kv.Fields1 ?? ''),
        fields2: splitFieldList(kv.Fields2 ?? ''),
        cardinality: cardRaw,
        entity1Many: e1m,
        entity2Many: e2m,
        x,
        y,
        page,
      });
    } else if (name === 'Note') {
      const kv = parseKvPairs(body);
      const [page, x, y] = position(kv);
      notes.push({
        text: unquote(kv.Text ?? ''),
        page,
        x,
        y,
      });
    } else if (name === 'Manager') {
      manager = parseKvPairs(body);
    } else {
      otherSections.add(name);
    }
  }

  const pages = collectPages(manager, entities, notes, relations);

  return {
    source: sourceName,
    formatVersion: fmtMatch ? fmtMatch[1] : '',
    tool: toolMatch ? toolMatch[1].replace(/^[# ]+/, '').trim() : '',
    encoding,
    rdbms: managerCsvValue(manager.RDBMSTypeName),
    pages,
    entities,
    relations,
    notes,
    otherSections: [...otherSections].sort(),
  };
}

/** Extract Field= rows from a parsed section (string or repeated-array form). */
function fieldRows(kv) {
  const value = kv.Field ?? '';
  const rows = Array.isArray(value) ? value : (value ? [value] : []);
  return rows.filter((v) => v).map(fieldRow);
}

function splitFieldList(value) {
  if (Array.isArray(value)) return value.flatMap(splitFieldList);
  return parseQuotedCsv(value || '').map((c) => c.trim()).filter((c) => c);
}

function managerCsvValue(value) {
  return value ? parseQuotedCsv(value)[0] : '';
}

/** Union of page names from PageInfo declarations and entity Page= tags.
 * Page names are matched case-insensitively (real files mix 'Main'/'MAIN').
 */
function collectPages(manager, ...groups) {
  const seen = new Map(); // UPPER -> original spelling, insertion-ordered
  const info = manager.PageInfo ?? '';
  for (const line of (Array.isArray(info) ? info : [info])) {
    if (!line) continue;
    const cols = parseQuotedCsv(line);
    if (cols.length && cols[0].trim()) {
      const name = cols[0].trim();
      if (!seen.has(name.toUpperCase())) seen.set(name.toUpperCase(), name);
    }
  }
  for (const group of groups) {
    for (const item of group) {
      if (item.page) {
        const name = item.page.trim();
        if (!seen.has(name.toUpperCase())) seen.set(name.toUpperCase(), name);
      }
    }
  }
  const ordered = [];
  if (seen.has('MAIN')) {
    ordered.push(seen.get('MAIN'));
    seen.delete('MAIN');
  }
  ordered.push(...seen.values());
  return ordered.length ? ordered : ['MAIN'];
}
