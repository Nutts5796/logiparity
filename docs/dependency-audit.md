# Dependency audit

Recorded on 2026-11-02 using npm 11.6.0 and the committed package-lock.json.

| Command | Moderate affected packages | High | Critical |
| --- | --- | --- | --- |
| `npm audit` | 17 | 0 | 0 |
| `npm audit --omit=dev` | 7 | 0 | 0 |

The seven runtime package entries are archiver, archiver-utils, exceljs, glob, minimatch, readdir-glob and zip-stream. These are cascading affected-package entries. The root report is [minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), affecting minimatch below 11.0.1. Development lint dependencies account for the additional entries.

Vitest and its coverage provider are pinned to 4.1.12. ExcelJS's unzipper and uuid versions are overridden to 0.12.5 and 11.1.1. Forcing minimatch 11 into legacy callers that expect the earlier callable interface requires compatibility work. The XLSX reader uses explicit workbook entries and rows. Do not supply adversarial export files.

The runtime inventory contains 109 external package versions with declared licenses. It includes Playwright, PostgreSQL parsing/streaming packages and Jiti for trusted local invariant modules. [License inventory](dependencies.md) records third-party notices, including jszip's MIT alternative and pako's Zlib notice. [Build history](development/milestones.md) records implementation checks.

Before distribution, choose a tested dependency strategy or document residual exposure, review the final container image, and repeat the audit against the lockfile. Audit counts can change as advisories are published.
