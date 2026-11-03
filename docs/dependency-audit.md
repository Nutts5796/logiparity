# Dependency audit

The 1.1.0 runtime no longer contains ExcelJS, archiver, glob, minimatch or their writing dependency chain. XLSX reading uses pinned unzipper and saxes packages. ExcelJS remains a development dependency for independent test fixtures only. No vendored runtime code remains.

On 2026-11-03, the packed tarball passed plain npm install, a clean npm ci and npm audit with npm 10.9.9 and 11.6.0. Both consumer audits reported zero vulnerabilities. These checks run without flags that suppress auditing. The empty-cache offline installation is tested separately. Source `npm audit --omit=dev` also reported zero vulnerabilities.

The previous M9 tarball was checked as a baseline on the same two npm versions. Install and npm ci succeeded in this environment, so the reported null.trim crash was not reproduced here. Its consumer audit did fail and reported 12 moderate affected-package entries, including the ExcelJS writing chain and bundled private package names. Removing that runtime chain avoids depending on registry metavulnerability calculations for it; the fix is proven with a local tarball and does not rely on publication.

The complete development tree reported 19 moderate affected-package entries, no high entries and no critical entries. This includes the development-only ExcelJS writer and lint tooling. These packages are excluded from the distributed CLI. Audit results depend on the advisory feed; repeat both the consumer checks and the source audits for a release.

The streaming reader writes shared strings and a fixed-width offset index to temporary files. Its text cache has a 2 MiB byte budget and its index cache is one 64 KiB block. Temporary disk and index use share a 64 MiB quota; decompression and individual XML tokens are capped before SAX can accumulate them. A fresh-process regression reads a shared-string XML file over 1.1 MB under a 192 MiB RSS budget. Tests also cover 100,000 rows, multiple sheets, inline strings, rich text, numeric and boolean cells, dates, cached formulas, malformed XML and prohibited declarations.

The [runtime license inventory](dependencies.md) is generated from the lockfile. The remaining third-party development schema and its license are checked byte for byte against an immutable upstream tarball by `npm run check:third-party`. The bundled Latin font subsets and complete SIL OFL texts are verified against recorded upstream URLs and SHA-256 hashes. Release preparation produces a CycloneDX inventory of the actual installed tarball, and image builds add their own SBOM and provenance attestations.
