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

## M2 — Approved by owner

Date: 2026-11-02. Version remains 0.1.0, unreleased. Work began after the owner's explicit M1 approval. M2 acceptance checks passed and delivery stopped at its review gate. The owner subsequently approved M2 and explicitly authorized M3, including human-readable currency display, on 2026-11-02. No push, releases, publication, secrets or git identity changes were performed.

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

1. Completed: the owner approved M2 and authorized M3. In particular, allowed counts apply per entity/category across sources, and omitted categories in a mapping are observations.
2. JUnit's strict Ant schema requires timestamp/hostname/time fields. The report uses its actual UTC generation time and portable localhost label; timing is unmeasured, explicitly marked with a schema-required zero placeholder. JUnit timestamps vary between runs; comparison data/order remain deterministic. These fields are not benchmarks.
3. Partial sources skip aggregates missing any mapped input; skipped names are visible in summaries. If every compared source skips an aggregate, no mismatch can be concluded from it. Review mappings before relying on a total.
4. Tests now require the development tool xmllint; CI installs libxml2-utils. No new npm/runtime dependency was added. M1's recorded dependency advisories and source-format limits remain applicable and are not presented as fixed in M2.
5. Markdown is deliberately a 50-finding comment summary; select HTML/JSON for complete details. UI/SQL adapters remain M3, scenarios remain M4, AI remains M5, and release packaging remains M6. No next milestone or release action is authorized by this report.

## M3 — Approved by owner

Date: 2026-11-02. Version remains 0.1.0, unreleased. M2 was approved by the owner before M3 began. The owner also requested major-unit currency display beside minor units in HTML/Markdown, with JSON unchanged. M3 acceptance checks passed and the original delivery stopped at its review gate. The owner subsequently approved M3 and explicitly authorized M4 on 2026-11-02. No push, release, publication, real credentials or git identity changes were performed.

### Delivered

- Playwright/Chromium UI adapter: optional saved authentication, CSS table/row/cell extraction, optional async readiness marker, bounded pagination and repeated-page detection. Cells are extracted in batches per page; only page hashes are retained for loop detection. Contexts are isolated and cleaned up on completion/cancellation. HTTP requests are limited to configured origins; service workers and WebSockets are blocked.
- UI read failures save a real PNG where a page is available. The existing optional screenshot field is retained by the engine and linked safely by HTML reports. A CLI e2e test verifies the image bytes, link and exit 2.
- Server-rendered demo dispatcher with public synthetic login, one-hour sessions, date/status filters, 200-row pages and logout. Session state is ignored/private; restarting the demo requires logging in again. The fixed snapshot is 14:00 UTC; virtual-clock/event endpoints remain M4.
- BUG_STATUS_STALE_UI and BUG_TZ_SHIFT_EXPORT, independently configurable and included in demo:bugs. Normal exports use explicit UTC offsets; the timezone bug violates that contract with unzoned Chicago wall clocks. Both demo configs declare UTC fallback for those export fields.
- PostgreSQL adapter with a real AST guard before credentials/connections, bound parameters, a restricted function surface and a READ ONLY transaction. Query rows stream in bounded batches; numeric/int8 remain exact strings and naive timestamps retain wall-clock text. Streams, transactions and clients are cleaned up. A real PostgreSQL write-through view test confirms server rejection and zero inserted rows.
- Currency equivalents beside money minor units in HTML/Markdown, for field mismatches and sum aggregates: `682625 ($6,826.25)`. Bigint formatting preserves very large amounts, negative sub-unit signs and currencies with 0/2/3 fractional digits. Presentation context is separate from Report; JSON values/structure/schema/units remain unchanged, with byte-for-byte regression checks. Console/JUnit still use minor units.
- Pinned dependencies, updated licenses/audit, PostgreSQL smoke config, UI demo config/login helper, CI browser installation and an ephemeral PostgreSQL service. Scenarios/AI workspaces remain unchanged placeholders.

### Verification commands and results

Prerequisites: Node 20/22, the pinned Chromium revision, xmllint and PostgreSQL initdb/pg_ctl (or the dedicated disposable loopback test URL). Run from the repository root:

```sh
npm ci
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
node scripts/dependencies.mjs
npm ls --depth=0
git diff --check
```

A fresh lockfile installation also passed with `npm ci --cache /private/tmp/logiparity-npm-cache --ignore-scripts`. Browser installation is explicit, not a runtime download. Complete lint/typecheck/unit/e2e sequences used isolated runtimes via `PATH=/private/tmp/logiparity-node20/node_modules/.bin:$PATH` and the corresponding node22 path, sequentially to avoid coverage collisions.

| Check | Node 20.20.2 | Node 22.23.4 |
| --- | --- | --- |
| lint / strict typecheck / build | Pass | Pass |
| unit/adapter tests | 148 pass, 13 files | 148 pass, 13 files |
| CLI/demo e2e tests | 16 pass, 1 file | 16 pass, 1 file |
| core line coverage | 100% (326/326) | 100% (326/326) |
| statements / branches / functions | 98.92% / 94.71% / 98.92% | 98.92% / 94.71% / 98.92% |

