# Runtime dependencies and licenses

Generated from the committed lockfile by `node scripts/dependencies.mjs`.
Direct external runtime dependencies and optional peers are pinned exactly. Playwright, pg, pg-query-stream and pgsql-ast-parser are optional peers; the other entries are ordinary runtime dependencies:

| Package          | Version | License    | Purpose                                                                     |
| ---------------- | ------- | ---------- | --------------------------------------------------------------------------- |
| csv-parse        | 7.0.3   | MIT        | Streaming CSV parsing                                                       |
| saxes            | 6.0.0   | ISC        | Streaming XML parsing for XLSX metadata, strings and rows                   |
| jiti             | 2.7.0   | MIT        | Load explicitly configured TypeScript invariants on supported Node versions |
| luxon            | 3.7.2   | MIT        | Explicit IANA timezone conversion and DST validation                        |
| pg               | 8.23.1  | MIT        | PostgreSQL client and read-only transaction lifecycle                       |
| pg-query-stream  | 4.17.1  | MIT        | Bounded PostgreSQL row batches                                              |
| pgsql-ast-parser | 12.0.2  | MIT        | Reject non-read-only SQL before connecting                                  |
| playwright       | 1.64.1  | Apache-2.0 | Isolated Chromium table extraction and failure screenshots                  |
| unzipper         | 0.12.5  | MIT        | Lazy central-directory XLSX entry streams                                   |
| yaml             | 2.9.1   | ISC        | YAML parsing with duplicate-key checks                                      |
| zod              | 4.6.7   | MIT        | Strict configuration validation                                             |

First-party workspace packages use this repository's MIT license. ExcelJS is a development-only writer for independent test fixtures; it is not installed or bundled with the CLI. The runtime XLSX reader uses unzipper and saxes, with a temporary disk index and a bounded cache for shared strings. Only the six first-party packages are bundled. Third-party runtime dependencies install normally and remain patchable through consumer overrides. Development tools are pinned in package.json and package-lock.json.

The full transitive runtime inventory follows. Development-only jszip and pako retain their upstream notices in the fixture writer but are not distributed with the CLI. The SQL parser transitively includes railroad-diagrams under CC0-1.0; its declared license is recorded below and the package retains its notice. No runtime dependency has unknown license metadata.

## Installation size

The first-party archive is about 250 KB compressed and under 1 MB unpacked. Its code, embedded Latin fonts, documentation and synthetic fixtures account for that size; report screenshots, design previews, development history and generated reports are excluded. The default runtime graph adds CSV/XML/ZIP parsing, validation, timezones and trusted custom-module loading. Optional browser/database peers add their own code. Chromium binaries are a separate download and dominate the full Docker image; the slim image omits both browser and database peers.

Exact sizes depend on the release and platform. Package checks record compressed and unpacked bytes; use npm pack metadata and npm ls to inspect an installed graph. The offline kit is larger because it includes verified archives for both profiles and integrity lockfiles. A standalone CLI tarball needs registry access or a populated dependency cache; use the offline kit for a truly empty-cache offline install. See [release procedure](release.md#offline-installation).

## Embedded font notices

The offline HTML report and demo embed Latin subsets of Manrope (500–800) and JetBrains Mono (400–600), both under the SIL Open Font License 1.1. The complete license texts are distributed with the core package in node_modules/logiparity/node_modules/@logiparity/core/assets/fonts/manrope-OFL.txt and node_modules/logiparity/node_modules/@logiparity/core/assets/fonts/jetbrainsmono-OFL.txt. See [third-party notices](third-party-notices.md) for the full texts. Font source URLs and SHA-256 hashes are recorded in the package's upstream.json and checked by check:third-party. The design previews in docs/design use Google Fonts for preview only; generated reports contain no remote font URLs.

## Locked transitive runtime inventory

| Package              | Locked version | Declared license |
| -------------------- | -------------- | ---------------- |
| bluebird             | 3.7.2          | MIT              |
| commander            | 2.20.3         | MIT              |
| core-util-is         | 1.0.3          | MIT              |
| csv-parse            | 7.0.3          | MIT              |
| discontinuous-range  | 1.0.0          | MIT              |
| duplexer2            | 0.1.4          | BSD-3-Clause     |
| fs-extra             | 11.3.1         | MIT              |
| graceful-fs          | 4.2.11         | ISC              |
| inherits             | 2.0.4          | ISC              |
| isarray              | 1.0.0          | MIT              |
| jiti                 | 2.7.0          | MIT              |
| jsonfile             | 6.2.1          | MIT              |
| luxon                | 3.7.2          | MIT              |
| moo                  | 0.5.3          | BSD-3-Clause     |
| nearley              | 2.20.1         | MIT              |
| node-int64           | 0.4.0          | MIT              |
| pg                   | 8.23.1         | MIT              |
| pg-cloudflare        | 1.4.1          | MIT              |
| pg-connection-string | 2.14.1         | MIT              |
| pg-cursor            | 2.22.1         | MIT              |
| pg-int8              | 1.0.1          | ISC              |
| pg-pool              | 3.14.0         | MIT              |
| pg-protocol          | 1.16.1         | MIT              |
| pg-query-stream      | 4.17.1         | MIT              |
| pg-types             | 2.2.0          | MIT              |
| pgpass               | 1.0.5          | MIT              |
| pgsql-ast-parser     | 12.0.2         | MIT              |
| playwright           | 1.64.1         | Apache-2.0       |
| playwright-core      | 1.64.1         | Apache-2.0       |
| postgres-array       | 2.0.0          | MIT              |
| postgres-bytea       | 1.0.1          | MIT              |
| postgres-date        | 1.0.7          | MIT              |
| postgres-interval    | 1.2.0          | MIT              |
| process-nextick-args | 2.0.1          | MIT              |
| railroad-diagrams    | 1.0.0          | CC0-1.0          |
| randexp              | 0.4.6          | MIT              |
| readable-stream      | 2.3.8          | MIT              |
| ret                  | 0.1.15         | MIT              |
| safe-buffer          | 5.1.2          | MIT              |
| saxes                | 6.0.0          | ISC              |
| split2               | 4.2.0          | ISC              |
| string_decoder       | 1.1.1          | MIT              |
| universalify         | 2.0.1          | MIT              |
| unzipper             | 0.12.5         | MIT              |
| util-deprecate       | 1.0.2          | MIT              |
| xmlchars             | 2.2.0          | MIT              |
| xtend                | 4.0.2          | MIT              |
| yaml                 | 2.9.1          | ISC              |
| zod                  | 4.6.7          | MIT              |
