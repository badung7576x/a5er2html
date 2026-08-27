# Contributing

Thanks for your interest in improving `a5er2html`!

## Getting started

```console
$ git clone https://github.com/OWNER/a5er2html.git
$ cd a5er2html
$ python3 -m unittest discover -s tests -v
$ cd node && npm test
```

Python **3.9+**, standard library only — no virtualenv required (but welcome).
The Node.js port (`node/`) targets Node **20+** with zero npm dependencies.
If you add a third-party dependency to either implementation, the PR will be
rejected: staying dependency-free is a project goal.

## Layout

```
a5er2html/parser.py           .a5er -> JSON intermediate representation
a5er2html/cli.py              CLI + template injection (build_html, main)
a5er2html/viewer_template.html single-file viewer (HTML + CSS + JS)
node/src/parser.js            Node.js port of parser.py (same IR)
node/src/cli.js               Node.js port of cli.py (bin: a5er2html)
node/viewer_template.html     shipped copy of the viewer template (must stay
                              byte-identical to a5er2html/viewer_template.html)
node/test/                    node:test suite incl. Python-parity check
tests/                        unittest suite
examples/                     .a5er fixtures used by the tests (small, synthetic)
```

## Workflow

1. **Bugs / parser gaps** — add the smallest synthetic `.a5er` snippet that
   reproduces the case to `examples/` (never commit a real schema), then add a
   test in `tests/test_parser.py` asserting the expected parse result.
2. **Viewer changes** — edit `a5er2html/viewer_template.html`, regenerate the
   demo (`python3 -m a5er2html examples/sample-utf8.a5er`), and check it in
   so reviewers can open `examples/sample-utf8.html` directly. Then sync the
   Node copy (`cp a5er2html/viewer_template.html node/viewer_template.html`)
   — a test fails CI until both are byte-identical.
3. **Keep the viewer self-contained** — no CDN links, no external assets, no
   build step. The template must stay a single file.
4. Run the full suite before committing.

## Commit style

Short imperative subject line (`parser: accept lowercase page tags`), body
explains *why* when it is not obvious.

## Reporting bugs

Open an issue with: the `a5er2html` version, Python version, OS/browser, and
the smallest `.a5er` fragment that triggers the problem (redact anything
sensitive — table and field names are usually enough).

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
