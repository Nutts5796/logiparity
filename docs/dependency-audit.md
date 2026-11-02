# Dependency audit at M1

Checked on 2026-11-02 using npm 11.6.0 and the committed package-lock.json.

| Command | Moderate affected packages | High | Critical |
| --- | --- | --- | --- |
| `npm audit` | 17 | 0 | 0 |
| `npm audit --omit=dev` | 7 | 0 | 0 |

The seven runtime package entries are `archiver`, `archiver-utils`, `exceljs`, `glob`, `minimatch`, `readdir-glob` and `zip-stream`. These are cascading affected-package entries, not seven independent root advisories. The root report is [minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), affecting minimatch versions below 11.0.1. Development lint dependencies account for the additional entries.

Vitest and its coverage provider were upgraded to 4.1.12 to remove the initial mocker/tinypool critical/moderate chain. ExcelJS's old unzipper and uuid versions are overridden to 0.12.5 and 11.1.1 respectively; the former also removes a package without declared license metadata. The root explicitly declares the fixture dependencies so npm correctly accounts for these overrides through workspace edges. `npm ls unzipper uuid` is clean.

The remaining npm recommendations include downgrades or incompatible major replacements; none were applied blindly. Forcing minimatch 11 into legacy callers that expect the earlier callable interface needs its own compatibility review. The current M1 tool uses explicit XLSX entries/rows and local synthetic fixtures rather than accepting arbitrary archive patterns. This is a limited usage surface, not a claim that the dependency advisories are fixed.

Before a public release, the owner must review the remaining chain and choose a tested upstream/override strategy or explicitly document the residual exposure. M1 is unreleased, test/staging only, and is not approved for adversarial files. Repeat the audit after changing the lockfile because counts and advisories can change independently of this document. Runtime license notices, including jszip's MIT alternative and pako's Zlib notice, are inventoried in dependencies.md.