No test is skipped. The 85% core line threshold remains enforced. PostgreSQL integration uses a real isolated PostgreSQL 14.16 server locally, not a mock. Tests create/remove their own temporary clusters and random fixture schemas; no pre-existing database was used. CI is configured for an ephemeral PostgreSQL 16 service but has not run on GitHub. Read-only validation covers modifying/nested CTEs, multiple statements, SELECT INTO, row locks, custom/operational function calls, parameter injection, view-based writes, cancellation and statement timeout. Functional size tests exercise 100,000 rows for the engine, REST, CSV, XLSX and PostgreSQL. UI tests exercise pagination with 201 and 2,750 rows; no 100,000-row browser timing/memory benchmark is claimed.

### Bug and presentation acceptance

The M1/M2 flag matrix remains passing. New CLI checks use real Chromium login/storageState and verify all affected keys, not just counts:

| M3 flags (M1 flags off) | Observed result with UI config |
| --- | --- |
| Both off | Zero findings, exit 0, all four sources contain 2,750 records. |
| Stale UI only | 315 status mismatches and one delivered-count mismatch, exit 1. |
| Timezone export only | 1,833 datetime mismatches per complete export, 3,666 total, exit 1. |
| Both M3 flags | 3,982 findings, exit 1. |

Stale keys start with S000051, S000053, S000054, S000056, S000057, S000059, S000060 and repeat every 60 orders (315 affected). Datetime findings cover every delivered order; the chosen date shifts values by exactly six hours. An unreadable UI produces exit 2 and a linked PNG. SQL CLI checks pass with matching API/database values and reject DELETE before reading an intentionally absent connection variable; fixture row count remains unchanged.

The actual shipped UI example was also run manually:

```sh
# Start the demo with npm run demo:bugs (or its already-built node entrypoint).
export DEMO_API_URL=http://127.0.0.1:3010
export DEMO_UI_URL=$DEMO_API_URL
npm run demo:export
npm run demo:login
./node_modules/.bin/logiparity check --config examples/demo/parity-ui.yaml
xmllint --nonet --noout --schema tests/fixtures/junit/JUnit.xsd logiparity-report/junit.xml
```

With all four bugs, observed exit 1 and **4,273 findings**: 14 missing, 4,255 field and 4 aggregate mismatches. The API/file-only config produces 3,957 findings. Aggregate results:

| Aggregate | API | XLSX | CSV | UI |
| --- | ---: | ---: | ---: | ---: |
| delivered_count | 1833 | 1823 | 1833 | 1518 |
| payout_total (USD cents) | 682625 | 678433 | 682483 | 682625 |

JUnit validates against the independent offline XSD. HTML and Markdown show `682625 ($6,826.25)` while JSON contains only the existing `"682625"` value. Unit tests compare JSON before/after human rendering/writing, including a value greater than Number.MAX_SAFE_INTEGER. The final review reports remain under ignored logiparity-report; the synthetic auth file is mode 0600 and ignored. The PostgreSQL smoke example's config and SELECT grammar were validated without modifying a database.

### Browser QA and dependencies

In a dedicated logiparity-m3 browser session, the generated report was served on loopback and checked for its exact currency/minor pair. Searching `$6,826.25` selected exactly two findings, and reset restored all 4,273. The actual dispatcher login, 200-row first page and known stale S000051 row were checked in Chromium. Dispatcher and report layouts passed the 390-pixel page-overflow check. Screenshots in docs/images are captures of the synthetic UI/report, not mockups. Automated Playwright tests additionally verify invalid credentials, date/status filtering, logout, saved-state isolation, blocked asset origins/WebSockets and failure screenshots. Both review servers and the dedicated browser session were stopped after QA.

Ten direct external runtime dependencies are pinned. The regenerated inventory records 108 package versions with declared licenses, including the SQL parser's transitive railroad-diagrams CC0-1.0 declaration. npm audit reports **17 moderate affected-package entries, 0 high, 0 critical**; runtime-only audit remains **7 moderate** in the previously documented ExcelJS/glob/minimatch chain. No new affected-package names appeared. Those advisories are not fixed or hidden by M3; see docs/dependency-audit.md.

### Known gaps and owner decisions

1. Review M3 and the additional human-readable currency display before authorizing M4. JSON remains unchanged; renderers called directly without configuration context cannot infer currency and deliberately show only minor units.
2. UI selectors must be CSS; virtualized tables, service workers and WebSockets are not supported by this snapshot adapter. Configure readiness and allowed origins explicitly. Successful business mismatches do not automatically capture every affected row; screenshots are for read/navigation/extraction failures.
3. SQL supports the documented parser/function subset; unsupported PostgreSQL syntax fails closed. READ ONLY is not a universal sandbox for privileged side effects hidden in views/functions. Use a dedicated SELECT-only staging role. The adapter performs no DDL/fixture loading; development fixture writes are restricted to a disposable loopback logiparity_test database.
4. Chromium and PostgreSQL/XML development prerequisites are now required for the complete suite. CI definitions are committed, but no remote CI success or public release is claimed. Size checks are functional, not cross-machine benchmarks.
5. Normal export timestamps carry UTC offsets. The injected timezone defect changes that serialization contract; changing fallback timezone to Chicago would reinterpret the broken output and hide this defect. Review source timezone contracts for your own systems.
6. Scenarios, operational events/invariants and virtual-clock controls remain M4. AI remains M5 and release packaging remains M6. No next milestone or release action is authorized by this report.

