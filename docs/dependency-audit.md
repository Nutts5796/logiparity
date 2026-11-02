# Dependency audit

Recorded on 2026-11-03 with npm 11.6.0 and the 1.0.1 lockfile.

| Command | Moderate affected packages | High | Critical |
| --- | --- | --- | --- |
| `npm audit` | 16 | 0 | 0 |
| `npm audit --omit=dev` | 6 | 0 | 0 |

The six runtime entries are archiver, archiver-utils, glob, minimatch, readdir-glob and zip-stream. These are cascading affected-package entries for [minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), affecting minimatch below 11.0.1. The private ExcelJS runtime still uses that archiver chain; its private package name is not separately counted by npm audit. Development lint dependencies account for the additional entries.

Vitest and its coverage provider are pinned to 4.1.12. The private vendored ExcelJS 4.4.0 manifest explicitly requires unzipper 0.12.5 and uuid 11.1.1; its Node runtime is unchanged. Consumer lockfiles therefore agree with the bundled tree without root overrides. Upstream integrity, changes and retained MIT attribution are recorded in [vendor provenance](../vendor/exceljs/PROVENANCE.md).

Forcing minimatch 11 into legacy callers expecting the earlier callable interface requires compatibility work. The remaining moderate advisory is tracked as a dependency limitation. The XLSX reader uses explicit workbook entries and rows; this does not establish that arbitrary hostile files are safe. Container publication still requires reviewing the final image and its dependency inventory.

The [license inventory](dependencies.md) lists runtime package versions and notices, including the vendored ExcelJS license, jszip's MIT alternative and pako's Zlib notice. Release preparation generates a CycloneDX SBOM from the installed tarball's bundled tree. Counts can change as advisories are published; repeat both audit commands against the release lockfile. [Build history](development/milestones.md) records the verification performed.
