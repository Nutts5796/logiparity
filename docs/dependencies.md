# Runtime dependencies and licenses

Generated from the committed lockfile by `node scripts/dependencies.mjs`.
Direct external runtime dependencies are pinned exactly:

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| csv-parse | 7.0.3 | MIT | Streaming CSV parsing |
| exceljs | 4.4.0 | MIT | XLSX cells, metadata and streaming rows/exports |
| luxon | 3.7.2 | MIT | Explicit IANA timezone conversion and DST validation |
| pg | 8.23.1 | MIT | PostgreSQL client and read-only transaction lifecycle |
| pg-query-stream | 4.17.1 | MIT | Bounded PostgreSQL row batches |
| pgsql-ast-parser | 12.0.2 | MIT | Reject non-read-only SQL before connecting |
| playwright | 1.64.1 | Apache-2.0 | Isolated Chromium table extraction and failure screenshots |
| unzipper | 0.12.5 | MIT | Lazy central-directory XLSX entry streams |
| yaml | 2.9.1 | ISC | YAML parsing with duplicate-key checks |
| zod | 4.6.7 | MIT | Strict configuration validation |

Internal workspace packages use this repository's MIT license. Development tools are pinned in package.json and package-lock.json.

ExcelJS overrides pin unzipper 0.12.5 (removes an obsolete dependency chain with missing license metadata) and uuid 11.1.1 (compatible v4 API, fixes the older UUID advisory). XLSX regression tests exercise these overrides. Our XLSX reader uses a narrow typed bridge to ExcelJS 4.4.0 metadata and row parsers to avoid [upstream streaming race #3064](https://github.com/exceljs/exceljs/issues/3064). Recheck this bridge before updating ExcelJS.

The full transitive runtime inventory follows. jszip is consumed under its MIT alternative. pako includes MIT and Zlib notices; preserve both when redistributing. The SQL parser transitively includes railroad-diagrams under CC0-1.0; its declared license is recorded below and the package retains its notice. No runtime dependency has unknown license metadata.

## Locked transitive runtime inventory

| Package | Locked version | Declared license |
| --- | --- | --- |
| @fast-csv/format | 4.3.5 | MIT |
| @fast-csv/parse | 4.3.6 | MIT |
| @types/node | 14.18.63 | MIT |
| archiver | 5.3.2 | MIT |
| archiver-utils | 2.1.0 | MIT |
| archiver-utils | 3.0.4 | MIT |
| async | 3.2.6 | MIT |
| balanced-match | 1.0.2 | MIT |
| base64-js | 1.5.1 | MIT |
| bl | 4.1.0 | MIT |
| bluebird | 3.7.2 | MIT |
| brace-expansion | 1.1.21 | MIT |
| brace-expansion | 2.1.7 | MIT |
| buffer | 5.7.1 | MIT |
| buffer-crc32 | 0.2.13 | MIT |
| commander | 2.20.3 | MIT |
| compress-commons | 4.1.2 | MIT |
| concat-map | 0.0.1 | MIT |
| core-util-is | 1.0.3 | MIT |
| crc-32 | 1.2.2 | Apache-2.0 |
| crc32-stream | 4.0.3 | MIT |
| csv-parse | 7.0.3 | MIT |
| dayjs | 1.11.23 | MIT |
| discontinuous-range | 1.0.0 | MIT |
| duplexer2 | 0.1.4 | BSD-3-Clause |
| end-of-stream | 1.4.5 | MIT |
| exceljs | 4.4.0 | MIT |
| fast-csv | 4.3.6 | MIT |
| fs-constants | 1.0.0 | MIT |
| fs-extra | 11.3.1 | MIT |
| fs.realpath | 1.0.0 | ISC |
| glob | 7.2.3 | ISC |
| graceful-fs | 4.2.11 | ISC |
| ieee754 | 1.2.1 | BSD-3-Clause |
| immediate | 3.0.6 | MIT |
| inflight | 1.0.6 | ISC |
| inherits | 2.0.4 | ISC |
| isarray | 1.0.0 | MIT |
| jsonfile | 6.2.1 | MIT |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| lazystream | 1.0.1 | MIT |
| lie | 3.3.0 | MIT |
| lodash.defaults | 4.2.0 | MIT |
| lodash.difference | 4.5.0 | MIT |
| lodash.escaperegexp | 4.1.2 | MIT |
| lodash.flatten | 4.4.0 | MIT |
| lodash.groupby | 4.6.0 | MIT |
| lodash.isboolean | 3.0.3 | MIT |
| lodash.isequal | 4.5.0 | MIT |
| lodash.isfunction | 3.0.9 | MIT |
| lodash.isnil | 4.0.0 | MIT |
| lodash.isplainobject | 4.0.6 | MIT |
| lodash.isundefined | 3.0.1 | MIT |
| lodash.union | 4.6.0 | MIT |
| lodash.uniq | 4.5.0 | MIT |
| luxon | 3.7.2 | MIT |
| minimatch | 3.1.5 | ISC |
| minimatch | 5.1.9 | ISC |
| moo | 0.5.3 | BSD-3-Clause |
| nearley | 2.20.1 | MIT |
| node-int64 | 0.4.0 | MIT |
| normalize-path | 3.0.0 | MIT |
| once | 1.4.0 | ISC |
| pako | 1.0.11 | (MIT AND Zlib) |
| path-is-absolute | 1.0.1 | MIT |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-cursor | 2.22.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-query-stream | 4.17.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| pgsql-ast-parser | 12.0.2 | MIT |
| playwright | 1.64.1 | Apache-2.0 |
| playwright-core | 1.64.1 | Apache-2.0 |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| process-nextick-args | 2.0.1 | MIT |
| railroad-diagrams | 1.0.0 | CC0-1.0 |
| randexp | 0.4.6 | MIT |
| readable-stream | 2.3.8 | MIT |
| readable-stream | 3.6.2 | MIT |
| readdir-glob | 1.1.3 | Apache-2.0 |
| ret | 0.1.15 | MIT |
| safe-buffer | 5.1.2 | MIT |
| safe-buffer | 5.2.1 | MIT |
| saxes | 5.0.1 | ISC |
| setimmediate | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |
| string_decoder | 1.1.1 | MIT |
| string_decoder | 1.3.0 | MIT |
| tar-stream | 2.2.0 | MIT |
| tmp | 0.2.7 | MIT |
| universalify | 2.0.1 | MIT |
| unzipper | 0.12.5 | MIT |
| util-deprecate | 1.0.2 | MIT |
| uuid | 11.1.1 | MIT |
| wrappy | 1.0.2 | ISC |
| xmlchars | 2.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| yaml | 2.9.1 | ISC |
| zip-stream | 4.1.1 | MIT |
| zod | 4.6.7 | MIT |
