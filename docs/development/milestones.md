# Build history

LogiParity is written in strict TypeScript and ESM for Node.js 20 or later. Tests run on Node 20 and 22. Software license: MIT, copyright Sergei Orekhovskii.

| Milestone | Delivered |
| --- | --- |
| M1 | Keyed comparisons, exact normalization, REST and streaming file adapters, synthetic delivery API and export bug fixtures. |
| M2 | HTML, Markdown and JUnit reports, aggregates, failure thresholds and config initialization. |
| M3 | Dispatcher login and UI adapter, read-only PostgreSQL, stale-status and timezone bug fixtures, currency display. |
| M4 | Disruption scenarios, virtual clock, operational invariants, fresh post-scenario comparisons and UTC display. |
| M5 | Optional AI drafts with local payload previews, redaction and mock-provider tests. |
| M6 | Standalone bundled package, public API exports, Docker build, CI templates and user guides. |

M6 verification: 205 unit and adapter tests, 62 end-to-end tests, and 100% core line coverage on Node 20.20.2 and 22.23.4. The standalone package installed offline with an empty cache. The Docker image passed non-root Chromium and report checks on linux/arm64. A clean-source quickstart with fresh dependency downloads finished in 15.33 seconds.

## M7 — Pre-release fixes

- Added REST completion signals and cap detection, opt-in numeric money, pattern groups, HTML finding counts, console UTC values and clearer column/key diagnostics. Selected invariants read only their required state. Implementation: `e02381e`.
- Reworked onboarding and contributor guides, manual/nightly staging CI defaults, release-tarball installation instructions and a generic driver no-show example.
- Node 20.20.2 and 22.23.4: lint, typecheck, 244 unit/adapter tests and 73 end-to-end tests passed. Core line coverage: 99.75% (404/405).
- The README workflow and clean-source quickstart passed: 2,750 records per source, zero findings and all four report files. Empty-cache offline package installation, public APIs/types, CLI reports, documentation checks, workflow lint and desktop/mobile report search passed.
- M7 container verification remains covered by the M6 results; the Docker daemon was unavailable for a repeat run.

## M8 — Release readiness

- Enforced UI redirect origins, rejected rendered dot-segments, required explicit opt-in for scenario-local module entries, and rejected executable AI drafts. Expanded secret masking and sanitized diagnostic paths and terminal output. Main implementation: `bbafc39`.
- Added strict short-first-page handling with an explicit opt-out, exact per-key rollups and a freight settlement example, optional/fixed scenario waits, record-stride summaries, version output and source-free configuration validation.
- Prepared checksum-verified release assets, a CI-gated tag workflow, full/slim Docker targets and consumer caching/timeouts. Documented design rationales and author background, and refreshed the parity/scenario screenshots. Build preparation: `91acdbb`.
- Node 20.20.2 and 22.23.4 passed lint, typecheck, 284 unit/adapter tests and 82 end-to-end tests each, with two local test workers. Core line coverage: 99.78% (468/469). Empty-cache offline package installation, public APIs/types and installed CLI checks passed, including missing/extra groups in AI explanations (`13de83a`).
- README and freight commands passed from a clean checkout. The clean-source helper also passed: 2,750 records per demo source and three freight loads rolled up from nine settlement lines, all with zero findings. Both Docker targets passed on linux/arm64 as UID 1000; the full image ran Chromium and the slim image contained no browsers. API/file checks, SQL validation, report generation, offline AI, documentation links/YAML and workflow lint passed.

## M9 — 1.0.1 public-test fixes

- Fixed consumer npm ci, secret interpolation/AI masking, shared validation/env checks, rollup conflicts/blanks/duplicates, money/date parsing and report presentation. Vendored the unchanged ExcelJS runtime with explicit patched dependencies and upstream attribution.
- Prepared 1.0.1 npm OIDC/provenance, checksums, CycloneDX SBOM and container CI templates. LOGIPARITY_IMAGE intentionally contains a marked digest placeholder, replaced in a follow-up after publication.
- Node 20.20.2 and 22.23.4 passed lint/types, 301 unit/adapter tests and 87 e2e tests; core line coverage 99.64% (558/560). Consumer install/npm ci/offline checks, public APIs/types, README quickstart/staging (YAML identical to init), freight, docs/workflow lint and desktop/mobile report search passed. Full/slim images passed on arm64 as UID 1000, including full-image Chromium. The slim index built and passed CLI/freight smoke checks on both amd64 and arm64.
