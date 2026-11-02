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

M6 local verification: 205 unit and adapter tests, 62 end-to-end tests, and 100% core line coverage on Node 20.20.2 and 22.23.4. The standalone package installed offline with an empty cache. The Docker image passed non-root Chromium and report checks on linux/arm64. A clean-source quickstart with fresh dependency downloads finished in 15.33 seconds on the development machine. These are local observations, not cross-machine benchmarks.

## M7 — Pre-release fixes

- Added REST completion signals and cap detection, opt-in numeric money, pattern groups, HTML finding counts, console UTC values and clearer column/key diagnostics. Selected invariants read only their required state. Implementation: `e02381e`.
- Reworked onboarding and contributor guides, manual/nightly staging CI defaults, release-tarball installation instructions and a generic driver no-show example.
- Node 20.20.2 and 22.23.4: lint, typecheck, 244 unit/adapter tests and 73 end-to-end tests passed. Core line coverage: 99.75% (404/405).
- A fresh GitHub clone with the local M7 patch passed the README workflow using the documented port override because 3010 was occupied: 2,750 records per source, zero findings and all four report files. The clean-source quickstart helper also passed. Empty-cache offline package installation, public APIs/types, CLI reports, documentation checks, workflow lint and desktop/mobile report search passed.
- Docker smoke testing was not repeated: the local Docker daemon was unavailable. M6 container results are recorded above.
