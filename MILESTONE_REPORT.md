# Milestone report

## M1 — Approved by owner

Date: 2026-11-02. Version: 0.1.0, unreleased. M1 acceptance checks passed and the original delivery stopped at its review gate. The owner subsequently reviewed and approved M1 and explicitly authorized M2 on 2026-11-02. No push, repository creation, release, npm/Docker publication, secrets or git identity changes were performed.

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

1. Completed: the owner reviewed/approved M1 and authorized M2.
2. Before any public release, review the remaining dependency advisories and choose a tested upstream/override strategy; no dependency downgrade or incompatible major replacement was applied automatically.
3. Review the documented source limits (decimal-string money, JSONPath subset and XLSX parser bridge) when prioritizing compatibility work. No production integration or release action is authorized by this report.

## M2 — Implemented, awaiting owner review

Date: 2026-11-02. Version remains 0.1.0, unreleased. Work began after the owner's explicit M1 approval. **M2 acceptance checks passed; work stops here before M3.** No push, releases, publication, secrets or git identity changes were performed.

### Delivered

- Self-contained HTML reports with entity/type filters, text search, visible-count/empty states, escaped data, a hash-restricted inline script and no external assets. Safe relative screenshot links are supported; the UI source adapter remains M3 work.
- JUnit reports with one suite per entity and six cases, one per finding type. Blocking findings become failures, source errors become errors, and permitted observations become skipped cases with explanations. Reports validate against the independently authored, unmodified Apache Ant JUnit XSD from Windy Road, vendored with Apache-2.0 license and checksum.
- Markdown summaries with aggregate values and up to 50 finding details, safe escaping and an explicit omitted count. JSON retains schema version 1 with additive optional blocking/aggregate/screenshot metadata.
- Filtered count and sum aggregates. Money adds bigint minor units. Numeric sums and tolerance comparisons use exact decimal arithmetic on normalized values, including scientific notation generated internally by Number. Duplicate keys contribute once; null sums contribute nothing; incomplete source mappings are recorded as skipped aggregates.
- Entity `failOn` supports the requested category list and an allowed-count mapping. Boundaries are inclusive; category counts span sources within one entity. Every finding remains visible, and source errors always force exit 2.
- `logiparity init [--config path]` writes a commented REST/CSV starter with aggregates and all report outputs. It makes no target calls, requires no env values at generation time, and atomically refuses to overwrite existing files.
- Updated shipped demo YAML, README with an actual HTML report screenshot, configuration/schema/format guides and CI's offline XML-validator installation. Runtime dependencies and package-lock.json are unchanged.

### Verification commands and results

