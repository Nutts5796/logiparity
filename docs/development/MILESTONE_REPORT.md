# M10.2 review report — LogiParity 1.1.0

Implemented the M10.2 specification from baseline c848d86. Version remains **1.1.0**, unpublished. Work stops for owner review. No push, tag, publication or Docker build was performed.

## Correctness and compatibility

Diagnostic messages insert labels from structured fields instead of replacing substrings in arbitrary text. Short field names, file paths and raw key parts remain intact. Untyped shared CSV/XLSX/REST values compare as canonical strings. XLSX dates preserve explicit offsets; naive cells and serial dates still require an explicit source zone.

Reconciliation operates independently in each currency bucket and attributes filter-membership moves even when a monetary change is tolerated. Currency changes produce one dedicated finding with key parts; codes are case-insensitive. Raw count figures no longer mix charge lines with loads. Excluded-row lists identify only known contributions removed from that total, and duplicate messages distinguish retaining the first ordinary row from excluding an uncertain rolled-up key. A zero remainder with uncertain lines stays in review.

Page-boundary evidence remains one source-wide cause when an unrelated lost order interrupts its sequence. Tiles include every missing row, including the last partial page. Timezone hints require an offset-free input and a shift within ±14 hours; existing sourceTimezones settings receive facility/per-row advice. Ambiguous Excel serials suggest a zone column or unambiguous text.

Every shipped complete failOn list includes invalid, and explicit omissions warn. All 21 removed 1.0 core runtime exports are restored as deprecated aliases until 2.0, with declaration compatibility. Public AI/scenario entry points now enumerate their exports and document compatibility helpers. Playwright supports >=1.63.0 <2.0.0 with runtime validation and one source for peer ranges. Fixture realpaths remain confined to the scenario directory tree; the 1.0 layout change and migration are documented.

Parity and scenario JSON schemas ship through public package exports with versioned raw IDs. Schemas include accounting, row positions, amounts, evidence, related keys, uncertainty, currency reconciliation and group membership. A shared test validator checks actual engine/scenario results and parsed report JSON, including nested parity. Normalized money/time units remain unchanged; schemaVersion 1 permits additive optional properties.

## Security and release behavior

Unbounded array spread calls were replaced with iteration. Sources default to 100,000 physical rows and reports to 10,000 findings; limits end with a source error or explicit truncated-report notice. The 200,000-duplicate regression raises those configurable limits and completes in a separate 512 MiB heap process. The many-row REST regression uses a 192 MiB heap and rejects an oversized selected array while scanning decoded bytes, before JSON.parse materializes it.

Host guards compare effective scheme ports, account for SQL environment defaults, match hostnames case-insensitively, accept bracketed IPv6 and reject malformed entries. SQL URL host/hostaddr/port overrides fail validation before I/O. Normalized URL variants and invisible-character splits are redacted. Credential tokenization covers CLI flags, escaped/multiline JSON, XML, YAML, Basic auth, PEM and Unicode separators; writers remove unsafe controls and line separators.

Reports default to mode 0600 with configurable fileMode. Scenario artifacts use atomic no-follow streaming writes with a per-file size cap. UI failure evidence captures the viewport and uses the same private atomic writer. Scenario redirects are refused immediately, and console runtime failures include their reason.

The release ref guard and draft lookup run before checkout/build; lookup has narrowly scoped write authority and executes no repository scripts or npm. Build jobs are read-only, and npm subprocesses receive no GitHub/npm tokens from that job. Reused assets and images require verified provenance; downloaded assets are not re-attested as this run’s build. A failed image attestation can be repaired only by a retry of the original build run. GitLab enforces the exact image repository. Offline npm ci disables its unavailable online audit explicitly; normal online consumer audits remain enabled. Gzip headers are normalized, and version bumps preserve historical prose. Node engines require >=22 and CI covers 22, 24 and 26.

## Reports, examples and documentation

Human formats share count calculations, labels, real detail sentences, exact key parts and currency causes. Clean runs identify matching records without an empty donut or See All (0). Uncertain totals remain in review; the findings donut explains its scope separately from total status. Totals scroll inside their card, timestamp captions avoid duplicate reference labels, and page tiles use a readable five-column layout. Long HTML/report templates were split into named helpers.

The installed optional browser flow is `logiparity demo login`, followed by parity-ui.yaml. It stores a private synthetic session and uses the generated actual-port marker. All four generated YAML files warn when their port becomes stale. Dispatcher date/status errors have recovery text, Cancelled has an empty state and mobile pages contain 50 cards. Scenario ETAs are after the morning event window, within the synthetic business day.

The freight fixture contains 120 loads, 358 confirmed charges and 361 physical settlement rows including one filtered void. TONU loads are cancelled and contain only TONU. Accessorial amounts vary. Display-only per-row IANA facility zones do not alter UTC normalization. Explicit charge maps preserve Fuel, TONU and STP. A unique equal-amount missing/extra pair on the same composite-key load receives a possible unmapped-charge-code hint; it is not automatically matched or removed.

The configuration reference was rewritten, upgrade notes moved to the correct sections, and the changelog now covers M10.1/M10.2. API deprecations, fixture migration, limits, file permissions, optional peers and installed UI instructions are documented. Authorship remains explicit. M6, M10 and M10.2 appear in development history. Five documentation screenshots were regenerated and visually inspected, with additional mobile evidence retained locally.

## Executed verification