## M4 — Approved by owner

Date: 2026-11-02. Version remains 0.1.0, unreleased. The owner approved M3 and explicitly authorized M4, adding ISO 8601 UTC beside epoch milliseconds in HTML/Markdown while preserving JSON. M4 acceptance checks passed and the original delivery stopped at its review gate. The owner subsequently approved M4 and explicitly authorized M5 on 2026-11-02. No AI work, push, publication, release, production connection, real credentials or git identity changes were performed.

### Delivered

- `logiparity scenario run <scenario.yaml> --target <target.yaml> [--report-dir <dir>]`, strict YAML schemas and matching target names. Targets require explicit `environment: test|staging` and `allowMutations: true`.
- System-agnostic event HTTP mappings for driver no-show, breakdown, traffic delay, cancellation, capacity changes and custom HTTP. Typed placeholders preserve JSON objects/arrays/numbers, embedded path values are encoded, and unknown/prototype tokens, foreign origins, embedded credentials and redirects are rejected. Mutation requests have timeouts and no automatic retries. Header secrets come from environment references.
- Preflight of fixture/modules/request plans/Parity configuration before setup; baseline adapter snapshots and validation before event injection; unique step/name checks; ordered events, replan trigger, bounded completion polling and virtual-clock integration. Partial failures record completed event steps with exit 2.
- Six built-in operational invariants, baseline-derived affected keys, clear explanations and sorted failing keys. Assignment rows are independent of an order's primary driver, enabling double-assignment detection. Cancellation retains records, removes assignments and requires a fresh notification. Capacity sums active units per vehicle and rejects unavailable resources.
- Trusted custom TypeScript/JavaScript default-export invariant functions and safe JSONPath/expected-value checks. TypeScript works on both supported Node versions through pinned MIT Jiti 2.7.0; malformed results and thrown errors exit 2. Each custom function receives cloned state.
- Five complete scenario examples, a demo target mapping and a synthetic fixture recipe: 55 drivers, 2,750 active orders, capacity 60 per vehicle. Each example resets its fixture; virtual replanning completes after two simulated seconds. The original default snapshot and M1–M3 Parity findings remain compatible.
- Demo reset/event/replan/status/clock endpoints, independent assignment records, operational driver/vehicle flags, ETAs, cancellation state, synthetic notifications and dynamic UI/export snapshots. Added BUG_REPLAN_LOSES_ORDER and BUG_DOUBLE_ASSIGN; demo:bugs now enables all six documented flags. ETA is appended to exports; original four columns retain their positions.
- Scenario console/HTML/Markdown/JSON/JUnit outputs. Fresh target CSV/XLSX artifacts are downloaded before optional post-scenario Parity, including after invariant failures. Nested/standalone Parity JSON keeps its existing schema. Domain and cross-surface results remain visible independently.
- Datetime field presentation in HTML/Markdown: `1793624460000 (2026-11-02T13:01:00Z)`, with `.123Z` retained when applicable. Formatting is UTC and type-driven; counts/numeric fields are not guessed to be dates. Money currency presentation is retained. JSON values/structure/units and console/JUnit comparison values remain unchanged, with byte-for-byte JSON regression checks.
- Scenario reference, reproduction commands, updated roadmap/security/bug documentation, real browser captures and regenerated 109-version runtime license inventory. AI remains an unchanged M5 placeholder.

### Verification commands and results

