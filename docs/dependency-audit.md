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

## M3 recheck (2026-11-02)

After adding pinned Playwright 1.64.1, pg 8.23.1, pg-query-stream 4.17.1 and pgsql-ast-parser 12.0.2, npm audit still reports 17 moderate affected-package entries, zero high and zero critical. Runtime-only audit still reports 7 moderate entries in the existing ExcelJS/glob/minimatch chain. No new affected-package names appeared. The full 108-version runtime license inventory was regenerated; all entries have declared permissive license metadata. These are observed audit results, not a claim that the older advisories have been remediated.

## M4 recheck (2026-11-02)

Adding Jiti 2.7.0 (MIT, no external dependencies) for explicitly configured TypeScript invariant modules leaves audit counts unchanged: 17 moderate entries overall, 7 moderate runtime entries, zero high/critical. The affected package names are unchanged from M3. The regenerated runtime inventory contains 109 package versions, all with declared licenses. Jiti's programmatic async import and disabled filesystem/module caches follow its [primary documentation](https://github.com/unjs/jiti); it is a loader for trusted local modules, not a sandbox.
