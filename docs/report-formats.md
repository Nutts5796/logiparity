# Report formats

Choose any subset of `console`, `html`, `junit`, `json` and `markdown` in `report.outputs`. The default is console and JSON. The demo and `logiparity init` select all five. Files are written under `report.dir`, once per selected format. Write failures name the destination and return exit 2. Console-only checks create no report files; a UI failure can still save a diagnostic screenshot.

| Output   | Destination | Content                                                                                       |
| -------- | ----------- | --------------------------------------------------------------------------------------------- |
| console  | stdout      | Counts, warnings, patterns and the first ten findings, with unexplained findings first.       |
| html     | report.html | Offline Studio report with charts, money reconciliation, all findings, search and pagination. |
| junit    | junit.xml   | One suite per entity and six cases per suite, one for each finding type.                      |
| json     | report.json | Complete versioned result with raw normalized values and optional pattern metadata.           |
| markdown | report.md   | Counts, totals and the first 50 findings, with unexplained findings first.                    |

## Offline HTML

Open `report.html` locally. The report follows the [owner's Studio reference](design/report-E.html). The header identifies the environment, configuration and generation time when the CLI provides them. The hero shows the exit code, finding count and source row counts relative to the reference. The donut rounds the explained percentage down. Pattern membership comes from actual finding values and keys, rather than adding approximate group counts.

Cards merge matching kinds and deltas across sources. Mini pages show page-boundary losses, a 24-hour UTC dial shows a time shift, and a 10×10 waffle shows the share of money values with a fixed delta. Captions name the sources. Every cause is a hypothesis: hints begin with “Likely”. There are no per-source lists under the charts.

Totals show differences beneath source values. Money reconciliation uses exact integer minor units: missing reference values, money-pattern counts times their delta, and an unexplained remainder. Filters, rollups and extra rows can leave a nonzero remainder; the report never forces it to zero. A zero remainder is labelled “fully explained”. This describes the arithmetic, not proof of a cause.

“Needs review” is the default table view. “All” includes every finding, in pages of 50 rows. Search covers the whole result, including human labels, raw names and readable values. A pattern button filters the table to that card's members. Entity and finding-type filters combine with the search. On mobile, totals and findings become stacked rows. Without JavaScript the first 50 findings needing review remain visible; JSON always contains the complete result.

Light and dark themes follow the system preference. The toggle stores an override when localStorage is available and still works when storage is blocked. Text contrast is at least 4.5:1 in both themes; controls have visible focus outlines and buttons are at least 40 pixels high. Manrope and JetBrains Mono Latin subsets are embedded as woff2 data URIs. The static styles, scripts and fonts add less than 300 KB. See [font notices](third-party-notices.md).

The report makes zero network requests. Its CSP allows only the exact hash-matched inline script, inline styles and data fonts. It blocks connections, remote fonts, images, forms and base-URL changes. Data and labels are escaped before they enter the DOM. The preview HTML in `docs/design/` uses Google Fonts only as an owner-provided reference; shipped reports do not.

UI failure evidence links to relative PNG, JPEG or WebP files under `screenshots/`. Schemes, traversal, controls, queries, fragments and backslashes are rejected. Images never load automatically. Keep screenshot files beside a report when moving it.

![Light Studio report](images/report.png)

![Dark Studio report](images/report-dark.png)

## Labels and values

Optional source `label`, field `{path, label}` and aggregate `label` keys supply human names throughout HTML, including search and chart captions. Without a label, `delivered_count` becomes “Delivered count”. Entity `pluralLabel: orders` makes aggregate key cells say “All orders”; the fallback is “All records”. Missing-row fields say “Whole row”. Raw names remain in HTML title tooltips, JSON and JUnit. See [configuration](configuration.md).

HTML, Markdown and console show configured money as `$6,826.25` and dates as `Nov 2, 2026, 1:01 PM UTC`. Both datetime columns use UTC. A separate difference shows `-$0.01`, `-6h` or an ordinary numeric delta. Presentation is fixed to `en-US`, independently of the input locale. Bigint formatting preserves large sums and negative sub-unit amounts exactly. HTML title tooltips retain raw epoch milliseconds and minor units. JSON and JUnit retain those normalized values without display labels.

The CLI supplies entity configuration separately from the report. Library callers pass `{entities: config.entities}` to `consoleReport`, `htmlReport`, `markdownReport` or `writeReports`. Without comparison metadata the renderer leaves values unformatted instead of guessing a currency or datetime type. Rendering does not mutate the report.

Warnings have their own count in every format and do not become findings. Source-local conflicts list each observed value and logical data-row number. Console output removes terminal controls, bidi controls and Unicode line separators.

## JUnit

Reports validate against the independent [Windy Road Apache Ant JUnit XSD](https://github.com/windyroad/JUnit-Schema), stored unchanged under `tests/fixtures/junit` with its Apache-2.0 license. Tests run `xmllint --nonet --noout --schema`; Debian and Ubuntu provide it through libxml2-utils. CI also verifies the fixture against its pinned upstream archive.

Each entity has six cases. A case with no findings passes. Blocking ordinary findings produce a failure with all details; source errors produce errors. A case containing only allowed discrepancies is skipped with an explanation. Suite totals count cases, not individual findings. A broken source always returns exit 2, including with `failOn: []`.

The Ant schema requires timestamp, hostname and timing. Timestamp records the generation time in UTC. Hostname is the portable `localhost` label. `time="0"` is a required placeholder, declared in the timing property; no case performance is measured. Markup is escaped and characters illegal in XML 1.0 become U+FFFD. All affected keys and raw values are included without truncation.

## Markdown, JSON and scenarios

Markdown escapes markup, links, images and table separators. It states how many findings were omitted after its first 50 rows. LogiParity writes this text locally and does not post comments to another service. JSON remains schema version 1; consumers should accept optional additive fields. See [report schema](report-schema.md).

Scenarios write `scenario.html`, `scenario.md`, `scenario.json` and `junit.xml`. Optional post-scenario parity writes its own report under `parity/`. The scenario summary links to that report. See [scenario reference](scenarios.md).