| Check                                           | Observed result                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run lint                                    | Passed                                                                                                                                                                 |
| npm run format:check                            | Passed                                                                                                                                                                 |
| npm run typecheck                               | Passed                                                                                                                                                                 |
| npm test -- --maxWorkers=2                      | 528 unit/adapter tests passed, no failures or skips                                                                                                                    |
| npm run test:e2e -- --maxWorkers=2              | 113 tests passed with Chromium and disposable PostgreSQL, no failures or skips                                                                                         |
| Line coverage                                   | 91.22%, 3,109/3,408; 80% gate                                                                                                                                          |
| Core / adapters / scenarios / CLI line coverage | 97.13% / 91.10% / 82.39% / 49.39%                                                                                                                                      |
| Node 22.23.4 and 26.13.0                        | 18 targeted correctness/config/schema/fixture checks passed on each; full local suite used Node 24.8.0                                                                 |
| npm run check:docs                              | 68 local links and 23 YAML files passed                                                                                                                                |
| npm run check:third-party                       | Pinned upstream schema, fonts and licenses verified                                                                                                                    |
| actionlint                                      | Passed; release retry/provenance contracts also covered by local mock tests                                                                                            |
| npm run test:quickstart                         | Passed in 29.33 seconds with plain npm ci, build, README staging YAML matching init and 2,750-row API/XLSX/CSV checks                                                  |
| npm run test:package                            | Passed on the final archive: public JS/types, optional peers, installed UI/demo/scenario, empty-cache offline installs and consumer audits                             |
| npm 10.9.9 and 11.6.0 consumer matrix           | All six default/full/older-peer-coexistence profiles passed plain install, ci, audit and audit signatures: 24 commands, exit 0                                         |
| Local release preparation                       | 283,716-byte CLI tarball, 1,028,149 bytes unpacked, 215 entries; SHA-256, SBOM with 49 runtime components and offline kit prepared; nothing published                  |
| Offline kit repeat build                        | Byte-for-byte identical from the same final tarball; 8,111,638 bytes                                                                                                   |
| Cross-format comparison                         | Four generated report sets validate against schemas; HTML/Markdown/console counts and JUnit category counts agree; scenario has 6 failed checks and 50 affected orders |
| Browser layout                                  | Report page width equals viewport at 1,280 and 390 px; five documentation images visually inspected                                                                    |

Coverage measures unit/adapter processes. The scenario runner and CLI subprocess paths are exercised by e2e/installed-package checks without increasing unit-process coverage. Resource-heavy suites were run with two workers after concurrent local runs caused timeouts; obsolete message/mobile expectations were updated to the requested behavior before the final passing runs.

The untouched c848d86 baseline failed 59 of 64 selected ported regression cases (five already passed), across correctness, config/security/limits, release and fixture checks. This is a selected before/after proof, not a claim that every newly added test failed on the baseline. Local evidence is under output/m10-2; it is excluded from the package and repository history.

| Review area                                                            | Regression evidence                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Raj: labels, scalar types, dates, currencies, filters and CLI          | m102-correctness, m102-values, m102-config, m102-words, m102-schema and cli-entry tests                            |
| Tom: currency partitions, duplicate/excluded contributions and freight | filter-contributions property test, money-display/freight-reconciliation, m102-correctness and m102-fixtures tests |
| Maria: interrupted pagination, scenario counts and stale ports         | m102-report-counts, m102-correctness, scenario/CLI tests and installed demo checks                                 |
| Karen: installed browser parity, dispatcher and fixture realism        | UI adapter/Studio e2e tests, m102-fixtures and check-installed-demo                                                |
| Sam: resource bounds, host/port checks, files, redaction and controls  | m102-security, m102-limits, m102-network, AI provider/tokenization tests and low-heap subprocesses                 |
| Ana: token scope, retries, attestations and installer/versioning       | m102-release/release-images tests, actionlint, release preparation and repeat-kit verification                     |
| David/Linda: public API, schemas, defaults, packaging and docs         | Installed JS/type probes, m102-schema/config, package/quickstart/doc checks and upgrade/reference review           |

Source development auditing reported 19 moderate affected-package entries, zero high and zero critical. The six distributed consumer profiles reported zero vulnerabilities. Development tools are excluded from the distributed CLI. Advisory results reflect the observed feed and must be repeated for a future release.

## Review boundaries and owner steps

No requested code fix is intentionally left open. Currency conversion is not performed. JSON keeps exact money minor units and UTC epoch milliseconds. Report caps are explicit failures, and uncertainty does not become a successful reconciliation.

Live publication, GitHub/npm OIDC execution, remote artifact/image attestations, Docker builds or image execution, and real staging APIs were not exercised. Release workflows and retry paths were checked locally with mocks; local verification does not establish a successful live release. Full CI on Node 22/24/26 will execute only after a separately authorized push. Local file tarballs have no npm registry signature before publication; audit signatures checked their registry dependencies, and offline installation checked local integrity.

After review, the owner can separately authorize a release and configure the GitHub **npm** environment, npm trusted publisher (Nutts5796/logiparity, release.yml, environment npm), GHCR repository access and required review rules. The versioned schema URLs and verified 1.1.0 image digest will become public only after publication. Set LOGIPARITY_IMAGE to that release’s verified digest-pinned full/slim reference; variable-based templates require no source commit. Keep CLI and image versions consistent.

## Disclosure

AI coding agents generated the code, tests and documentation under the maintainer’s commit account. The maintainer wrote specifications and acceptance criteria, triaged review rounds and verified fixes. First-person design origin stories remain the maintainer’s own accounts. History was not rewritten. New commits use Conventional Commits and carry `Assisted-by: AI coding agent`.
