# Changelog

## [1.1.0] - 2026-11-04

### Added

- Composite keys and rollups, scalar/list/negated filters, non-key uniqueness, reassignment invariants and scenario validation; a synthetic 120-load freight settlement fixture with facility zones and cancelled TONU loads.
- Optional browser/PostgreSQL peers, installed demo and optional `demo login`, exact patchable runtime dependencies, offline kits and public JSON Schema exports for parity and scenario reports.
- Per-source locale/number/datetime formatting, currencyField partitions, opt-in half-up/half-even money rounding, caseSensitive filters, configurable maxRows/maxFindings/maxResponseBytes, report.fileMode and datetime displayTimezoneField.
- Per-row invalid findings, invalid-row limits, invalid failure selection, configurable pattern support and display timezone; provenance verification and constrained version-bump tooling.

### Changed

- Reports group supported causes, reconcile each currency separately, trace filter changes, list uncertain keys and accurate excluded rows, and share labels/counts across console, Markdown, HTML, JSON and JUnit.
- Clean runs say that all records match; uncertain totals stay in review. Charts use complete page-loss evidence, local facility time, readable labels and contained scrolling. Dispatcher mobile pages contain 50 orders.
- Playwright range is >=1.63.0 <2.0.0 with runtime validation. Node 22+ is required; CI tests 22, 24 and 26. New commits use Conventional Commits.

### Fixed

- Mapping causes now distinguish lagging values from vocabularies using matched rows; known page sizes constrain page-boundary causes; uncertain totals retain explanations in every format. AI explain validates real reports with the shipped schema.
- Release text and schema-version gates, safe pasted tag recipes, reused-asset downstream jobs, quoted octal file modes and report-directory symlink refusal.
- Corrupted diagnostic text from field-label substitution; untyped CSV/XLSX/REST equality; explicit offsets in XLSX date cells; duplicated currency findings and mixed-currency reconciliation; duplicate totals and tolerated changes across filters.
- Interrupted page-boundary patterns, missing post-scenario parity counts, invalid-reference details, bounded timezone advice and scenario/fixture realism.
- Configuration diagnostics, invalid failOn starters, stale demo ports, installed browser checks, CLI argument handling, report layout and documentation consistency.
- Release jobs isolate write authority from npm builds, verify reused artifact/image provenance, attest only artifacts built by the current run, guard refs before checkout, normalize gzip headers and avoid historical version rewrites.

### Security

- SQL URL host-override rejection and effective-port host guards; atomic no-follow bounded report/artifact writers; REST row scanning before array materialization and bounded findings.
- Normalized URL/credential redaction, AI credential tokenization, invisible/control-character removal and redirect refusal.
- Bounded XLSX XML/shared-string/decompression resources and cleanup on exit, SIGINT, SIGTERM and SIGHUP. Scenario fixtures stay inside their directory tree.

### Upgrading from 1.0.x

Install UI/SQL optional peers when needed. Use Node 22+. Text `where` is now case-insensitive by default (`caseSensitive: true` restores exact matching); the first duplicate row counts once in totals. New defaults cap each source at 100,000 physical rows and reports at 10,000 findings, returning exit 2 instead of a former exit 0/1. Raise source maxRows or root maxFindings together with Node heap capacity (for example NODE_OPTIONS=--max-old-space-size=6144). Include the new `invalid` category in explicit failOn lists. Move `../fixtures` beneath the scenario directory; realpaths must stay inside it. Mutation targets require allowedHosts; interpolated environment values are secret unless listed in publicEnv. Money rounding remains explicit. The 21 restored core helpers and AI/scenario compatibility helpers are deprecated until 2.0; see [public API notes](docs/public-api.md#deprecated-compatibility-exports).

## [1.0.0] - 2026-11-02

### Added

- Keyed REST, CSV, XLSX, browser-table and PostgreSQL comparisons with exact money, explicit timezones, aggregates and failure thresholds.
- Console, HTML, Markdown, JSON and JUnit reports, disruption scenarios and local AI draft previews.
- Synthetic delivery fixtures, public APIs, container images and staging CI examples.

[1.1.0]: https://github.com/Nutts5796/logiparity/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Nutts5796/logiparity/releases/tag/v1.0.0