From the repository root, with Chromium, xmllint and local PostgreSQL test prerequisites installed:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
node scripts/dependencies.mjs
npm ls --depth=0
git diff --check
npm audit --json
npm audit --omit=dev --json
```

The complete lint/typecheck/unit/e2e pipelines ran sequentially with `PATH=/private/tmp/logiparity-node20/node_modules/.bin:$PATH` and the corresponding node22 path. E2E builds first. After those checks, a clean cached installation and build also passed: `npm ci --offline --ignore-scripts --cache /private/tmp/logiparity-npm-cache` on Node 22 followed by `npm run build`. Offline installation audit output is not treated as an online advisory result.

| Check | Node 20.20.2 | Node 22.23.4 |
| --- | --- | --- |
| lint / strict typecheck / build | Pass | Pass |
| unit/adapter tests | 167 pass, 15 files | 167 pass, 15 files |
| CLI/demo e2e tests | 38 pass, 2 files | 38 pass, 2 files |
| core line coverage | 100% (340/340) | 100% (340/340) |
| statements / branches / functions | 98.97% / 94.72% / 98.97% | 98.97% / 94.72% / 98.97% |

No test is skipped. Core retains its 85% enforced line threshold; these coverage percentages describe core, not the entire scenario/demo code. Existing 100,000-row functional size checks, real Chromium isolation/login/table checks and isolated PostgreSQL 14.16 tests remain passing. CI already runs the same suites on Node 20/22 with a PostgreSQL 16 service; no remote GitHub run is claimed.

New tests cover all five healthy scenarios with all six invariants and fresh 2,750-row API/CSV/XLSX Parity; each new environment bug flag through the actual demo executable; combined bugs; exact affected IDs; ordered events/custom HTTP; TypeScript and JSONPath invariants; invalid module/results; consent/foreign request/fixture/duplicate-step preflight without target mutations; event HTTP failures; virtual and real-clock timeout; post-scenario source-error precedence; canonical scalar validation; report escaping; datetime epoch/UTC formatting, millisecond preservation, invalid epochs and unchanged JSON. Healthy scenario JUnit is validated independently against the vendored Ant XSD.

### M4 acceptance and reproduction

Start `npm run demo` in one terminal. In another:

```sh
export DEMO_API_URL=http://127.0.0.1:3010
for scenario in examples/demo/scenarios/*.yaml; do
  ./node_modules/.bin/logiparity scenario run "$scenario" --target examples/demo/target.yaml || break
done
```

All five examples pass six invariants, report zero post-scenario findings and exit 0. Each writes its own folder under ignored logiparity-scenario-report. The virtual clock ends two seconds after the event's configured `at`; event hours do not create wall-clock-hour waits.

Restart with an individual M4 flag, then rerun the breakdown scenario:

```sh
BUG_REPLAN_LOSES_ORDER=1 npm run demo
# In another terminal:
./node_modules/.bin/logiparity scenario run examples/demo/scenarios/02-vehicle-breakdown.yaml \
  --target examples/demo/target.yaml
# Repeat after restarting with BUG_DOUBLE_ASSIGN=1 npm run demo.
```

| M4 flags | Required observed failure | Exit |
| --- | --- | --- |
| Both off | All five examples pass; zero Parity findings. | 0 |
| Lost order only | no_order_lost names S000801; affected ETA/notification checks also fail. | 1 |
| Double assignment only | single_assignment names S000801. | 1 |
| Both on | Lost S000801, duplicate S000802. | 1 |

With only these M4 bugs, API/CSV/XLSX can all agree: Parity has zero findings, while the domain invariant correctly fails. With all six flags on, the manually generated breakdown result names lost S000801 and duplicate S000802; post-scenario Parity has **5,781 findings** (14 missing, 5,765 field, 2 aggregate). The original non-scenario M3 UI configuration still reports its expected 4,273 findings.

Manual review artifacts are in ignored `logiparity-scenario-report/review-m4/`: scenario.html, scenario.md, scenario.json, junit.xml, fresh artifacts and parity/. Both the failing scenario JUnit and nested Parity JUnit validate with `xmllint --nonet --noout --schema tests/fixtures/junit/JUnit.xsd ...`. Open the local files to review; temporary QA servers have been stopped.

### Browser QA and dependency review

A dedicated logiparity-m4 Chromium session confirmed six invariant rows, exact lost/duplicate IDs, the Parity link and `1793613600000 (2026-11-02T10:00:00Z)`. Searching that ISO instant selected exactly 20 rows (matching the JSON expected/actual values). Both report pages passed the 390-pixel document-overflow check. docs/images/scenario.png and report-datetime.png are actual captures of those synthetic reports. The browser session and both loopback QA servers were closed after review.

Jiti adds one pinned external runtime package with MIT metadata and no external dependency chain. The regenerated inventory records 109 runtime versions, all with declared licenses. Online audit remains **17 moderate affected-package entries overall, 7 moderate runtime entries, 0 high and 0 critical**, with unchanged affected package names. Existing ExcelJS/glob/minimatch limitations remain documented in docs/dependency-audit.md; no incompatible forced update was applied.

### Known gaps and owner decisions

1. Review M4 and the UTC presentation addition before authorizing M5. No optional AI provider/command implementation or release work has started.
2. Scenario setup/events/replan mutate the explicitly configured test/staging service. There is no transaction, automatic rollback or retry. After partial failure inspect the target; rerunning a shipped demo scenario resets its synthetic fixture. Run scenarios serially on a shared demo instance.
3. Built-ins require the documented canonical state contract. They check snapshot invariants, not route optimization, eventual customer message delivery or every possible business rule. Custom HTTP affected keys are caller-supplied. Custom modules run trusted Node code, including top-level imports, without a sandbox/execution timeout.
4. Real-target waits use wall-clock polling; individual adapter/request timeouts also apply, so an in-flight read can finish after the polling deadline. Only the demo mapping advances virtual time. Scenario state snapshots are held in memory; no scenario throughput/memory benchmark is claimed.
5. Post-scenario Parity reads API plus fresh CSV/XLSX in the shipped mapping. Existing UI/SQL adapters can be configured, with their documented authentication/read-only constraints. Scenarios do not provision external database fixtures or synthesize UI authentication.
6. Report outputs contain synthetic/test business values and affected IDs. Existing dependency advisories are unchanged. Chromium/XML/PostgreSQL prerequisites remain required for the complete local suite. Publication, npm/Docker packaging and final release review remain M6.

## M5 — Approved by owner

Date: 2026-11-02. Version remains 0.1.0, unreleased. The owner approved M4 and explicitly authorized M5. M5 acceptance checks passed and the original delivery stopped at its review gate. The owner subsequently approved M5 and explicitly authorized M6 on 2026-11-02. No live AI provider was called, no real credentials were added, and no push, release, publication or git identity change was performed. M6 packaging/templates/release work has not started.

### Delivered

- `logiparity ai suggest-config --openapi <spec.yaml> --entity <name>` drafts Parity YAML; `ai scenario --from <description>` drafts scenario YAML; `ai explain <report.json>` drafts a Markdown explanation.
- All three commands default to local preview: no provider configuration is required and no request/output file/directory is created. Normal check/scenario/init/help commands never invoke AI, even when provider environment variables are configured.
- An explicit `--send` plus LOGIPARITY_AI_BASE_URL, LOGIPARITY_AI_MODEL and LOGIPARITY_AI_API_KEY is required for one provider call. The complete prompt/request body is flushed to stdout before sending; credentials are hidden from the preview and sent in the Bearer header. E2E compares the preview body with the captured HTTP body and verifies preview precedes the request.
- Provider-agnostic AiProvider interface with injected mock/custom implementations and a built-in text chat-completions provider. The adapter sends the explicit model/system/user messages without provider SDKs, automatic model selection, tools, redirects or retries. URL prefixes are preserved; embedded credentials/query/fragment and invalid credential/model controls are rejected. Timeouts cover headers and body; malformed, nontext, refused, truncated, empty or tool-call responses do not produce drafts. Error bodies are omitted.
- Separate versioned AI settings through `--ai-config`, plus repeatable/comma-separated `--redact-fields`. Plain names mask properties recursively and finding expected/actual values; scoped paths support properties/indexes/wildcards without evaluation. Default secret fields and the configured API credential are masked. Selected literal values copied into messages/keys/provider output are scrubbed, without modifying source files.
- Explain reads Parity v1 JSON, preserves exact monetary strings and epoch values, and includes entity/aggregate summaries, the first maxFindings findings and exact full-input totals with explicit omission counts. Default maxFindings is 100, configurable 1–1000. Sampling is disclosed, not represented as complete record-level evidence.
- Local input limits and validation: regular YAML/JSON files up to 16 MiB, duplicate-key/alias/cycle/nonfinite checks, no environment interpolation and no local/remote OpenAPI reference resolution. Provider bodies are bounded to 256 KiB; responses to 1 MiB, including bodies without Content-Length. Invalid requests fail before network access.
- New output files always begin `# AI-generated draft: review before use`, use private permissions and never overwrite existing files/symlinks. Exclusive writes protect a file created concurrently during generation. YAML is checked against the existing Parity/scenario schema without loading referenced modules/fixtures or real environment values. Nothing executes a generated draft. Unique default filenames live under ignored logiparity-ai-drafts; --output selects a new path.
- Handwritten synthetic OpenAPI/report/settings examples, an AI reference with limits and provider injection, updated README/security/roadmap/contributing/changelog, and mock-only unit/HTTP/CLI tests. No external dependency version was added; existing yaml/zod/workspace dependencies are reused. Money/ISO UTC human report presentation and existing Parity/scenario JSON formats remain unchanged.

### Verification commands and results

From the repository root, using the same Chromium/xmllint/disposable PostgreSQL prerequisites as M4:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
node scripts/dependencies.mjs
npm ls --depth=0
git diff --check
npm audit --json
npm audit --omit=dev --json
```

The complete pipelines ran sequentially with `PATH=/private/tmp/logiparity-node20/node_modules/.bin:$PATH` and the corresponding node22 path; test:e2e builds first. A clean cached lockfile installation and build also passed on Node 22: `npm ci --offline --ignore-scripts --cache /private/tmp/logiparity-npm-cache` followed by `npm run build`. Offline installation audit output is not interpreted as an online advisory result.

| Check | Node 20.20.2 | Node 22.23.4 |
| --- | --- | --- |
| lint / strict typecheck / build | Pass | Pass |
| unit/adapter tests | 205 pass, 18 files | 205 pass, 18 files |
| CLI/demo e2e tests | 62 pass, 3 files | 62 pass, 3 files |
| core line coverage | 100% (340/340) | 100% (340/340) |
| statements / branches / functions | 98.97% / 94.72% / 98.97% | 98.97% / 94.72% / 98.97% |

No test is skipped. Coverage describes core, not all AI/scenario/demo code; the existing 85% core line threshold remains enforced. All M1–M4 bug matrices, five healthy scenarios, currency/UTC presentation checks, independent JUnit validation, real Chromium tests and isolated PostgreSQL tests remain passing. CI runs these suites on its existing Node 20/22 matrix with loopback AI mocks; no live AI credentials/provider calls or remote CI success is claimed.

M5 adds 38 unit/adapter and 24 CLI e2e checks. They cover injected providers, exact HTTP/auth/body contracts, all commands' offline/send behavior, missing provider variables, configured-provider isolation from normal Parity/scenario commands, complete preview/body agreement and ordering, structured finding/path/alias redaction, secret-free prompts/errors, nonmutation of inputs, no reference resolution/env expansion, size/timeout/redirect/error handling, malformed/truncated/refused/tool responses, output permissions, early existing-file rejection, symlinks, concurrent-file preservation, generated-module non-execution and invalid-draft rejection. No real API is called in these tests.

### Offline acceptance and concrete review artifacts

The shipped examples were run through the actual built CLI:

```sh
./node_modules/.bin/logiparity ai suggest-config --openapi examples/ai/openapi.yaml \
  --entity shipment --ai-config examples/ai/settings.yaml
./node_modules/.bin/logiparity ai scenario --from "Two vans broke down during the afternoon peak"
./node_modules/.bin/logiparity ai explain examples/ai/report.json --ai-config examples/ai/settings.yaml
```

All exit 0 without a provider request or draft file. Offline previews mask one selected OpenAPI example and five selected report fields. The report preview omits the synthetic email values and S000801 key; its input files remain unchanged.

For send acceptance, use the mock-provider CLI suite (no real key required):

```sh
npm run build
npx vitest run --config vitest.e2e.config.ts tests/e2e/ai.test.ts
```

A separate manual loopback mock exercise also ran all three real CLI commands with --send, synthetic credentials and handwritten mock answers, then stopped its server. Exactly three requests went to its configured /v1/chat/completions endpoint. All resulting drafts have the required marker and mode 0600; source specs/reports were preserved and no generated file was run. The ignored `logiparity-ai-drafts/review-m5/` folder contains config.yaml, scenario.yaml, explanation.md, three request-preview text files and a README explicitly identifying them as mock artifacts. These demonstrate workflow behavior, not live model quality, and intentionally are not committed as purported model results.

### Dependencies, limitations and owner decisions

1. Review M5 before authorizing M6. Final CI templates, Docker/npm packaging and release checks remain M6. Nothing has been pushed or published.
2. No real provider/model quality or account access was tested; acceptance uses synthetic injected/loopback mocks. The built-in adapter supports non-streaming text/system-message chat completions. Vendors/models outside this response contract need a custom injected provider. There is no SDK, model discovery, automatic retry or provider failover.
3. AI output is untrusted draft content. Structural YAML validation does not establish correct field mappings, currency/timezone assumptions or safe proposed targets. It never loads referenced modules/fixtures, follows refs or executes the draft. Review before a separate manual check/scenario command.
4. Redaction is structured-field/literal masking, not general PII detection or semantic prose anonymization. Unmatched selectors mask nothing, and conservative alias scrubbing may mask common repeated text; review the entire preview and maskedFields count. Credentials are hidden, but payload/log contents may still contain test business data you did not select for masking. Existing directory permissions are preserved; newly created draft directories/files are private.
5. Explain includes a disclosed bounded sample in report order, not a statistically representative/full finding list. It accepts Parity v1 report.json; for M4 use parity/report.json. OpenAPI validation is lightweight and does not resolve $ref. Input/request/response limits and conventional URL-placeholder validation are documented in docs/ai.md.
6. --send authorizes that invocation after printing its full payload; there is no interactive approval or persisted preview token. Inputs/settings can change between a preview and a send invocation. All required provider variables must be present; their presence alone never invokes AI.
7. Runtime license inventory remains 109 package versions with declared licenses. Online audit is unchanged: 17 moderate affected-package entries overall, 7 moderate runtime entries, zero high/critical and no new affected package names. Existing ExcelJS/glob/minimatch advisory limitations remain in docs/dependency-audit.md. No incompatible forced updates were applied.

## M6 — Local 1.0.0 candidate implemented; owner release review pending

Date: 2026-11-02. The owner approved M5 and authorized M6. Version 1.0.0 is a **local, unpublished release candidate**. All implementation milestones M1–M6 are delivered; publication is a separate owner decision. No push, repository creation, tag, GitHub release, npm/Docker publication, registry login, real AI call, production target or git identity change was performed.

### Final feature summary

| Area | Delivered behavior |
| --- | --- |
| Parity | Shared-key REST, CSV, XLSX, authenticated Playwright table and restricted read-only PostgreSQL comparisons; missing/extra/duplicate/field/aggregate/source findings; exact money and UTC datetimes; configurable normalization/tolerances/failure thresholds. |
| Reports | Console, self-contained filterable HTML, JSON v1, Markdown and independently schema-validated JUnit. Human reports retain currency equivalents and ISO UTC beside normalized minor units/epochs; JSON remains unchanged. |
| Scenarios | Ordered mapped HTTP events, adapter state snapshots, completion polling/virtual clock, six built-in and custom TypeScript/JSONPath checks, affected keys/explanations and fresh post-scenario Parity. |
| Synthetic demo | 55 drivers/vehicles, 2,750 daily orders, dispatcher/login, daily exports, operational endpoints/replanning, notifications and all six independently reproducible bug flags. Five healthy disruption examples pass. |
| Optional AI | Preview-first config/scenario/explanation drafts, explicit provider configuration/send, structured redaction and bounded payloads, schema checks and exclusive marked output files; no automatic execution or normal-command AI hook. Tests use mocks only. |
| Distribution | One standalone logiparity@1.0.0 artifact bundling private compiled workspaces and locked runtime dependencies/licenses; public library/type subpaths; non-root Docker image with matching Chromium and digest-pinned Node 22.23.4/Debian base. |
| Project materials | MIT software license, Contributor Covenant 2.1 with separate document attribution/license, issue/PR templates, five suggested starter issues/labels, complete configuration/scenario/adapter/report/AI/CI/Docker/FAQ/release guides and real synthetic UI/report captures. |

### M6 packaging, documentation and CI changes

- Aligned workspace versions to 1.0.0 and made the root logiparity manifest the single public candidate. Internal @logiparity packages remain private and are bundled; the CLI workspace is @logiparity/cli. The root executable works in an installed consumer without checkout-relative imports or private registry access.
- Added explicit first-party file allowlists and package inspection checks. An initial broad examples include exposed generated demo auth/exports in a dry-run; the final allowlist excludes those paths, and the smoke check rejects their inclusion. No auth file contents were logged or published. First-party source/tests, dev dependencies, environment files and generated artifacts are excluded. Bundled third-party files/licenses are retained as upstream packages ship them.
- Added logiparity/core, logiparity/adapters, logiparity/scenarios and logiparity/ai public API/type bridges. Package smoke verifies their native ESM imports and compiles consumer declarations with TypeScript NodeNext, outside the checkout.
- Added prepack build and test:package, test:quickstart, test:docker, check:docs scripts. Package acceptance performs dry-run inspection, real packing, an empty-cache offline consumer install, help/init/mismatch reports, exact money/UTC presentation and offline AI. New checks are separate acceptance scripts; the existing Vitest counts are not inflated for documentation changes.
- Added a multi-stage Dockerfile, context exclusions, fixed non-root UID 1000 and build-time-only Chromium/system dependency installation. The runtime installs the exact local npm tarball offline. Base reference: node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da. No credentials or host auth state are copied.
- Expanded the repository Node 20/22 workflow with package/quickstart/docs checks and retained verification receipts, plus a separate Docker job. Official checkout/setup-node/upload-artifact revisions are pinned by release commit. Consumer GitHub/GitLab templates retain artifacts after findings/runtime failures and do not publish or silently ignore failures. Consumer registry installation is explicitly contingent on owner publication.
- Completed the 1.0.0 candidate changelog, README path to a finished report, API/CI/Docker/FAQ/release references, contributor instructions and Code of Conduct. Reporting contact text honestly requires a private channel agreed with Sergei Orekhovskii; a confidential mailbox has not been invented. The owner must establish it before public community operation.

### Verification commands and observed results

Run from the repository root. Chromium, xmllint and disposable PostgreSQL prerequisites remain as documented; Docker checks require a local engine:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run check:docs
npm run test:package
npm run test:quickstart
npm run test:docker
npm pack --dry-run
node scripts/dependencies.mjs
npm audit --json
npm audit --omit=dev --json
git diff --check
```

Complete Node pipelines ran sequentially with PATH pointing to /private/tmp/logiparity-node20/node_modules/.bin and the corresponding node22 directory, avoiding coverage collisions. E2E builds first. Package/quickstart acceptance used actual subprocesses and source copies outside the checkout. Public API/type bridge checks were repeated on both versions after being added.

| Check | Node 20.20.2 | Node 22.23.4 |
| --- | --- | --- |
| lint / strict typecheck / build | Pass | Pass |
| Vitest unit/adapter | 205 pass, 18 files | 205 pass, 18 files |
| CLI/demo e2e | 62 pass, 3 files | 62 pass, 3 files |
| core lines | 100% (340/340) | 100% (340/340) |
| statements / branches / functions | 98.97% / 94.72% / 98.97% | 98.97% / 94.72% / 98.97% |
| standalone pack + empty-cache offline install + public ESM/types + CLI reports | Pass | Pass |
| clean-source quickstart, using local npm cache | 7.42 seconds | 7.84 seconds |

No tests are skipped. Core retains its 85% enforced line threshold; these percentages do not claim full-project coverage. Existing 100,000-row functional size checks, bug on/off matrices, five healthy scenarios, independent JUnit validation, real Chromium and isolated PostgreSQL 14.16 tests remain passing. Hosted CI is configured for PostgreSQL 16 and Linux, but no remote success is claimed.

A separate Node 22 quickstart with a new empty npm cache downloaded dependencies and finished in **15.33 seconds**, producing zero findings for 2,750 API/XLSX/CSV records and all four report files. Command: `LOGIPARITY_QUICKSTART_OUTPUT=output/release-checks/quickstart-cold-cache.json npm_config_cache=/private/tmp/logiparity-m6-cold-cache npm run test:quickstart`. This measures a clean local source copy/install/build/demo/export/check on this machine, not a public-network or cross-machine performance guarantee. A remote git clone cannot be exercised before the owner creates/pushes the repository; the source-copy check uses the exact nonignored git source file set and no existing node_modules/dist/auth/reports.

Documentation validation checks local links and YAML parsing, plus completed Covenant 2.1 contact/adaptation. Both GitHub workflows additionally pass checksum-verified actionlint 1.7.12. GitLab syntax is parsed/reviewed against its documentation; a real GitLab hosted pipeline/lint service was not used. Screenshots in docs/images remain actual captures of the synthetic dispatcher, Parity money/UTC findings and scenario keys, not generated mockups.

### Docker and artifact evidence

The host had stale Docker Desktop symlinks and no live engine. To complete the requested build, a disposable Lima 2.2.1 VZ VM ran only this task's Docker workload, with no host directory mounts and no user SSH-key loading. Its config and Docker client context were isolated under /private/tmp; default Docker contexts were not changed. Official Lima/Buildx/actionlint downloads were checked against published checksums/digests. Temporary VM, daemon, forwarding processes and task-owned cache files were stopped/removed after artifact export.

The image was built and smoke-tested on **linux/arm64** with Docker 29.9.2 and Buildx 0.38.1. Acceptance containers had --network=none: help/version, UID 1000, actual headless Chromium, mismatch exit 1, JSON/HTML/Markdown/JUnit files, `625 ($6.25)`, `1793624460000 (2026-11-02T13:01:00Z)` and offline AI preview passed. No privileged flag, host credential mount or application network target was used. The Docker base/browser/npm downloads occur only during build. No additional architecture, vulnerability scan or remote registry pull/push is claimed.

Ignored owner-review artifacts live under output/release/ and output/release-checks/: the local logiparity-1.0.0.tgz, linux-arm64 Docker save archive, package file-list/consumer receipts, quickstart timing receipts and final artifact hashes/image metadata. Hashes live in external receipts rather than inside the tarball that contains this report. The package includes 107 bundled package-name entries, while the license inventory records 109 distinct external runtime versions including nested versions; these counts describe different sets. The final dry-run rejects sensitive/generated first-party paths and an empty-cache offline install succeeds.

### Known limitations and owner release checklist

1. **Review the complete local candidate and evidence before publication.** M1–M5 owner approvals do not authorize repository creation, pushes, tags, registry logins or releases. Version 1.0.0 is not asserted to exist in npm or a Docker registry. A read-only npm metadata query returned E404 during this check; that is not a package-name reservation or future ownership guarantee.
2. **Dependency decision:** online audit remains 17 moderate affected-package entries overall, 7 runtime, zero high/critical, with unchanged affected names. The 109-version external runtime inventory has declared licenses; MIT software and third-party notices remain included. Decide how to resolve or document the existing ExcelJS/glob/minimatch chain before public release; no incompatible forced update was applied. The final image also needs the owner's platform/security review and scan.
3. **Operational limits remain documented:** test/staging only; scenario mutations have no rollback/retry; custom modules are trusted Node code; UI snapshots exclude virtualization/service workers/WebSockets; SQL uses a restricted grammar and a dedicated read-only role, not a universal privileged-object sandbox; snapshot and size checks are not routing/performance proofs.
4. **AI:** no live provider/model quality was tested. Preview/redaction is structured masking, not general PII detection; drafts need review and never execute automatically. Report explanations contain a disclosed bounded sample. CI uses synthetic mocks only.
5. **Platform/CI/community decisions:** Docker was verified only on linux/arm64; verify linux/amd64/other intended architectures before claiming them. Hosted GitHub/GitLab jobs have not run. Establish confidential conduct/security contacts before public community operation, and review the intended GitHub/npm/Docker ownership/access settings.
6. **Create the repository and run remote CI:** owner creates Nutts5796/logiparity, adds the intended remote, pushes the reviewed branch and inspects actual hosted checks. Optionally create the suggested good first issue/help wanted labels and five starter issues from docs/roadmap.md. No issue, label or release was created remotely by this task.
7. **Approve exact artifacts, then tag/release:** confirm final 1.0.0 changelog/date, dependency decisions, MIT/notice inventory, reviewed commit and artifact hashes. Owner creates/pushes v1.0.0 and the GitHub release for that exact candidate. Do not substitute an unverified rebuild between review and publication.
8. **Owner publishes npm and Docker:** authenticate through the owner's own approved process, publish the reviewed tarball under logiparity, and tag/push the reviewed image to the owner-selected registry. Internal private packages remain bundled and unpublished separately. Test a fresh registry installation/pull and record published digests before announcing availability or adding release links/badges.

The implementation work stops here for final owner review. Detailed reproduction and owner-only publication guidance is in docs/release.md.
