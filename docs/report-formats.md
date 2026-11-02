# Report formats (M2)

Select any subset of `console`, `html`, `junit`, `json`, `markdown` in `report.outputs`. Defaults remain console and JSON for M1 compatibility. The shipped demo and `logiparity init` example select all five. Paths are relative to `report.dir`; repeated outputs are written once. Console-only checks do not create a report directory. Write failures include the format/path and return exit 2.

| Output | Destination | Content |
| --- | --- | --- |
| console | stdout | Counts, blocking count, first ten findings. |
| html | report.html | Complete findings and aggregate values, entity/type filters and text search. |
| junit | junit.xml | One suite per entity and six cases per suite, one for each finding type. |
| json | report.json | Complete versioned machine-readable result. |
| markdown | report.md | Summary counts/aggregates and the first 50 findings for a merge request comment. |

## HTML

Open report.html locally in a browser. CSS and JavaScript are inline; there are no external fonts, CDNs, images or network requests. A Content Security Policy permits only the bundled hash-matched filter script and inline styles. Data values are escaped as text. Filters combine entity, finding type and case-insensitive text search; an empty-result message and live visible count describe the current view. Without JavaScript all rows remain readable. Narrow viewports scroll wide tables within their container.

Optional `findings[].screenshot` values link to PNG/JPEG/WebP files under a relative `screenshots/` directory. Paths with schemes, traversal, control characters, queries, fragments or backslashes are ignored. Links do not load images automatically. The UI adapter will produce screenshots in M3; M2 does not claim that adapter exists. Preserve relative screenshot files when moving a report.

## JUnit

Reports validate against the independently authored [Windy Road Apache Ant JUnit XSD](https://github.com/windyroad/JUnit-Schema), vendored unmodified under tests/fixtures/junit with its Apache-2.0 license and checksum. Tests invoke `xmllint --nonet --noout --schema` so validation requires no network. Install libxml2-utils on Debian/Ubuntu; CI does so explicitly.

Each entity has six cases, using the full finding type names. A case with no findings passes. Blocking ordinary findings produce one failure containing all finding details; source errors become errors. A case containing only nonblocking findings is skipped with an explanation, so CI does not present allowed discrepancies as executed passing checks. Suite counts count cases, not individual findings. A broken source is always an error even under `failOn: []`.

The strict Ant schema requires timestamp, hostname and timing fields. Timestamp is the actual generation time in UTC, recorded as a suite property. Hostname uses the portable `localhost` label. No per-case timing is measured: `time="0"` is a schema-required placeholder, explicitly declared in the `timing` property, and is not a performance measurement. Finding order and comparison values are deterministic; generation timestamps vary across runs.

XML markup is escaped and characters illegal in XML 1.0, including unpaired UTF-16 surrogates, are replaced with U+FFFD. JUnit includes all affected keys and values without truncation. JSON retains original scalar text.

## Markdown and JSON

Markdown escapes untrusted markup, links/images and table separators. It includes aggregate values and skipped source names; summaries over 50 findings explicitly state the omitted count. Select HTML or JSON as well for a complete finding list. LogiParity writes the comment text to a file and never posts it to another service.

JSON schema version remains 1: M2 adds optional `blocking`, `screenshot` and entity `aggregates` metadata, permitted by the v1 additive-field policy. Consumers should tolerate optional fields. See report-schema.md for units and structure.
