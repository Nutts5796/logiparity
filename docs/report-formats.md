# Reports

Use `report.outputs: [console, html, markdown, json, junit]`. Paths resolve from the configuration file. JSON keeps normalized values, including exact integer minor units as strings and datetime epoch milliseconds. Human formats use configured labels, humanized fallbacks, Reference and Source value, thousands separators, currency amounts and readable dates. Raw amounts and epochs remain in JSON.

HTML is a self-contained offline report with embedded licensed fonts, a strict CSP, light and dark themes, search and 50-row pages. Findings are stored as arrays with a shared string dictionary. A synthetic 2,750-order run with missing rows, rounding and timezone defects should remain below 2 MB for HTML and for JUnit, excluding separately saved evidence screenshots. Size grows with unique messages and findings; this is a regression target, not a fixed limit.

The hero leads with supported causes and individual review counts. A pattern needs at least `patterns.minCount` findings (default 3, minimum 3). A single overpayment or status mismatch stays under Needs review. Cause cards suggest a next step. Accounted for means each difference is traced to a cause above. Each cause still needs a fix. This status is neutral and does not change `failOn` or the exit code.

Money, count and number-sum totals show missing, extra and changed-value contributions, supported pattern deltas, uncertainty and an unexplained remainder in HTML, Markdown, console, JSON and JUnit. Number contributions use exact canonical decimal strings; numeric totals also expose `exactValues`, used for display and reconciliation. Totals fully accounted for say Follows from; a nonzero remainder needs review. Blank or duplicate lines make only the affected keys uncertain. Totals reconcile certain keys and list Uncertain lines separately. Unmapped totals say Not mapped; connection failures say Not read. HTML hides empty contribution buckets; text breakdowns retain explicit zero components.

Case-only and whitespace-only patterns retain the actual candidate text and suggest explicit normalization. Numeric pairs are repeated numeric changes, never vocabulary mappings. Consistent enum changes suggest comparing refresh timing in both sources and field definitions; a pattern alone cannot identify which system is wrong.

Page/offset reads without total-count or other completion metadata include a completeness warning even when every compared record matches. A separate count request can provide an independent check.

Charts use each source's unique key count. The rounding waffle names its source and rounds down, with 1 square = 1%. Page-boundary charts show rows kept per page. Timezone fixes name the configuration property without guessing a zone. Source headers show row filters and rolled-up line-to-key counts.

`report.displayTimezone` accepts an IANA zone and defaults to UTC. It changes human date display, including the run timestamp; it never changes normalization. Set `compare.<field>.sourceTimezones` to interpret a timezone-free source. JSON retains canonical time units; calendar-date fields remain ISO days and have no display zone.

Console and Markdown prioritize individual review, then provide examples of supported causes. Markdown uses Markdown escaping, hides zero-count finding types and limits individual rows to 50, with one example per cause. JUnit groups findings by entity and human-readable type; one finding uses singular grammar. Runtime/source errors are distinct from ordinary findings in every format. JUnit `time=0` is a schema placeholder, not measured execution time.

Scenario HTML uses the same typography, colors, theme switch and offline policy. Invariants have plain names and explanations, warnings link to the scenario reference, and assignment failures include drivers per key. The synthetic-data footer appears only for the demo target. Scenario JSON retains machine-readable invariant names.
