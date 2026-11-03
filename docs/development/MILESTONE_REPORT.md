# M10.1 review report — LogiParity 1.1.0

Implemented the M10.1 specification, with sections 1 and 2 first. Version remains 1.1.0. Work stops for owner review. Nothing was pushed, tagged or published, and no Docker images were built.

## Correctness and security

Filters normalize typed values, compare canonical strings otherwise, match text case-insensitively unless opted out, and warn on an entirely filtered source. Aggregates accept list predicates. Reconciliation uses qualifying per-row contributions, including missing rows, extra rows and individual differences; unsupported changes stay in the remainder. Zero remainder accounts for the aggregate while its individual defects remain visible.

Blank values cannot form patterns. Timezone and page-boundary hints require evidence. Key maps run before matching; keys sort naturally. Source formatting supports locales, separators and date formats with field overrides. Locale/zone validation happens before I/O. XLSX wall clocks obey source zones and DST rules independently of runner TZ. Empty spreadsheet rows are skipped; ragged CSV rows remain row-level findings, with physical locations. First duplicate keys count once, and reports separate raw and retained/certain totals and excluded rows. Currency partitions prevent mixed-currency addition; money rounding is explicit. Legitimate affected-order cancellation passes reassignment checks.

Security regressions cover bounded XLSX materialization and correct overflow rows, signal cleanup including SIGHUP, SQL host query overrides, immediate redirect refusal, streamed REST response limits, environment provenance through variables, idempotent credential tokenization, invisible characters, atomic report files, Markdown mentions, public Basic usernames and scenario path validation.

## Packaging, reports and examples

First-party code ships under root lib/ with private imports, eliminating private registry specs from consumer trees. The public core wrapper exposes a documented list. Optional peer ranges are checked at load time; jiti loads only after explicit custom-module opt-in. It remains a normal dependency so custom modules work without a second installation step.

Release preparation depends on reusable CI. Draft lookup has the necessary permission, npm uses its named environment, reused images are not re-attested as new builds, and the SBOM has a typed attestation. Offline archives normalize entry order, ownership and timestamps. Docker's frontend is pinned by a verified digest; Docker builds were intentionally excluded by the specification.

Cause names, source counts and totals agree across formats. JUnit retains cause sentences and next steps while limiting repeated detail. Human reports handle empty states, labels, currencies, compact differences, theme accessibility and clearing cause filters. Timestamp dials and captions use the same observed pair. The demo writes all installed scenario assets and prints usable report paths. Its day is 8 AM–6 PM in Chicago with a noon snapshot and explicit UTC scenario events. The freight fixture has 120 loads, 377 confirmed charge lines and 380 settlement rows including a filtered void; intentional defects produce 16 findings, of which 13 need individual review.

## Executed validation

| Check                                 | Result                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| npm run lint                          | Passed                                                                                                 |
| npm run format:check                  | Passed                                                                                                 |
| npm run typecheck                     | Passed                                                                                                 |
| npm test                              | 455 unit/adapter tests passed                                                                          |
| npm run test:e2e                      | 113 tests passed with Chromium and PostgreSQL                                                          |
| Current chart browser regression      | 7 studio checks passed after the final chart correction                                                |
| Line coverage                         | 88.12% across core, adapters, scenarios and CLI; 80% gate                                              |
| npm run check:docs                    | Passed                                                                                                 |
| npm run check:third-party             | Pinned schemas, fonts and license texts verified                                                       |
| npm run test:package                  | Both profiles, public JS/types, installed demo/scenario and offline checks passed                      |
| npm run test:quickstart               | README source/staging commands passed with plain npm ci in 11.48 seconds                               |
| npm run release:prepare               | Local tarball, checksum, offline kit and CycloneDX SBOM with 49 runtime components prepared            |
| Offline kit repeat build              | Byte-for-byte identical from the same final tarball                                                    |
| npm 10.9.9 and 11.6.0 consumer matrix | Default, full and older-peer coexistence profiles passed plain install, ci, audit and audit signatures |
| Workflow validation                   | actionlint and release-contract regressions passed                                                     |
| Screenshots                           | Five documentation images regenerated and visually inspected; mobile width checked at 390 px           |

The untouched baseline failed 45 of the ported regressions. Twenty-eight original filesystem repro configurations were also executed. Source dependency auditing currently reports 19 moderate development-tree entries, no high or critical entries; distributed consumer audits reported zero vulnerabilities. These are observed advisory results, not a guarantee about future feeds. Documentation retains the distinction between the reproduced audit/signature problems and a separately reported installation crash that was not reproduced.

## Limits and deferred external actions

No known requested code fix is intentionally left open. Currency conversion is not performed; mixed-currency totals stay separate and do not receive a combined reconciliation diagram. Runtime data values and normalized money/time units remain machine-readable; schemaVersion 1 permits optional additions. Diagnostics preserve necessary input locations and field context.

Live publication, GitHub/npm OIDC execution, registry image builds and image runtime verification were not performed because this milestone explicitly stops before push, tag or publish and forbids Docker builds. Release workflows were checked locally, including mocked retry paths. Offline installation verifies local archive integrity and does not claim an online vulnerability audit. A release still needs the owner's external configuration and separate authorization below.

## Owner steps after review

1. Create the GitHub environment named **npm** in repository Settings → Environments. Configure any required reviewers there.
2. In npm trusted publisher settings for **logiparity**, choose GitHub Actions: owner **Nutts5796**, repository **logiparity**, workflow **release.yml**, environment **npm**. The environment names must match exactly.
3. Review the local commits and evidence, then authorize the release separately. No publication is authorized by this milestone.
4. After publication, copy the verified image digest from release notes into LOGIPARITY_IMAGE in a small follow-up commit, keeping the CLI and image versions consistent. The CI variable remains the clearly documented placeholder until that digest exists.

## Disclosure

The code, tests and documentation were generated by AI coding agents. Commits are made under the maintainer's account. The maintainer wrote the milestone specifications and acceptance criteria, triaged review rounds and verified fixes. First-person origin stories are the maintainer's own accounts. Review-found defects are not attributed to the owner. Commit history was not rewritten; new commits carry the Assisted-by trailer.
