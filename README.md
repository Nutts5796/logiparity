# LogiParity

Logistics software often shows the same shipments in an API, dispatcher screen and accounting export. A missing export row or a one-cent payout difference can survive ordinary endpoint tests. LogiParity compares records by a shared key and identifies the affected records and fields.

**Use only in test and staging environments.** Parity reads explicitly configured sources. Scenarios also send configured mutation requests after explicit target consent. It has no telemetry. Optional AI is disabled by default and runs only through explicit AI commands with --send. It does not identify whether a configured hostname is production: you are responsible for choosing a test or staging target. Never put production credentials in this project.

Current status: **M5 / 0.1.0, unreleased**. Implemented: REST, CSV, XLSX, Playwright UI and read-only PostgreSQL sources; normalized record/aggregate comparisons; `logiparity check` and `init`; failure thresholds; five report formats; a synthetic delivery demo with dispatcher UI/login and six switchable bugs; disruption scenarios, invariants and a virtual clock. Optional AI can draft configs/scenarios and explain reports with local payload preview and redaction. No npm package, Docker image or hosted service has been published.

## Quickstart from this checkout

Install Node.js 20 or 22 and npm. All commands below start in the repository root. The demo uses only synthetic data: 55 drivers, 55 vehicles and 2,750 orders for `2026-11-02`.

```sh
npm ci
npm run demo
```

Leave the demo running. In another terminal at the repository root:

```sh
export DEMO_API_URL=http://127.0.0.1:3010
npm run demo:export
npm run build
./node_modules/.bin/logiparity check --config examples/demo/parity.yaml
```

Expected: `1 entities, 0 findings (0 blocking)`, exit code `0`. Open `logiparity-report/report.html` in your browser; the same directory contains `report.json`, `junit.xml` and `report.md`. The export command downloads both configured local demo exports into `examples/demo/out/`. Exports are snapshots: download again after restarting the demo with different bug flags.

Stop the first demo with Ctrl+C and run:

```sh
npm run demo:bugs
```

Then repeat `npm run demo:export` and the check command. With all six bugs enabled (the two replan bugs are inactive until a scenario runs), this API/file config produces exit `1` and **3,957 findings**: 14 missing XLSX records, 284 one-cent payout mismatches, 3,656 datetime mismatches and 3 aggregate mismatches. It does not include the UI source. For example, `S000200` is missing from XLSX and `S000001` has payout `101` versus `100` USD cents. [Bug flags](apps/demo-delivery/BUGS.md) can be enabled individually.

![HTML parity report from the synthetic demo with export/UI bugs enabled](docs/images/report.png)

The HTML report is self-contained: entity/type filters, record search and styles need no CDN or service. All findings remain visible without JavaScript. [Report formats and CI interpretation](docs/report-formats.md) describe the output files.

The demo binds only to `127.0.0.1`. Set `DEMO_PORT` to change its port; set `DEMO_DATE` when starting/exporting to change the synthetic day, and update `variables.date` to match. API/exports need no credentials. The dispatcher at `/dispatcher` uses the public synthetic account **dispatcher / demo-password**, with a one-hour session. This demonstration login is not production authentication.

## Include the dispatcher UI

Keep the demo running, then from another terminal:

```sh
npx playwright install chromium
export DEMO_API_URL=http://127.0.0.1:3010
export DEMO_UI_URL=$DEMO_API_URL
npm run demo:export
npm run demo:login
./node_modules/.bin/logiparity check --config examples/demo/parity-ui.yaml
```

`demo:login` uses only a loopback demo origin and writes ignored login state to `examples/demo/auth/state.json`. Restarting the demo invalidates sessions: run login/export again. The UI adapter reads the paginated orders table using that storageState. With bugs off this config exits 0; with all six bugs on before any scenario it reports **4,273 findings**, including 315 stale UI statuses and their delivered-count mismatch. Failures to read the UI produce screenshots under the report directory with links in HTML.

![Authenticated synthetic delivery dispatcher](docs/images/dispatcher.png)

## Run disruption scenarios

Keep the demo running with bugs off, then:

```sh
export DEMO_API_URL=http://127.0.0.1:3010
./node_modules/.bin/logiparity scenario run examples/demo/scenarios/02-vehicle-breakdown.yaml \
  --target examples/demo/target.yaml
```

Expected: six passing invariants, zero post-scenario Parity findings and exit 0. Open `logiparity-scenario-report/02-vehicle-breakdown/scenario.html`; its Parity link opens the fresh API/CSV/XLSX comparison. Each example resets a synthetic 55-driver/2,750-order operations fixture with spare capacity. The demo advances a virtual clock, so event times do not cause real-hour waits.