Run from the repository root with Node 20 or 22 and xmllint installed:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
xmllint --nonet --noout --schema tests/fixtures/junit/JUnit.xsd logiparity-report/junit.xml
git diff --check
```

For each runtime, the complete lint/typecheck/unit/e2e sequence was executed sequentially with `PATH=/private/tmp/logiparity-node20/node_modules/.bin:$PATH` or `PATH=/private/tmp/logiparity-node22/node_modules/.bin:$PATH`. The e2e command also builds. Runtime installations remain isolated from the system Node.

| Check | Node 20.20.2 | Node 22.23.4 |
| --- | --- | --- |
| lint | Pass | Pass |
| strict typecheck | Pass | Pass |
| unit/adapter tests | 90 pass, 9 files | 90 pass, 9 files |
| CLI/demo e2e tests | 10 pass, 1 file | 10 pass, 1 file |
| build | Pass | Pass |
| core line coverage | 100% (300/300) | 100% (300/300) |
| core statements / branches / functions | 98.83% / 93.47% / 98.79% | 98.83% / 93.47% / 98.79% |

The 85% core line threshold remains enforced; no tests are skipped. M1 adapter/bug regressions are preserved. New cases cover aggregate filters, exact monetary/decimal sums, decimal tolerance boundaries, numeric overflow, partial mappings, duplicate/null/empty data, thresholds at/above their limit, report-only mode, unsuppressible runtime errors, init/overwrite protection, output writes and hostile markup. JUnit tests validate pass/failure/skipped/error reports and reject a deliberately invalid document, using `--nonet`. The 100,000-record engine test now includes aggregate counts and exact money totals; REST/CSV/XLSX size checks remain in the suite.

### Demo and report acceptance

The shipped `examples/demo/parity.yaml` now selects all five outputs, delivered_count and payout_total aggregates. Reproduction:

```sh
# Terminal 1
npm run demo:bugs
# Terminal 2, at the repository root
export DEMO_API_URL=http://127.0.0.1:3010
npm run demo:export
./node_modules/.bin/logiparity check --config examples/demo/parity.yaml
```

Observed exit 1 and **301 findings**: 14 missing XLSX rows, 284 one-cent payout mismatches, and 3 aggregate mismatches. Aggregate values were:

| Aggregate | API reference | XLSX export | CSV export |
| --- | ---: | ---: | ---: |
| delivered_count | 1833 | 1823 | 1833 |
| payout_total (USD cents) | 682625 | 678433 | 682483 |

The resulting JUnit validates and contains six cases, three failing finding-type groups, zero errors and zero skipped cases. The Markdown summary explicitly omits 251 findings beyond its first 50. HTML/JSON contain all 301. The prior individual bug on/off matrix still passes. The generated starter was run end to end against the bug-free demo, including aggregates and all outputs, with exit 0.

For `failOn: {missing: 14, mismatch: 284}` without aggregates, all 298 ordinary findings remain visible and exit is 0. Lowering missing to 13 makes the 14 missing findings blocking and exits 1. Report-only mode also exits 0 while retaining findings; removing an export then forces exit 2. Invalid threshold config and failed report writes return 2.

Review artifacts remain locally in `logiparity-report/`: report.html, report.json, junit.xml and report.md. `docs/images/report.png` is a committed 1440×1000 capture of the actual synthetic demo report, not a mockup.

### Browser QA

Used the local playwright skill and a dedicated `logiparity-m2` Chromium session. The tool blocks file:// URLs, so QA served only the report directory on loopback via `python3 -m http.server 3908 --bind 127.0.0.1 --directory logiparity-report`. No hosting or deployment was performed.

Verified the real report's 301 → 3 aggregate-filter count, combined filters with no matches, key search (`S000001` → 2 rows), and reset. A separate ignored synthetic fixture added a second entity and hostile HTML-like text: entity filter showed 1 of 302, combined missing-record filtering showed 14, no injected image/script was created or executed, and the 390×844 viewport had no page-level horizontal overflow. Desktop and mobile screenshots were inspected. Browser console: 0 errors and 0 warnings. Network inspection showed no non-static requests; the local server logged HTML document GETs, and the report references no external assets. The dedicated browser and both temporary servers were stopped after QA.

Raw screenshots/snapshots are ignored in output/playwright and .playwright-cli. Browser QA is for the HTML reporter; M3's dispatcher UI/Playwright source-adapter tests are not claimed here.

### Known gaps and owner decisions

1. Review M2 and the documented threshold semantics before authorizing M3. In particular, allowed counts apply per entity/category across sources, and omitted categories in a mapping are observations.
2. JUnit's strict Ant schema requires timestamp/hostname/time fields. The report uses its actual UTC generation time and portable localhost label; timing is unmeasured, explicitly marked with a schema-required zero placeholder. JUnit timestamps vary between runs; comparison data/order remain deterministic. These fields are not benchmarks.
3. Partial sources skip aggregates missing any mapped input; skipped names are visible in summaries. If every compared source skips an aggregate, no mismatch can be concluded from it. Review mappings before relying on a total.
4. Tests now require the development tool xmllint; CI installs libxml2-utils. No new npm/runtime dependency was added. M1's recorded dependency advisories and source-format limits remain applicable and are not presented as fixed in M2.
5. Markdown is deliberately a 50-finding comment summary; select HTML/JSON for complete details. UI/SQL adapters remain M3, scenarios remain M4, AI remains M5, and release packaging remains M6. No next milestone or release action is authorized by this report.
