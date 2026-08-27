# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-27

### Added

- Rearrangeable layout in the viewer: drag table cards and `[Note]` stickies
  to reposition them; relation edges re-anchor live while dragging.
- Layout persistence: dragged positions are saved to localStorage (keyed by
  a hash of the diagram payload) and restored on reload; degrades to
  session-only where storage is unavailable (e.g. `file://` in some browsers).
- **Reset layout** toolbar button to restore the original `.a5er` positions.
- `Esc` cancels an in-progress drag; a click is distinguished from a drag by
  a 4 px threshold so selection still works.

### Fixed

- `refine()` double-bound card click listeners (together with `render()`),
  which made "click a table to highlight its relations" a silent no-op
  whenever `refine()` widened any card.

## [1.0.0] - 2026-08-27

### Added

- Initial public release.
- `.a5er` parser: encoding sniffing (UTF-8, UTF-8 BOM, Shift_JIS/CP932, with
  and without `# A5:ER ENCODING:` declaration), `[Manager]` / `[Entity]` /
  `[Relation]` / `[Note]` sections, quoted-CSV values with `""` escapes.
- Cardinality handling: `OneToMany` / `ManyToOne` / `OneToOne` / `ManyToMany`,
  ratio strings (`1:N`, `N:1`, `N:N`), and FORMAT ≥ 16 `RelationType1/2`
  numeric codes; default 1:N with the FK on Entity2.
- Self-contained HTML viewer: multi-page tabs, logical/physical name toggle,
  live search, crow's-foot relation edges, PK/FK markers, notes, pan/zoom/fit,
  hover tooltips. English UI; works fully offline.
- CLI: `python3 -m a5er2html` and installable `a5er2html` console command.
- Example fixtures covering encodings, multi-page, composite keys, zero-field
  entities, dangling relations, and degenerate files.
- Unit + end-to-end test suite (30 tests) and GitHub Actions CI.

### Fixed

- Restored the missing `Fit` toolbar button whose JS binding crashed viewer
  initialization (blank page) in the pre-release template.
