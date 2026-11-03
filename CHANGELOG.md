# Changelog

## [Unreleased]

## [1.0.1]

### Fixed

- HTML reports use the Studio layout, readable labels, offline fonts and light and dark themes.
- Pattern charts merge matching causes across sources and filter the paginated finding table.
- Money totals reconcile missing rows and pattern deltas with an honest unexplained remainder.
- Human reports show readable UTC dates and currency values with a separate difference. Raw JSON and JUnit values remain unchanged.
- The demo dispatcher shows local depot time, a UTC toggle, operational counts and stacked mobile rows.

- Consumer projects can install the tarball, run npm ci and run npm audit without audit suppression. The runtime no longer includes ExcelJS or its archiver chain.
- XLSX reading streams XML and stores shared strings on disk with a bounded memory cache.
- Short secrets no longer corrupt unrelated words, and encoded credentials are redacted from diagnostics.
- AI previews mask URL userinfo, authorization schemes and credentials in free text.
- Configuration checks report all missing environment variables and identify invalid field paths.
- Datetime formats can be selected per source while other sources keep ISO parsing.
- Rollup conflicts report observed values with line numbers, and duplicate messages state the excluded amount.
- Warnings appear in every report without being counted as findings.
- Page-boundary patterns explain a matching missing final key, and truncated reports prioritize unexplained findings.
- Demo payouts use realistic stop amounts and name all six synthetic defects.

### Added

- Release retries verify existing GitHub assets and npm integrity before skipping completed publication steps.
- Manual image-only retries use the same checksummed npm tarball and preserve provenance and SBOM attestations.
- Both container variants support amd64 and arm64. Packaged templates select a version tag and explain optional digest pinning.
- Minimal scenario invariants warn when they cannot prove that replanning ran.
- Repository formatting and upstream third-party fixture verification run in CI.

## [1.0.0] - 2026-11-02

### Added

- Keyed REST, CSV, XLSX, browser-table and PostgreSQL comparisons, exact money/timezone normalization, aggregates and failure thresholds.
- Console, HTML, Markdown, JSON and JUnit reports with screenshots, pattern groups and missing/extra record strides.
- REST completion metadata, strict short-first-page checks, opt-in numeric money, per-key rollups and a freight settlement example.
- Disruption scenarios, optional/fixed/polled waits, selected operational invariants, trusted custom checks and a synthetic delivery demo.
- Optional AI drafts with local previews, explicit sending, credential redaction and non-execution guarantees.
- Version/config validation commands, a bundled standalone package, public APIs, full/slim containers, checksum release assets and staging CI templates.
- Read-only SQL guards, browser-origin checks, scenario path guards, explicit module opt-in and diagnostic sanitization.
- Configuration, onboarding, design, contributor, security and dependency audit documentation.
