"""a5er file parser.

Parses A5:SQL Mk-2 ER-diagram files (.a5er) — a plain-text INI-like format —
into a JSON-serializable intermediate representation (IR).

Format facts (verified against a real FORMAT:15 file, MareMare/ExcelToA5er):
- Header comment lines start with '#'; '# A5:ER ENCODING:UTF8|SJIS' declares
  the file encoding. Older files may omit the declaration (usually SJIS).
- Repeated sections: [Entity], [Relation], [Note], plus one [Manager].
- Key=value lines; Field= / Position= / PageInfo= values are quoted CSV
  ('"' quoted, embedded '"' escaped as '""', unquoted tokens allowed).

Field CSV column layout (9 slots):
  1 logical_name, 2 physical_name, 3 data_type, 4 nullability,
  5 pk_order (blank = not PK), 6 default, 7 comment, 8 color, 9 extra
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------- primitives


def parse_quoted_csv(text: str) -> list[str]:
    """Split a quoted-CSV row. '""' inside quotes is an escaped quote.

    Handles: commas inside quotes, empty slots (',,'), unquoted tokens
    ($FFFFFFFF, bare numbers), and unterminated quotes (lenient tail).
    """
    tokens: list[str] = []
    buf: list[str] = []
    in_quote = False
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if in_quote:
            if ch == '"':
                if i + 1 < n and text[i + 1] == '"':  # escaped quote
                    buf.append('"')
                    i += 2
                    continue
                in_quote = False
            else:
                buf.append(ch)
        elif ch == '"':
            in_quote = True
        elif ch == ',':
            tokens.append(''.join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    tokens.append(''.join(buf))
    return tokens


def unquote(value: str) -> str:
    """Strip one layer of surrounding quotes, honoring '""' escapes."""
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return parse_quoted_csv(value)[0]
    return value


# ------------------------------------------------------------------ decoding

_ENC_HEADER = re.compile(rb'A5:ER ENCODING[:=]\s*([A-Za-z0-9_-]+)')


def detect_and_decode(raw: bytes) -> tuple[str, str]:
    """Return (text, encoding_used). Sniffs the ENCODING header first.

    The header itself is ASCII in both UTF-8 and Shift_JIS files, so a raw
    byte scan is safe. Files without a declaration are tried as UTF-8
    (strict) then Shift_JIS (cp932).
    """
    declared = _ENC_HEADER.search(raw[:512])
    if declared:
        name = declared.group(1).decode('ascii').upper()
        if name in ('UTF8', 'UTF-8'):
            encodings = ('utf-8-sig', 'utf-8')
        elif name in ('SJIS', 'SHIFT_JIS', 'CP932', 'MS932'):
            encodings = ('cp932',)
        else:  # unknown declaration: try declared name, then fallbacks
            encodings = (name.lower().replace('-', ''), 'utf-8', 'cp932')
    else:
        encodings = ('utf-8', 'cp932')

    for enc in encodings:
        try:
            return raw.decode(enc), enc
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode('cp932', errors='replace'), 'cp932(replaced)'


# ------------------------------------------------------------------ sections

_SECTION_RE = re.compile(r'^\[([A-Za-z_]+)\]\s*$', re.MULTILINE)
_KV_RE = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$')


def split_sections(text: str) -> list[tuple[str, list[str]]]:
    """Split file into (section_name, body_lines) pairs, in file order."""
    matches = list(_SECTION_RE.finditer(text))
    result: list[tuple[str, list[str]]] = []
    for idx, m in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        body = text[m.end():end].splitlines()
        result.append((m.group(1), body))
    return result


def parse_kv_pairs(lines: list[str]) -> dict[str, Any]:
    """Parse body lines into a kv dict.

    A key that appears more than once (Field=, PageInfo=) maps to a LIST of
    all its raw values in order. Lines without a `Key=` prefix (multi-line
    value continuation) are appended to the most recent value.
    """
    kv: dict[str, Any] = {}
    last: tuple[str, int | None] | None = None  # (key, index into list)
    for line in lines:
        if not line.strip():
            continue
        m = _KV_RE.match(line)
        if m:
            key, value = m.group(1), m.group(2).strip()
            if key in kv:
                if not isinstance(kv[key], list):
                    kv[key] = [kv[key]]
                kv[key].append(value)
                last = (key, len(kv[key]) - 1)
            else:
                kv[key] = value
                last = (key, None)
        elif last is not None:  # continuation of a multi-line value
            key, idx = last
            if idx is None:
                kv[key] += '\n' + line.rstrip()
            else:
                kv[key][idx] += '\n' + line.rstrip()
    return kv


# ------------------------------------------------------------------- model


def _field_row(value: str) -> dict[str, Any]:
    cols = parse_quoted_csv(value)
    cols += [''] * (9 - len(cols))

    def col(i: int) -> str:
        return cols[i].strip() if i < len(cols) else ''

    pk_order = col(4)
    return {
        'lName': col(0),
        'pName': col(1),
        'type': col(2),
        'nullConstraint': col(3),
        'pk': pk_order != '',
        'pkOrder': pk_order,
        'default': col(5),
        'comment': col(6),
        'color': col(7),
    }


def _position(kv: dict[str, Any]) -> tuple[str | None, float, float]:
    """Prefer Position="page",x,y; fall back to Page=/Left/Top."""
    pos = kv.get('Position')
    if pos:
        cols = parse_quoted_csv(pos)
        nums: list[float] = []
        page: str | None = None
        for c in cols:
            c = c.strip()
            if not c:
                continue
            try:
                nums.append(float(c))
            except ValueError:
                page = page or (c or None)
        if len(nums) >= 2:
            return page, nums[0], nums[1]
    page = kv.get('Page') or None
    try:
        return page, float(kv.get('Left', 0)), float(kv.get('Top', 0))
    except (TypeError, ValueError):
        return page, 0.0, 0.0


def _relation_multiplicity(kv: dict[str, Any]) -> tuple[bool, bool, str]:
    """Per-side multiplicity for a [Relation] section, format-version aware.

    Newer files (FORMAT >= ~16, verified on FORMAT 21) encode the connector
    symbol in RelationType1/RelationType2 numeric codes — code 3 is the
    crow's-foot ("many") end; 0/1/2 are one-ish ends. Legacy files instead
    use a single Cardinality= token. Priority: RelationType codes, then
    Cardinality=, then the 1:N default (Entity2 holds the FK).
    """
    t1 = str(kv.get('RelationType1', '')).strip()
    t2 = str(kv.get('RelationType2', '')).strip()
    if t1 or t2:
        e1 = t1 in ('3', 'N', 'n')
        e2 = t2 in ('3', 'N', 'n')
        return e1, e2, f"{'N' if e1 else '1'}:{'N' if e2 else '1'}"
    card = _cardinality_info(kv.get('Cardinality'))
    return card['entity1Many'], card['entity2Many'], card['raw']

def _cardinality_info(value: str | None) -> dict[str, Any]:
    """Map Cardinality= to per-side multiplicity, lenient to variants.
    Understood forms (case-insensitive): 'OneToMany'/'ManyToOne'/'OneToOne'/
    'ManyToMany', and ratio strings such as '1:N', 'N:1', '1:1', 'N:N'.
    Default when absent/unrecognized: one side Entity1, many side Entity2
    (Fields2 holds the FK — the overwhelmingly common A5M2 layout).
    """
    e1_many = e2_many = False
    recognized = False
    v = (value or '').strip()
    if v:
        low = v.lower()
        if 'manytomany' in low or low in ('n:n', 'n:m', 'm:n'):
            e1_many = e2_many = True
            recognized = True
        elif 'onetomany' in low:
            e2_many = True
            recognized = True
        elif 'manytoone' in low:
            e1_many = True
            recognized = True
        elif 'onetoone' in low or low in ('1:1',):
            recognized = True
        elif ':' in v:
            left, _, right = v.partition(':')
            e1_many = left.strip().upper() in ('N', 'M')
            e2_many = right.strip().upper() in ('N', 'M')
            recognized = True
    if not recognized:  # absent/unrecognized: assume 1:N (Entity2 = FK side)
        e1_many, e2_many = False, True
    return {'raw': v, 'entity1Many': e1_many, 'entity2Many': e2_many}


def parse_a5er(raw: bytes, source_name: str = '') -> dict[str, Any]:
    """Parse raw .a5er bytes into the viewer IR."""
    text, encoding = detect_and_decode(raw)

    fmt_match = re.search(r'A5:ER FORMAT[:=]\s*(\S+)', text)
    tool_match = re.search(r'^(#.*?Version\s+[^\s]+)', text, re.MULTILINE)

    manager: dict[str, Any] = {}
    entities: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    notes: list[dict[str, Any]] = []
    other_sections: set[str] = set()

    for name, body in split_sections(text):
        if name == 'Entity':
            kv = parse_kv_pairs(body)
            page, x, y = _position(kv)
            fields = _field_rows(kv)
            entities.append({
                'pName': kv.get('PName', ''),
                'lName': kv.get('LName', ''),
                'comment': kv.get('Comment', ''),
                'page': page,
                'x': x,
                'y': y,
                'fields': fields,
            })
        elif name == 'Relation':
            kv = parse_kv_pairs(body)
            e1m, e2m, card_raw = _relation_multiplicity(kv)
            page, x, y = _position(kv)
            relations.append({
                'entity1': kv.get('Entity1', ''),
                'entity2': kv.get('Entity2', ''),
                'fields1': _split_field_list(kv.get('Fields1', '')),
                'fields2': _split_field_list(kv.get('Fields2', '')),
                'cardinality': card_raw,
                'entity1Many': e1m,
                'entity2Many': e2m,
                'x': x, 'y': y,
                'page': page,
            })
        elif name == 'Note':
            kv = parse_kv_pairs(body)
            page, x, y = _position(kv)
            notes.append({
                'text': unquote(kv.get('Text', '')),
                'page': page,
                'x': x, 'y': y,
            })
        elif name == 'Manager':
            manager = parse_kv_pairs(body)
        else:
            other_sections.add(name)

    pages = _collect_pages(manager, entities, notes, relations)

    return {
        'source': source_name,
        'formatVersion': fmt_match.group(1) if fmt_match else '',
        'tool': tool_match.group(1).lstrip('# ').strip() if tool_match else '',
        'encoding': encoding,
        'rdbms': _manager_csv_value(manager.get('RDBMSTypeName', '')),
        'pages': pages,
        'entities': entities,
        'relations': relations,
        'notes': notes,
        'otherSections': sorted(other_sections),
    }


def _field_rows(kv: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract Field= rows from a parsed section (str or repeated-list form)."""
    value = kv.get('Field', '')
    rows = value if isinstance(value, list) else ([value] if value else [])
    return [_field_row(v) for v in rows if v]


def _split_field_list(value: Any) -> list[str]:
    if isinstance(value, list):
        out: list[str] = []
        for v in value:
            out.extend(_split_field_list(v))
        return out
    return [c.strip() for c in parse_quoted_csv(value or '') if c.strip()]


def _manager_csv_value(value: str) -> str:
    return parse_quoted_csv(value)[0] if value else ''


def _collect_pages(manager: dict[str, Any], *groups) -> list[str]:
    """Union of page names from PageInfo declarations and entity Page= tags.

    Page names are matched case-insensitively (real files mix 'Main'/'MAIN').
    """
    seen: dict[str, str] = {}
    info = manager.get('PageInfo', '')
    for line in (info if isinstance(info, list) else [info]):
        if not line:
            continue
        cols = parse_quoted_csv(line)
        if cols and cols[0].strip():
            seen.setdefault(cols[0].strip().upper(), cols[0].strip())
    for group in groups:
        for item in group:
            if item.get('page'):
                seen.setdefault(item['page'].strip().upper(), item['page'].strip())
    ordered: list[str] = []
    if 'MAIN' in seen:
        ordered.append(seen.pop('MAIN'))
    ordered.extend(seen.values())
    return ordered or ['MAIN']
