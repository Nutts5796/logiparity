# Milestone report

## M1 — Implemented, awaiting owner review

Date: 2026-11-02. Version: 0.1.0, unreleased. M1 acceptance checks passed. **Work stops here: M2 has not started.** No push, repository creation, release, npm/Docker publication, secrets or git identity changes were performed.

### Delivered

- npm workspaces for core, adapters, CLI, demo, and clearly marked future scenarios/AI workspaces; strict ESM TypeScript and pinned tooling.
- YAML/Zod validation with config paths, parsed-scalar env/template interpolation, environment-based auth, and actionable errors.
- Streaming REST (page/offset/cursor/Link, auth, retries, timeouts), CSV and XLSX adapters behind a shared interface.
- Keyed reference comparison with missing/extra records, field mismatches, duplicate keys, partial source mappings and source-error handling. Failed source reads do not generate incomplete parity conclusions.
- Trim/case/enum/locale normalization, arbitrary-precision integer minor-unit money, timezone-aware UTC datetimes with DST ambiguity/gap rejection, and deterministic finding order.
- `logiparity check` with console and versioned JSON reports; exit codes 0/1/2. npm bin works after installation/build.
- Loopback-only synthetic demo: 55 drivers/vehicles, 2,750 orders, routes, payouts, notifications, paginated list/detail APIs, status filtering, daily CSV/XLSX exports, two independent M1 bug flags and `demo:bugs`.
- Unit/adapter/e2e coverage, including 100,000 records in each source format and engine stream. Regression fixtures cover ExcelJS multi-sheet metadata ordering across 50 reads.
- MIT license, current-feature README and config/adapter/report/dependency guides. CI configuration for Node 20 and 22 is committed; no GitHub CI execution is claimed.

### Verification commands and results

After `npm ci` (the clean-install verification used `--cache /private/tmp/logiparity-npm-cache --ignore-scripts`), run from the repository root:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
node scripts/dependencies.mjs
npm ls unzipper uuid
git diff --check
```

Both runtime installations were isolated under `/private/tmp` and did not replace the system Node. Each Node 20/22 command used `PATH=/private/tmp/logiparity-node20/node_modules/.bin:$PATH` or `PATH=/private/tmp/logiparity-node22/node_modules/.bin:$PATH` respectively. Node runs were completed separately to avoid sharing the coverage output directory.

| Check | Node 20.20.2 | Node 22.23.4 |
| --- | --- | --- |
| lint | Pass | Pass |
| strict typecheck | Pass | Pass |
| unit/adapter tests | 69 pass, 7 files | 69 pass, 7 files |
| CLI/demo e2e tests | 7 pass, 1 file | 7 pass, 1 file |
| build (also part of test:e2e) | Pass | Pass |
| core line coverage | 100% (163/163) | 100% (163/163) |
| core statements / branches / functions | 98.23% / 92.92% / 94.87% | 98.23% / 92.92% / 94.87% |

Core coverage excludes type-only declarations and the export barrel. The minimum enforced line threshold is 85%. No test is skipped. Functional size tests cover 100,000 rows each for REST, CSV and XLSX and 100,000 records in each of two engine streams. No cross-machine benchmark or measured peak-memory guarantee is claimed. Playwright tests do not apply until the UI adapter in M3.

### Acceptance evidence

The shipped example was also exercised manually using the README commands:

Terminal 1:

```sh
npm run demo
```

Terminal 2:

```sh
export DEMO_API_URL=http://127.0.0.1:3010
npm run demo:export
./node_modules/.bin/logiparity check --config examples/demo/parity.yaml
```

Result: **0 findings, exit 0**. After stopping the normal demo and starting `npm run demo:bugs`, the same export/check sequence produced **298 findings, exit 1**: 14 missing XLSX records plus 284 payout mismatches across CSV/XLSX. Both demo processes were stopped after verification.

| Flags | Expected and observed result |
| --- | --- |
| Both off | 2,750 rows in API, XLSX and CSV; zero findings, exit 0. |
| `BUG_EXPORT_DROPS_LAST_ROW=1` only | 14 missing XLSX keys: `S000200` through `S002600` in increments of 200, plus `S002750`; exit 1. |
| `BUG_ROUNDING_PAYOUT=1` only | 142 affected keys per export format, 284 payout mismatches; every actual value is exactly one cent below expected; exit 1. |
| Both on | The union above: 298 findings, exit 1. |

For `S000001`, API payout `1.01` normalizes to expected `101` USD cents; both broken exports normalize to actual `100`. E2E tests verify the entire frozen affected-key set, not just this example. Repeating a check yields the same JSON content and console output. Invalid arguments/config, missing files, source errors and an unwritable report destination return 2.

The last manual bug report is available locally at `logiparity-report/report.json`; exports and reports are ignored by git and regenerate from the commands above.

### Dependencies and known gaps

- Six direct external runtime dependencies, with 82 locked runtime package versions inventoried in `docs/dependencies.md`; none have unknown license metadata. jszip uses its MIT option; pako retains MIT and Zlib notices.
- `npm audit`: **17 moderate affected-package entries, 0 high, 0 critical**. Runtime-only audit: **7 moderate affected-package entries**, all in the older glob/minimatch/archiver/ExcelJS chain. These are cascading affected-package counts. See `docs/dependency-audit.md`; remaining advisories are not fixed or hidden. This is not public-release security approval.
- ExcelJS's unzipper/uuid overrides are pinned and exercised by XLSX tests. Lazy ZIP entry reading uses a narrow typed bridge to pinned ExcelJS internals to avoid upstream #3064; any ExcelJS upgrade must retest that bridge. `npm ls unzipper uuid` succeeds.
- Money inputs must be decimal strings (XLSX text cells); numeric monetary cells are rejected to avoid hiding precision loss. Number parsing supports Latin digits and locale grouping/separators, not every numeral system.
- JSONPath is a documented, non-evaluating property/index/wildcard subset. Encrypted workbooks and nonstandard worksheet entry paths are not supported.
- The engine keeps two indexed sources and all findings in memory; XLSX shared strings also require memory. The size tests verify correctness, not a fixed RAM budget.
- HTML/JUnit/Markdown, aggregates, failOn/init are M2; dispatcher UI/login, UI/SQL adapters and two related bug flags are M3; scenarios/events/virtual clock/invariants and the final two bug flags are M4; AI is M5; full release docs, screenshots, templates, Docker and packaging are M6. No inactive feature is presented as implemented.

### Owner decisions

1. Review M1 behavior, source/reference semantics and the reproduction results before authorizing M2.
2. Before any public release, review the remaining dependency advisories and choose a tested upstream/override strategy; no dependency downgrade or incompatible major replacement was applied automatically.
3. Review the documented source limits (decimal-string money, JSONPath subset and XLSX parser bridge) when prioritizing compatibility work. No production integration or release action is authorized by this report.
