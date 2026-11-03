# M10.3 review report — LogiParity 1.1.0

Required sections **1–4 are implemented**. Version stays **1.1.0**. The first commit, **a67a934**, preserves the owner’s uncommitted maxRows change before any other implementation: the default remains 100,000 and the Node heap guidance remains in messages/documentation. The owner supplied the million-row/six-column memory observation; this milestone did not repeat that benchmark.

Public release text is prepared for the owner’s planned date **2026-11-04**. The package is still unpublished at this review handoff. No push, tag, publication, Docker build or real AI-provider request was performed.

Review names in this report and the development history refer to **simulated reviewer personas (AI agents), not human testers or users**. They identify review perspectives, not independent human endorsements. Automated checks and the local command runs below were actually executed. The maintainer’s acceptance review is separate.

## Required behavior changes

Matched observations now constrain mapping diagnoses. The buggy dispatcher has 57 of 1,833 Delivered orders showing In transit, while 1,776 match; reports call this stale or lagging values and recommend checking synchronization. A true vocabulary mapping requires that the candidate source never shows the reference value. Canonical CSV/JSON matches count as matches too. Chart values use display labels, and merged mapping sentences describe values instead of inventing a 0 ms duration.

Known page sizes constrain pagination causes. Missing rows are grouped by reference page position, independently of an extra lost order at the beginning, middle or end of a page. Arbitrary stride-3 losses on a ten-row source do not become a pagination diagnosis. The seeded property suite generates invalid values, duplicates, currencies, rollups and lost page-edge keys and compares currency totals to an independent calculation.

Invalid keys remain uncertain even when their money cells have no recorded currency. Reference rows keep Reference; uncertain totals do not also become Accounted for. JSON accounting is withheld for those totals. Console, Markdown and JUnit now show the same missing/extra/value/pattern/uncertain contributions and unexplained remainder available in HTML.

AI explain validates the shipped report schema through exact-pinned Ajv 6.15.0 instead of a divergent strict schema. Tests cover real engine output, the shipped freight example and a real demo --bugs CLI report. Actual CLI previews also accepted the browser demo and scenario parity reports. All previews stayed local; nothing was sent.

Human diagnostic builders use field/source labels for blank values, rollup conflicts, duplicate identities and currency changes without replacing arbitrary raw text. Untyped values retain their full text and use Difference —. Console prints real file paths after successful writes and retains the output configuration hint for console-only runs. Limit errors name their setting path, format counts and retain the owner’s Node memory hint. Facility display zones are described consistently in Markdown/HTML. Zero matching differences are neutral; mobile Totals details have zero left margin.

Missing-peer commands suggest the tested Playwright 1.64.1 and pg 8.23.1 versions while preserving compatible ranges. Missing/expired demo authentication gives the renewal command, including redirects handled inside the UI adapter. Login against a stopped service asks to start the demo. Scenario connection failures identify the unreachable target and target filename.

## Release and small security fixes

The publication-text gate checks shipped source files and the installed tarball, rejecting the specified pre-publication phrases and HEAD compare links. Package checks and the release build/preparation run the gate. Release copy uses the planned date, upgrade notes explain the new row/finding limits and exit-2 behavior, and schema identities/references follow version bumps.

The pasted tag recipe runs inside a fail-fast subshell. Its regression executes the documented block in a scratch Git repository with a prerelease version and a stubbed git executable, proving that no tag/push call is reached. Release jobs downstream of optional attestation jobs have explicit status conditions; local retry tests cover reused assets with skipped attest. Lookup failures name the missing asset.

REST redirect errors no longer reveal the Location host. File-mode input requires quoted octal strings such as '0640' or '0o640'; plain integers are rejected with a quoting hint. UI evidence uses report.fileMode. Writers refuse pre-existing symlink directories within the report tree, including artifacts, parity and screenshots. Invalid URL parsing returns located configuration issues, and host errors no longer append unrelated package-install advice.

Development history now uses actual subjects or commit ranges, labels c848d86 as M10.1 completion, and records M10.2/M10.3 ranges. Contributor/CoC wording, coverage scope, all seven TONU loads, charge-code hints, bind-mount modes and the EDI CSV-mapping roadmap are corrected. Ajv’s runtime dependency/license inventory was regenerated: 55 external runtime components including optional adapters. Updated light/dark report screenshots were inspected; mobile width and Totals alignment were measured in Chromium.

