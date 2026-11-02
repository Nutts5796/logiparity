# LogiParity

Logistics software often shows the same shipments in an API, dispatcher screen and accounting export. A missing export row or a one-cent payout difference can survive ordinary endpoint tests. LogiParity compares records by a shared key and identifies the affected records and fields.

**Use only in test and staging environments.** LogiParity performs GET requests to explicitly configured HTTP targets and reads local files. It has no telemetry or AI integration. It does not identify whether a configured hostname is production: you are responsible for choosing a test or staging target. Never put production credentials in this project.

Current status: **M2 / 0.1.0, unreleased**. Implemented: REST, CSV and XLSX sources; normalized record and aggregate comparisons; `logiparity check` and `init`; failure thresholds; console, HTML, JUnit, JSON and Markdown reports; a synthetic delivery demo. The Scenarios and AI workspaces are placeholders for later milestones. No npm package, Docker image or hosted service has been published.

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

Then repeat `npm run demo:export` and the check command. Expected: exit code `1`, **14 missing XLSX records, 284 one-cent field mismatches and 3 aggregate mismatches** (301 findings). For example, `S000200` is missing from XLSX and `S000001` has payout `101` versus `100` integer USD cents. The delivered count differs in XLSX; payout totals differ in both exports. [Bug flags](apps/demo-delivery/BUGS.md) can be enabled individually.

![HTML parity report from the synthetic demo with both implemented bugs enabled](docs/images/report.png)

The HTML report is self-contained: entity/type filters, record search and styles need no CDN or service. All findings remain visible without JavaScript. [Report formats and CI interpretation](docs/report-formats.md) describe the output files.

The demo binds only to `127.0.0.1`. Set `DEMO_PORT` to change its port; set `DEMO_DATE` when starting and exporting to change the synthetic day, and update `variables.date` in the parity config to match. No credentials are needed for the M1 demo API. UI and demo login are planned for M3.

## How checks work

The first source in an entity is the reference. LogiParity joins every other source to it by the configured key. It reports missing/extra records, field differences and duplicate keys. Duplicate keys keep the first record and always produce a finding. Source failures return a runtime error and suppress incomplete missing/extra comparisons for that source.

Fields can be trimmed, case folded, mapped through an enum, parsed as locale-aware decimals, or normalized to UTC with explicit source timezones. Money is represented with arbitrary-precision integer minor units. Monetary source values must be decimal strings, including XLSX text cells; configure money tolerance in integer minor units. Unrounded decimals are rejected, so a broken upstream rounding rule cannot be silently normalized away.

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

Unit/adapter tests use Vitest and local fixtures/HTTP servers. Core line coverage is enforced at 85%. Install `xmllint` for offline JUnit XSD validation (available on this macOS setup; on Debian/Ubuntu: `sudo apt-get install libxml2-utils`). E2E tests verify exact bug keys, monetary values, aggregates, failure thresholds and init. [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the checks on Node 20 and 22 and installs the XML validator; this workflow has not yet run on GitHub for this repository. Browser QA covers the HTML report; the UI source adapter and its Playwright integration tests begin in M3.

Run `node scripts/dependencies.mjs` after changing runtime dependencies and review [SECURITY.md](SECURITY.md) for dependency limitations. Contribution guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

M1 was approved by the owner; M2 is implemented and awaiting review. M3: dispatcher UI, Playwright and read-only PostgreSQL. M4: disruption scenarios, event mapping and operational invariants. M5: optional AI drafts with preview/redaction and mock-provider tests. M6: complete documentation, CI templates, Docker and release packaging. See [docs/roadmap.md](docs/roadmap.md). Each milestone requires owner review before the next begins.

MIT © Sergei Orekhovskii.
