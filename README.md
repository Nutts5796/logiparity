# LogiParity

Logistics software often shows the same shipments in an API, dispatcher screen and accounting export. A missing export row or a one-cent payout difference can survive ordinary endpoint tests. LogiParity compares records by a shared key and identifies the affected records and fields.

**Use only in test and staging environments.** M1 performs GET requests to explicitly configured HTTP targets and reads local files. It has no telemetry or AI integration. It does not identify whether a configured hostname is production: you are responsible for choosing a test or staging target. Never put production credentials in this project.

Current status: **M1 / 0.1.0, unreleased**. Implemented: REST, CSV and XLSX sources; core normalization/comparison; the `logiparity check` CLI; console and versioned JSON reports; a synthetic delivery demo. The Scenarios and AI workspaces are placeholders for later milestones. No npm package, Docker image or hosted service has been published.

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

Expected: `1 entities, 0 findings`, exit code `0`, and `logiparity-report/report.json`. The export command downloads both configured local demo exports into `examples/demo/out/`. Exports are snapshots: download again after restarting the demo with different bug flags.

Stop the first demo with Ctrl+C and run:

```sh
npm run demo:bugs
```

Then repeat `npm run demo:export` and the check command. Expected: exit code `1`, **14 missing XLSX records and 284 one-cent field mismatches** across CSV and XLSX (298 findings). For example, `S000200` is missing from XLSX and `S000001` has payout `101` versus `100` integer USD cents. [Bug flags](apps/demo-delivery/BUGS.md) can be enabled individually.

The demo binds only to `127.0.0.1`. Set `DEMO_PORT` to change its port; set `DEMO_DATE` when starting and exporting to change the synthetic day, and update `variables.date` in the parity config to match. No credentials are needed for the M1 demo API. UI and demo login are planned for M3.

## How checks work

The first source in an entity is the reference. LogiParity joins every other source to it by the configured key. It reports missing/extra records, field differences and duplicate keys. Duplicate keys keep the first record and always produce a finding. Source failures return a runtime error and suppress incomplete missing/extra comparisons for that source.

Fields can be trimmed, case folded, mapped through an enum, parsed as locale-aware decimals, or normalized to UTC with explicit source timezones. Money is represented with arbitrary-precision integer minor units. Monetary source values must be decimal strings, including XLSX text cells; configure money tolerance in integer minor units. Unrounded decimals are rejected, so a broken upstream rounding rule cannot be silently normalized away.

Reports sort findings by entity, key, field, source and finding type. Reordering source records does not change a successful report's content. Exit codes: `0` no findings, `1` findings, `2` invalid configuration or runtime/source/report error. M1 treats every finding as a failure; aggregate comparisons and configurable `failOn` are planned for M2.

Adapters stream CSV/XLSX rows and REST pages. The engine holds the reference and one compared source in maps; memory is proportional to record count, mapped fields, XLSX shared strings and findings. Tests exercise 100,000 records per source. This is a functional size check, not a published performance benchmark.

## Configuration and reports

Start with [examples/demo/parity.yaml](examples/demo/parity.yaml). Paths resolve relative to the YAML file. Values support `${ENV_VAR}` and `{{variable}}` placeholders. Put secrets in environment variables and reference them with `auth` or `headersEnv`; do not commit literal credentials.

- [Configuration reference](docs/configuration.md)
- [Adapter extension interface](docs/writing-adapters.md)
- [JSON report schema](docs/report-schema.md)
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

Unit/adapter tests use Vitest and local fixtures/HTTP servers. Core line coverage is enforced at 85%. E2E tests run the actual CLI and demo executables with each M1 bug flag on/off and verify exact affected keys and monetary values. [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the checks on Node 20 and 22; this workflow has not yet run on GitHub for this repository. UI adapter and Playwright tests begin in M3.

Run `node scripts/dependencies.mjs` after changing runtime dependencies and review [SECURITY.md](SECURITY.md) for dependency limitations. Contribution guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

M2: HTML/JUnit/Markdown reports, aggregates, failure controls and starter config generation. M3: dispatcher UI, Playwright and read-only PostgreSQL. M4: disruption scenarios, event mapping and operational invariants. M5: optional AI drafts with preview/redaction and mock-provider tests. M6: complete documentation, CI templates, Docker and release packaging. See [docs/roadmap.md](docs/roadmap.md). Each milestone requires owner review before the next begins.

MIT © Sergei Orekhovskii.