![Synthetic breakdown scenario with exact lost/duplicate order keys](docs/images/scenario.png)

The [five examples](examples/demo/scenarios) cover no-show, breakdown, traffic delay, mass cancellation and capacity reduction. Run them serially against a shared demo:

```sh
for scenario in examples/demo/scenarios/*.yaml; do
  ./node_modules/.bin/logiparity scenario run "$scenario" --target examples/demo/target.yaml || break
done
```

Restart with `BUG_REPLAN_LOSES_ORDER=1 npm run demo` and rerun the breakdown: `no_order_lost` names **S000801**, exit 1. With `BUG_DOUBLE_ASSIGN=1`, `single_assignment` names **S000801**. With both on, the loss is S000801 and duplicate is S000802. Fresh API/exports can agree while the domain invariant fails. `demo:bugs` enables all six defects and adds export mismatches.

Scenarios mutate only the explicitly configured test/staging target. Review [target.yaml](examples/demo/target.yaml): `allowMutations: true`, event HTTP templates, state adapters and artifact requests. There is no automatic rollback. The [scenario reference](docs/scenarios.md) documents configuration, canonical state, custom TypeScript/JSONPath invariants and report/error semantics.

## PostgreSQL source

Configure `type: sql`, `connectionEnv`, one SELECT query, optional bound `params` and field-to-column mappings. Use a dedicated read-only role on a test/staging database. LogiParity parses the query before connecting, rejects writes (including modifying CTEs), multiple statements, row locks and non-allowlisted functions, and uses a read-only transaction with rollback/connection cleanup. Rows stream in bounded batches; numeric monetary columns retain exact decimal strings. The SQL grammar/function surface is deliberately restricted; see [configuration](docs/configuration.md).

[examples/postgres/parity.yaml](examples/postgres/parity.yaml) is a two-record synthetic smoke example with SQL constants and a CSV reference. It requires `STAGING_DATABASE_URL` but creates no database objects. Replace the query with your own staging SELECT and mappings.

## Optional AI drafts

AI commands preview locally by default and do not require provider configuration:

```sh
./node_modules/.bin/logiparity ai suggest-config --openapi examples/ai/openapi.yaml --entity shipment
./node_modules/.bin/logiparity ai scenario --from "Two vans broke down during the afternoon peak"
./node_modules/.bin/logiparity ai explain examples/ai/report.json --ai-config examples/ai/settings.yaml
```

Review the exact prompt/request body and field masking. To generate a draft, set `LOGIPARITY_AI_BASE_URL`, `LOGIPARITY_AI_MODEL` and `LOGIPARITY_AI_API_KEY`, then add `--send`. Only that invocation calls the configured chat-completions provider; normal checks/scenario runs never use AI. API credentials come from the environment and are hidden from the preview.

Every generated file starts with `# AI-generated draft: review before use`. Drafts use new files under ignored `logiparity-ai-drafts/`, or a new `--output` path, and are never executed automatically. YAML is checked against LogiParity's schema without reading its referenced files or expanding real environment values. Provider output still requires review for correct mappings, assumptions and target safety.

`redactFields` supports field names and scoped paths, including finding keys and expected/actual values; known values copied into messages are masked too. Explain includes exact report totals and a disclosed bounded sample. Read the [AI reference](docs/ai.md) for settings, data selection, limits and custom provider injection. Tests use only synthetic loopback mocks, with no real AI calls in CI.

## How checks work

The first source in an entity is the reference. LogiParity joins every other source to it by the configured key. It reports missing/extra records, field differences and duplicate keys. Duplicate keys keep the first record and always produce a finding. Source failures return a runtime error and suppress incomplete missing/extra comparisons for that source.

Fields can be trimmed, case folded, mapped through an enum, parsed as locale-aware decimals, or normalized to UTC with explicit source timezones. Money is represented with arbitrary-precision integer minor units. Monetary source values must be decimal strings, including XLSX text cells; configure money tolerance in integer minor units. Unrounded decimals are rejected, so a broken upstream rounding rule cannot be silently normalized away.

HTML and Markdown show configured currency equivalents beside minor units, for example **682625 ($6,826.25)**, for both field differences and money sums. Formatting uses bigint arithmetic, including values beyond Number.MAX_SAFE_INTEGER. Datetime fields also show epoch milliseconds with ISO 8601 UTC, for example **1793624460000 (2026-11-02T13:01:00Z)**; nonzero milliseconds are retained. JSON remains unchanged: money is an integer minor-unit string, with no formatted/display properties. Direct library renderer calls should pass `{entities: config.entities}` as presentation context; without type/currency metadata they retain the normalized scalar display.

