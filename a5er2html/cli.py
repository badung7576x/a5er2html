"""Command-line interface: .a5er file -> self-contained HTML viewer.

Usage:
    python3 -m a5er2html input.a5er [-o output.html]

Output defaults to <input>.html next to the source file. The generated HTML
is fully offline (no server, no network) — open it in any browser.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .parser import parse_a5er

TEMPLATE = Path(__file__).resolve().parent / 'viewer_template.html'
PLACEHOLDER = '__A5ER_DATA__'


def build_html(ir: dict) -> str:
    """Inject the parsed IR into the viewer template as a JSON payload."""
    template = TEMPLATE.read_text(encoding='utf-8')
    if PLACEHOLDER not in template:
        raise RuntimeError('viewer template is missing the data placeholder')
    payload = json.dumps(ir, ensure_ascii=False).replace('<', '\\u003c')
    return template.replace(PLACEHOLDER, payload)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog='a5er2html',
        description='Generate a self-contained HTML ER-diagram viewer from a .a5er file.')
    ap.add_argument('input', type=Path, help='source .a5er file')
    ap.add_argument('-o', '--output', type=Path, default=None,
                    help='output .html path (default: <input>.html)')
    args = ap.parse_args(argv)

    src = args.input
    if not src.is_file():
        print(f'Error: file not found: {src}', file=sys.stderr)
        return 1
    try:
        raw = src.read_bytes()
    except OSError as exc:
        print(f'Error: cannot read {src}: {exc}', file=sys.stderr)
        return 1

    ir = parse_a5er(raw, source_name=src.name)
    if not ir['entities']:
        print('Warning: no [Entity] sections found — HTML is still generated.',
              file=sys.stderr)

    out = args.output or src.with_suffix('.html')
    out.write_text(build_html(ir), encoding='utf-8')

    print(f'OK  {src} -> {out}')
    print(f'    encoding={ir["encoding"].replace("-sig", "")}  format={ir["formatVersion"] or "?"}  '
          f'pages={len(ir["pages"])}  entities={len(ir["entities"])}  '
          f'relations={len(ir["relations"])}  notes={len(ir["notes"])}')
    return 0
