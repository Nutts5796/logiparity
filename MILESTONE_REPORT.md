# M10 review report — LogiParity 1.1.0

Implemented the complete M10 specification. Version 1.1.0 remains unreleased. Work stops for owner review; nothing was pushed, tagged or published. Optional adapter and packaging work was performed last, in separate commits, after the other features and their regression checks passed.

## Result

Patterns require at least three findings, configurable through patterns.minCount. Single differences stay under Needs review. Money and count totals trace missing rows and supported deltas, distinguish uncertain keys and show neutral Accounted for / Follows from language. Human reports share labels, Reference / Source value, grouped numbers, readable dates and currencies. JSON retains normalized minor units and epoch milliseconds. HTML findings use compact data and pagination.

Freight comparisons support composite keys, source and rollup filters, per-source non-key uniqueness and per-row invalid values. A bad cell no longer discards every other row; maxInvalidRows defaults to 50. The synthetic freight day contains 40 loads, 149 rate-confirmation lines and 151 posted settlement rows, plus one excluded void row. Its 12 intentional findings include a $15 unconfirmed detention charge, duplicate tender/fuel, blank amount and status conflict. None becomes a one-off pattern.

Scenarios validate before execution and include affected_reassigned with a pre-event baseline. Demo no-show, breakdown and staging examples use it. Scenario reports show plain invariant names, source labels and drivers before/after. The synthetic delivery demo runs from the installed package, writes a new example without overwriting an existing config, and prints bounded export/check commands. Its payouts depend on zone and distance; delivery times vary and in-transit ETAs follow the snapshot.

Security changes cover raw and normalized scenario paths, encoded placeholders, fixture realpath confinement, bound environment credentials, short-secret boundaries, Basic authentication, file-report values, AI quoted credentials and console controls. Streaming XLSX parsing caps tokens, attributes, cell text, XML expansion and temporary disk use; tests verify cleanup on SIGINT and SIGTERM. allowedHosts guards connections before I/O and is required for mutation-enabled targets.

The CLI archive bundles six first-party packages only. Playwright and the PostgreSQL packages are optional peers, loaded only for their configured sources. Missing peers fail with exit 2 and the exact install command. Normal external dependencies are exact-pinned and consumer overrides work. The verified offline kit supplies both dependency profiles without putting third-party code inside the CLI tarball. Direct workspace npm pack/publish is rejected; pack:artifact and release:prepare create sanitized artifacts.

Release jobs separate build, provenance, draft creation, npm, images and notes. npm publication requires a tag push; manual runs only retry images from the exact existing tag. Retries verify existing assets and preserve existing image digests. CI covers Node 20/22/24. Templates, release/version tooling, full license texts, dependency notes, public development history and screenshots were updated.

## Verification

| Runtime      | Unit and adapter tests | End-to-end tests | Typecheck |
| ------------ | ---------------------: | ---------------: | --------- |
| Node 20.20.2 |             370 passed |       111 passed | Passed    |
| Node 22.23.4 |             370 passed |       111 passed | Passed    |
| Node 24.8.0  |             370 passed |       111 passed | Passed    |

Core line coverage: 97.15% (1,368 of 1,408 lines). Lint, formatting, documentation/YAML checks, actionlint and pinned upstream font/schema/license checks passed.

| Consumer check, using the same final archive           | npm 10.9.9        | npm 11.6.0        |
| ------------------------------------------------------ | ----------------- | ----------------- |
| Plain install, default and optional-peer profiles      | Passed            | Passed            |
| Plain npm ci with unchanged consumer lock              | Passed            | Passed            |
| Plain npm audit                                        | 0 vulnerabilities | 0 vulnerabilities |
| Initially empty-cache offline kit, both profiles       | Passed            | Passed            |
| Missing UI/SQL peers: exit 2 and install command       | Passed            | Passed            |
| Public APIs do not load unused optional peers          | Passed            | Passed            |
| Luxon override to 3.7.1, including timezone comparison | Passed            | Passed            |
| Installed demo and freight commands                    | Passed            | Passed            |

The clean-source README quickstart and the identical init/staging YAML passed. The installed demo compared 2,750 orders per source with zero findings. Broken API/file demo: 3,741 findings, three merged causes, zero individual-review findings; its totals remain failures requiring fixes. The fixture has 14 missing Excel rows (10 delivered) and 34 rounding differences per complete export. Reference payout is $80,728.70.

Local full/slim Docker images passed on linux/arm64 under UID 1000. Full launches Chromium and validates SQL; slim contains none of the four optional peers and gives the expected install guidance. Both passed REST/file comparisons, human reports and local AI previews, and verified version/revision/created OCI labels. The exact final tarball and offline kit were checksum-checked inside both builds. Release code tests cover preservation of an existing digest, new-image build arguments for linux/amd64 and linux/arm64, and refusal before I/O on a bad checksum.

A Node 22 run initially encountered disk exhaustion during a Docker export. Only task-created provisional image tags were removed; the complete rerun passed. The cross-platform offline regression also verifies that macOS metadata sidecars are never treated as dependency archives.

## Review artifacts

- CLI: output/release/logiparity-1.1.0.tgz — 253,486 bytes compressed; 871,266 unpacked; 214 files; six bundled first-party packages.
- CLI SHA-256: 72825043a238ba7bbfba0904fc0e983d4317a2da8482cad92440f6168bafe071.
- Offline kit: output/release/logiparity-offline-1.1.0.tgz — 8,090,379 bytes, with a separate SHA-256 file.
- CycloneDX: output/release/logiparity-1.1.0.cdx.json — full profile, including optional adapters.
- Broken-demo HTML: output/m10/demo-report/report.html — 323,275 bytes; JUnit — 514,254 bytes. Both meet the under-2-MB target.
- Local images: logiparity:m10-reviewed and logiparity:m10-reviewed-slim. OCI revision: efc8bbf8bb240351799693ca9ebad80200a47af7. These local image identifiers are not published registry digests.
- Evidence: output/m10/unit-node20-final.json, unit-node22-final.json, unit-node24-final.json; e2e-node20.json, e2e-node22-final.json, e2e-node24-final.json; canonical-npm10.json, canonical-npm11.json; docker-final.log.

Regenerated screenshots: [light report](docs/images/report.png), [dark report](docs/images/report-dark.png), [dispatcher](docs/images/dispatcher.png), [scenario](docs/images/scenario.png), [freight reconciliation](docs/images/freight.png).

## Publication boundary

No npm publication, GitHub release, registry push or remote attestation was performed. Local Docker execution covered arm64; the release workflow specifies both amd64 and arm64. GitHub OIDC publishing and remote attestation verification require the later approved release run. The 1.1.0 image digest is deliberately not fabricated: CI uses LOGIPARITY_IMAGE and the verified release-note digest is applied after publication. Source development dependencies retain the documented moderate advisories; installed consumer audits are clean.