## Executed checks

| Check                                               | Observed result                                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / format / typecheck                           | Passed                                                                                                                                                    |
| Unit and adapter suite                              | 564 passed, zero failures or skips, two workers                                                                                                           |
| End-to-end suite                                    | 116 passed, zero failures or skips, Chromium and disposable PostgreSQL                                                                                    |
| Line coverage                                       | 91.84%, 3,233/3,520; 80% gate                                                                                                                             |
| Core                                                | 97.22%, 1,959/2,015                                                                                                                                       |
| Adapters                                            | 90.93%, 762/838                                                                                                                                           |
| Scenarios                                           | 82.29%, 409/497                                                                                                                                           |
| CLI                                                 | 60.59%, 103/170                                                                                                                                           |
| Node 22 targeted checks                             | 20 passed; full local suites used Node 24.8.0                                                                                                             |
| check:docs / check:third-party / check:release-text | Passed, including installed-archive publication text                                                                                                      |
| Workflow checks                                     | actionlint and local retry/lookup/tag/bump regressions passed                                                                                             |
| test:package                                        | Passed: 221 archive entries, public JS/types, optional peers, private UI login, installed demo/scenario, empty-cache offline profiles and consumer audits |
| test:quickstart                                     | Passed in 26.44 seconds with plain npm ci and the README starter matching init                                                                            |
| npm 10.9.9 / 11.6.0                                 | All six default/full/older-peer profiles passed plain install, ci, audit and audit signatures: 24 commands, exit 0                                        |
| Offline kit repeat                                  | Byte-for-byte identical from the same tested CLI archive                                                                                                  |
| AI explain                                          | Real demo, freight and scenario parity reports accepted in local preview mode                                                                             |
| Cross-format checks                                 | Four report sets validated against schemas; finding totals and JUnit category counts agree                                                                |
| Browser checks                                      | No page overflow at desktop/mobile widths; mobile Totals margins 0 px; zero difference inspected without the red class                                    |

Coverage includes core, adapters, scenarios and CLI; **packages/ai is tested but excluded from the coverage figure**. Subprocess CLI/scenario paths do not add unit-process coverage. CI is configured for Node 22/24/26; GitHub CI itself was not run because this task stops before push.

On the owner-preserved baseline a67a934, 34 of 41 selected ported cases failed and seven already passed. This is a selected before/after proof, not a claim that every new case failed before the fix. Evidence includes baseline-causes, baseline-safety, baseline-ui, baseline-release, baseline-messages and baseline-property JSON/log files under output/m10-3. Regression suites are m103-causes, m103-ai, m103-messages, m103-safety, m103-release, m103-ui, m103-cli and filter-contributions.

Runtime and all six consumer audits reported zero vulnerabilities. The complete development tree reported 19 moderate affected-package entries, zero high and zero critical. These are observed feed results, not a guarantee about future advisories.

## Actual generated report figures

| Run                       | Result                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Demo --bugs, API/XLSX/CSV | 3,741 findings: 14 missing, 3,724 field mismatches, 3 aggregate mismatches                                                  |
| Demo --bugs with UI       | 3,799 findings and four causes: page boundary, timezone, rounding, stale/lagging values                                     |
| UI stale status evidence  | 57 of 1,833 Delivered orders lag; 1,776 match                                                                               |
| Breakdown --bugs          | 6 checks need attention, JUnit failures=6, 50 affected orders; parity has 5,567 findings and one 14-row page-boundary group |
| Freight                   | 16 findings; 120 TMS loads, 358 confirmed charges, 360 settlement input rows after filtering one void                       |
| Freight money             | Reference $144,594.84; charge certain total $144,096.93 (−$497.91); load certain total $142,075.43 (−$2,519.41)             |

Uncertain freight totals retain their contribution breakdown and remain in review. A zero unexplained remainder does not remove uncertainty or resolve the underlying findings. Scenario and freight reports retain canonical JSON money/time units.

## Final artifact identities

