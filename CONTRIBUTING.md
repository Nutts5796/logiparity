# Contributing

Use synthetic fixtures and test/staging targets only. Install Node 20 or 22, run `npm ci`, then `npm run build`. Before submitting a change, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:e2e`. The e2e command builds first. Tests require loopback socket access and create isolated temporary files.

M2 tests also require `xmllint` for offline validation against the vendored Apache Ant JUnit schema. On Debian/Ubuntu install `libxml2-utils`; it is available on the macOS development setup. The CI workflow installs it. Schema provenance and Apache-2.0 notices are in tests/fixtures/junit. M3 UI integration tests require the pinned Chromium revision (npx playwright install chromium). PostgreSQL tests use initdb/pg_ctl on PATH (or LOGIPARITY_PG_BIN) to create/remove temporary clusters, or an explicitly disposable loopback database named logiparity_test via LOGIPARITY_TEST_DATABASE_URL. Tests refuse fixture writes to other hosts/database names. SQL fixture schemas are random and removed after each suite. Browser QA is documented in MILESTONE_REPORT.md.

Use TypeScript strict mode and ESM. Avoid `any`; if unavoidable, document the reason directly beside it. Keep dependency versions exact and permissively licensed; regenerate `docs/dependencies.md` with `node scripts/dependencies.mjs` after changing runtime dependencies. Do not add telemetry, real credentials or production-write features. Add meaningful regression tests for comparison behavior and adapter edge cases.

Use Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) and the repository's existing git identity. Work through M1–M6 in order. At each milestone, append verified results, reproduction commands, gaps and owner decisions to MILESTONE_REPORT.md and stop for owner review. Pushes, releases, npm publication and secrets require explicit owner approval.

The repository is currently an local 1.0.0 release candidate awaiting M6 owner review. Issue/PR templates are present; starter issues and labels are suggestions in the roadmap, not created remote objects. See docs/roadmap.md for the accepted scope.

AI tests use injected mocks and isolated loopback providers only. Never use real AI credentials or providers in CI. Cover disabled behavior, the complete preview/body, redaction and non-execution when changing AI commands. See docs/ai.md.

For packaging/CI changes, also run npm run check:docs, npm run test:package, npm run test:quickstart and npm run test:docker. The package check uses an empty-cache offline consumer install outside the checkout. The Docker check needs a working local engine but never changes contexts or publishes. Follow CODE_OF_CONDUCT.md; the owner must establish a confidential reporting channel before public community operation.