Reports sort findings by entity, key, field, source and finding type. Reordering source records does not change comparison content. Exit codes: `0` no blocking findings, `1` blocking findings, `2` invalid configuration or runtime/source/report error. JUnit adds its actual UTC generation timestamp; timings are explicitly unmeasured.

Each entity can define filtered `count` and `sum` aggregates. Money sums remain bigint minor units; numeric sums use exact decimal addition of normalized values before converting back to a finite number. Duplicate keys contribute their first record once. Partial sources skip aggregates whose input fields they do not map, with skipped source names recorded in the report.

By default every finding category fails. Set `failOn: [missing, mismatch, aggregate]` to select categories, `failOn: {missing: 2, mismatch: 10}` to allow counts up to those inclusive limits, or `failOn: []` for observations only. Counts apply per entity across its sources. All findings remain in every full report, marked `blocking`; source errors always exit 2. See the [configuration reference](docs/configuration.md) for exact semantics.

Adapters stream CSV/XLSX rows and REST pages. The engine holds the reference and one compared source in maps; memory is proportional to record count, mapped fields, XLSX shared strings and findings. Tests exercise 100,000 records per source. This is a functional size check, not a published performance benchmark.

## Configuration and reports

Start with [examples/demo/parity.yaml](examples/demo/parity.yaml). Paths resolve relative to the YAML file. Values support `${ENV_VAR}` and `{{variable}}` placeholders. Put secrets in environment variables and reference them with `auth` or `headersEnv`; do not commit literal credentials.

To start a config for your own test/staging system after building:

```sh
./node_modules/.bin/logiparity init --config parity.yaml
```

This writes a commented REST/CSV example with aggregates and all report outputs. It performs no network requests and refuses to overwrite an existing file. Set `STAGING_API_URL` and edit the mappings before running `check`.

- [Configuration reference](docs/configuration.md)
- [Scenario reference](docs/scenarios.md)
- [Optional AI reference](docs/ai.md)
- [Adapter extension interface](docs/writing-adapters.md)
- [JSON report schema](docs/report-schema.md)
- [HTML, JUnit and Markdown output](docs/report-formats.md)
- [Dependency and license inventory](docs/dependencies.md)
- [Milestone results and limitations](MILESTONE_REPORT.md)

REST supports page, offset, cursor and Link pagination, timeouts and bounded retries. Redirects and cross-origin pagination links are rejected. JSONPath support deliberately covers properties, quoted properties, array indexes and wildcards; expressions and filters are unsupported. Locale parsing accepts Latin digits and locale-specific separators/grouping.

XLSX formulas require a cached scalar result; LogiParity never executes spreadsheet formulas. Encrypted workbooks and alternate nonstandard worksheet entry names are unsupported. Reports may contain compared business values; keep them in your test/staging CI artifacts with appropriate access controls.

## Development and CI

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Unit/adapter tests use Vitest, Playwright, local HTTP fixtures and real PostgreSQL. Core line coverage is enforced at 85%. Install Chromium (`npx playwright install chromium`) and `xmllint` (on Debian/Ubuntu: libxml2-utils). PostgreSQL tests auto-create and remove an isolated temporary cluster when initdb/pg_ctl are on PATH; `LOGIPARITY_PG_BIN` can point to their directory. Alternatively set `LOGIPARITY_TEST_DATABASE_URL` to a disposable **loopback database named logiparity_test**; fixtures refuse other hosts/database names and isolate data in random schemas. Never point fixture setup at business data.

E2E checks verify all five healthy scenarios, each implemented bug on/off, exact affected keys, read-only SQL, screenshots, failure policies, init and monetary presentation. CI runs Node 20/22, installs Chromium/XML tooling and uses an ephemeral PostgreSQL 16 service. Local validation uses PostgreSQL 14.16. The committed workflow has not yet run on GitHub for this repository.

Run `node scripts/dependencies.mjs` after changing runtime dependencies and review [SECURITY.md](SECURITY.md) for dependency limitations. Contribution guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

M1–M4 were approved by the owner; M5 awaits review. M5 implements optional AI drafts with preview/redaction and mock-provider tests. M6: complete documentation, CI templates, Docker and release packaging. See [docs/roadmap.md](docs/roadmap.md). Each milestone requires owner review before the next begins.

MIT © Sergei Orekhovskii.
