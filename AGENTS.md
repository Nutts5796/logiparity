# Working on LogiParity

Read [architecture](docs/architecture.md) and the [public API contract](docs/public-api.md) before changing code.

- `packages/core`: strict config/value parsing, keyed comparison, causes, totals and reports. No adapters, CLI, scenarios or AI imports.
- `packages/adapters`: REST/CSV/XLSX/UI/SQL reads, extraction and source limits. Implements core's `Adapter`; no CLI/scenario/AI dependencies. Optional peers stay lazy.
- `packages/cli`: argument validation, wiring and commands; do not put matching logic here.
- `packages/scenarios`: configured test/staging events, invariants and post-event parity; built-in checks use core/adapters.
- `packages/ai`: explicitly configured provider previews/drafts; never required for normal parity.
- `apps/demo-delivery`: synthetic logistics example service. Generic engine code must not depend on it.

## Core concerns and extensions

Runtime dependencies point down this order: `reporters` → `matching` → `causes` / `reconciliation` → `presentation` → `configuration` → `values` → `foundation`. Same-concern imports are allowed; causes and reconciliation cannot import each other. Type-only cross-concern imports describe contracts, not runtime dependencies. Core internals import implementations directly, never index.ts or compatibility entries. Root index.ts preserves exports; human.ts, money-display.ts and html-patterns.ts are compatibility re-exports only.

- New cause: `causes/groups.ts`, `foundation/types.ts`, pure wording in `presentation/human.ts`, chart in `reporters/html-patterns.ts`, shipped schema and fixture regressions. Extend the synthetic evaluation truth separately; do not bless observed output as truth.
- New field type: `configuration/config.ts`, `values/normalize.ts` and supporting parser; inspect filters, aggregation, matching and presentation. Add strict, invalid and cross-source cases.
- New reporter: `reporters/`, writer routing in `reporters/reporters.ts`, index export and format/schema tests. Formatting never changes normalized data or failure policy.
- New source: `packages/adapters/src`, adapter registry/preflight and config schema; return logical `DataRow` values and located failures. Keep remote tests on loopback fixtures.

Use kebab-case TypeScript filenames and small concern-specific modules; tests are `tests/unit/*.test.ts`, `tests/adapters/*.test.ts` or `tests/e2e/*.test.ts`. Use named exports, explicit contracts, `.js` relative import suffixes and `import type`. Preserve existing public exports and published example paths. Do not move domain fixtures into the engine.

## Checks (run from repository root)

```sh
npm run build
npm test -- --maxWorkers=2
npm run test:e2e -- --maxWorkers=2
npm run format:check
npm run lint
npm run typecheck
npm run check:docs
npm run check:release-text
npm run check:architecture
npm run test:package
```

`check:architecture` parses TypeScript imports/exports, including dynamic imports. `lint` also runs it. Existing tests must pass unchanged for a pure refactor. Run focused checks while iterating, then the required full suites. Package verification uses npm 11 and the recorded tested optional peers; consumer installation/signature audits are manual registry checks, while regression/evaluation inputs stay offline. Watch disk use; run large checks sequentially and remove only temporary files you created.

Never weaken a check, hand-edit generated reports, silently drop a mapped field or silently fall back in a way that hides a mismatch. Keep strict parsing by default. No network in regression tests; use fixtures or local servers. Guesses require explicit review. Never fill human evaluation verdicts or stopwatch measurements yourself. Do not claim figures you have not measured.

Keep the AI authorship statement. Commits use Conventional Commits and end with `Assisted-by: AI coding agent`. Refactors and features have separate commits. Follow [docs/release.md](docs/release.md) for release preparation; this milestone authorizes no push, tag, publication or Docker build.