Canonical assets are under **output/release**, replacing the stale owner copies there. The working tree is clean at handoff. Assets are regenerated from the final committed tree, and output/release/SOURCE_COMMIT.txt records that commit. The final rebuild’s CLI/archive and kit identities match the bytes tested by package and consumer checks. Development history/report files are excluded from the npm artifact, so recording this report does not change the tested package bytes.

| Artifact                     | Size / identity                                                  |
| ---------------------------- | ---------------------------------------------------------------- |
| logiparity-1.1.0.tgz         | 288,536 bytes compressed; 1,051,951 bytes unpacked; 221 entries  |
| CLI SHA-256                  | 4eea62b26c9d4e810d7e835d775d6803615e2f2b30e5290c98c2d7b79efc1734 |
| logiparity-offline-1.1.0.tgz | 8,475,577 bytes                                                  |
| Offline SHA-256              | 26df3c457333ee2da65abeb5b566e92afd8a37b7e6d733ff88687e4f705d2328 |
| CycloneDX                    | 55 external runtime components, including optional adapters      |

Checksums were compared with the actual canonical files, not copied from a previous review’s tarball. Local evidence remains under output/m10-3 and is excluded from repository history and publication.

## Optional section 5

Completed: demo help mentions parity-ui/login; install-browser confirms success; JUnit omitted counts use thousands separators; missing schema fields are declared; the copied PostgreSQL example writes reports inside its project.

The following optional items are deferred for a proposed 1.1.1 follow-up. They are not claimed fixed:

| Item                                                                                                                                                                    | Reason / current boundary                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Additional AI tokenizer forms: auth=Bearer, HAR, arrow pairs, prefixed/quoted flags, XML attributes, YAML blocks, encoded separators/entities and unusual URL passwords | Requires a broader credential grammar and adversarial preview/provider regressions. Existing structured redaction is not a universal credential detector; review preview payloads before --send. |
| Nested-array/structural-node REST memory guard                                                                                                                          | Selected-row counting does not bound arbitrary nested JSON materialization. A separate structural budget and low-heap adversarial tests are needed.                                              |
| Matches wording for offsetting missing/extra rows                                                                                                                       | Presentation refinement; individual missing/extra findings remain visible and blocking despite equal net totals.                                                                                 |
| Uncertain loads rather than Uncertain lines                                                                                                                             | Entity-specific noun refinement; amounts, keys and statuses are already explicit.                                                                                                                |
| Leading-zero loss hint                                                                                                                                                  | Additional heuristic needs to preserve opaque identifiers; raw display now exposes the difference without inventing numeric equality.                                                            |
| Currency moves with currencyField only on the reference                                                                                                                 | Requires further source-specific fallback policy/testing. Configure currencyField explicitly on every monetary source when using currency partitions.                                            |
| Canonical equivalence for textual 5.0 versus numeric 5 and TRUE versus true                                                                                             | Changes matching semantics and needs a separate compatibility decision; use explicit number/enum rules when appropriate.                                                                         |
| Dispatcher invalid-page recovery links                                                                                                                                  | Optional navigation polish for page=0/page=99; valid mobile pagination is covered.                                                                                                               |
| Cascading YAML diagnostics                                                                                                                                              | Optional error-summary compression; malformed YAML continues to fail validation.                                                                                                                 |

## Review boundaries and disclosure

No required section 1–4 item is intentionally left open. Live npm/GitHub OIDC publication, remote release/image attestations, Docker builds/image execution, real staging APIs and real AI-provider calls were not exercised. Local workflow mocks do not prove a successful live release. Local tarballs have no npm registry signature before publication; signature checks verified their registry dependencies, while local checksums protect the prepared assets.

After reviewing the commits and this report, the owner can separately authorize release and confirm the planned date, npm trusted publisher/environment npm and GHCR access. Use only that release’s verified digest in LOGIPARITY_IMAGE. Nothing in this milestone authorizes a push, tag or publication.

AI coding agents generated the code, tests and documentation under the maintainer’s commit account. The maintainer wrote specifications and acceptance criteria, triaged review rounds and verified fixes. First-person design origin stories remain the maintainer’s own accounts. History was not rewritten; new commits use Conventional Commits and carry Assisted-by: AI coding agent.
