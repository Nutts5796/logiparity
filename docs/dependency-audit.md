# Dependency audit

The 1.1.0 runtime no longer contains ExcelJS, archiver, glob, minimatch or their writing dependency chain. XLSX reading uses pinned unzipper and saxes packages. ExcelJS remains a development dependency for independent test fixtures only. No vendored runtime code remains.

On 2026-11-03, the packed tarball passed plain npm install, a clean npm ci and npm audit with npm 10.9.9 and 11.6.0. Both consumer audits reported zero vulnerabilities. These checks run without flags that suppress auditing. The empty-cache offline installation is tested separately. Source `npm audit --omit=dev` also reported zero vulnerabilities.

A baseline install and clean npm ci succeeded on both tested npm versions; the separately reported installation crash was not reproduced. Its online vulnerability audit did identify affected runtime dependencies. Replacing the spreadsheet writing chain and removing first-party registry dependencies addresses the independently reproduced audit and signature failures.

The complete development tree reported 19 moderate affected-package entries, no high entries and no critical entries. This includes the development-only ExcelJS writer and lint tooling. These packages are excluded from the distributed CLI. Audit results depend on the advisory feed; repeat both the consumer checks and the source audits for a release.

The streaming reader writes shared strings and a fixed-width offset index to temporary files. Its text cache has a 2 MiB byte budget and its index cache is one 64 KiB block. Temporary disk and index use share a 64 MiB quota; decompression and individual XML tokens are capped before SAX can accumulate them. A fresh-process regression reads a shared-string XML file over 1.1 MB under a 192 MiB RSS budget. Tests also cover 100,000 rows, multiple sheets, inline strings, rich text, numeric and boolean cells, dates, cached formulas, malformed XML and prohibited declarations.

The [runtime license inventory](dependencies.md) is generated from the lockfile. The remaining third-party development schema and its license are checked byte for byte against an immutable upstream tarball by `npm run check:third-party`. The bundled Latin font subsets and complete SIL OFL texts are verified against recorded upstream URLs and SHA-256 hashes. Release preparation produces a CycloneDX inventory of the actual installed tarball, and image builds add their own SBOM and provenance attestations.

## Optional adapters and patchability

Version 1.1.0 ships first-party code under lib/ inside the root package; it does not expose private registry dependency names. The normal CSV/XLSX/REST installation does not install Playwright, pg, pg-query-stream or pgsql-ast-parser. UI and SQL configurations require their optional peers with supported version ranges and explicit install instructions. Third-party normal dependencies can be replaced using consumer overrides; package verification tests a different Luxon patch version. Both profiles are checked with plain npm install, npm ci and npm audit, with audit enabled, on npm 10 and 11. A separate verified kit satisfies empty-cache offline installation without embedding third-party dependencies in the CLI archive.
