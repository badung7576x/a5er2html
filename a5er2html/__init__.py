"""a5er2html — self-contained HTML ER-diagram viewer for A5:SQL Mk-2 .a5er files."""

from .parser import parse_a5er
from .cli import build_html, main

__version__ = '1.0.0'
__all__ = ['parse_a5er', 'build_html', 'main', '__version__']
