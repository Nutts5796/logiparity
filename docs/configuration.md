# Configuration reference

The strict Zod schema is [packages/core/src/config.ts](https://github.com/Nutts5796/logiparity/blob/main/packages/core/src/config.ts). Supported sources are REST, CSV, XLSX, UI and PostgreSQL. Unknown options fail with the file and configuration path, followed by valid keys for that object. YAML errors include line/column; missing environment variables are reported by name without their value. `logiparity init [--config path]` writes a commented REST/CSV starter without loading sources or overwriting files.

Required root fields: `version: 1` and a nonempty `entities` array. Optional `environment` is `test` (default) or `staging`; `production` is rejected. This declaration cannot verify a target's actual deployment environment. Entity names must be unique. `variables` maps names to quoted strings. Every scalar string supports `${ENV_VAR}` substitution followed by `{{variable}}`; interpolation occurs after YAML parsing so values cannot inject additional YAML structure.

An entity requires `name`, `key` and at least two named `sources`. The first is the reference; missing/extra findings describe subsequent sources relative to it. Every source must map the key in `fields`. Shared mapped fields are compared, allowing partial UI tables. Empty sources with valid structure are valid; malformed input is a source error.

## Human-readable labels

Every source accepts an optional `label`. Each `fields` value can remain a path string or become `{path: ..., label: ...}`; `path` keeps its existing meaning for that adapter (JSONPath, column name, CSS selector or SQL result column). Aggregate definitions also accept `label`. Entity `label` supplies its singular heading and `pluralLabel` supplies aggregate key text, such as `All orders`. Without it the report says `All records`.

```yaml
- name: shipment
  label: Order
  pluralLabel: orders
  key: id
  sources:
    api:
      label: API
      type: rest
      baseUrl: ${STAGING_API_URL}
      path: /shipments
      fields: {id: $.id, delivered_at: {path: $.delivered_at, label: Delivery time}}
    export:
      label: Excel export
      type: xlsx
      file: ./shipments.xlsx
      sheet: Shipments
      fields: {id: ID, delivered_at: 'Delivered at'}
  compare: {delivered_at: {type: datetime}}
```

Human formats use the first configured field label for that logical field, so name a field consistently across its sources. Missing labels are humanized (`delivered_count` → `Delivered count`). Missing-row findings use `Whole row`. JSON retains raw names; human formats, including JUnit, use labels. Labels do not affect comparisons, extraction or grouping.

The dispatcher example reads visible Chicago clock and date text from `.parity-time`, excluding the adjacent CST/CDT abbreviation. Its per-source format is `format: {ui: "h:mm a'\n'LLL d, yyyy"}` with `sourceTimezones: {ui: America/Chicago}`. The quoted newline is part of the visible two-line value. API timestamps continue to use ISO parsing. Use [parity-ui.yaml](../examples/demo/parity-ui.yaml) after `npm run demo:login` (checkout only); the main [parity.yaml](../examples/demo/parity.yaml) keeps the browser-free first report.

## REST source

```yaml
type: rest
baseUrl: ${STAGING_API_URL}
path: /api/shipments?date={{date}}
headers: { Accept: application/json }
headersEnv: { X-API-Key: STAGING_API_KEY }
auth: { type: bearer, tokenEnv: STAGING_API_TOKEN }
pagination: { type: page, pageParam: page, sizeParam: limit, size: 200, start: 1, totalPath: $.pagination.total }
items: $.data[*]
fields: { id: $.id, payout: $.driver_payout }
timeoutMs: 10000
retries: 3
backoffMs: 100
maxPages: 10000
```

Use either bearer auth or `auth: {type: basic, usernameEnv: API_USER, passwordEnv: API_PASSWORD}`. `headersEnv` accepts an environment variable name for a full header value, or `{env: STAGING_API_TOKEN, prefix: "Bearer "}` to construct a Bearer header from a raw token. The same form works in scenario targets. Literal Authorization, Proxy-Authorization, Cookie and X-API-Key values in `headers` are rejected. Embedded URL credentials are rejected. `path` and pagination URLs must remain on the configured origin. Every request uses GET; redirects are errors, including same-origin redirects, to prevent implicit forwarding.

`items` defaults to `$.data[*]`; `$.data` is also supported when it selects one array. Field paths must select one value per record. Paths support `$`, `.property`, `['quoted property']`, `["quoted property"]`, `[0]`, and `[*]`. No evaluation, filters, slices or recursive descent are supported; unsupported syntax fails during semantic validation, before any source is read.

Pagination options (omit `pagination` for a single request):

| Type   | Configuration                                                                          | Completion                                                                              |
| ------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| page   | `pageParam: page`, `sizeParam: limit`, `size: 200`, `start: 1`                         | Metadata confirms completion; without metadata, a later short page.                     |
| offset | `offsetParam: offset`, `sizeParam: limit`, `size: 200`                                 | Metadata confirms completion; without metadata, a later short page. Offset begins at 0. |
| cursor | `cursorParam: cursor`, `sizeParam: limit`, `size: 200`, required `next: $.next_cursor` | Next value is null or empty. Response must include the mapped path.                     |
| link   | No other fields.                                                                       | No `rel="next"` in the Link header.                                                     |

Page and offset pagination accept optional `totalPath`, `totalPagesPath` and `hasMorePath` JSONPaths. Counts must be nonnegative safe integers; hasMore must be boolean. Configure one signal or consistent signals together. `totalPath` counts items across the complete result; `totalPagesPath` counts pages, including the final short page. Page numbers start at 1 by default, or 0 when configured; offset starts at 0.

If a response has more items than requested, the source fails. A short page that still advertises more items or pages also fails, naming the page, requested size and received count. Set `size` to the API's actual page-size cap before comparing. The engine does not use an incomplete source to blame another source with extra records. Full final pages stop immediately when metadata says complete. Conflicting signals, invalid counts and missing paths are source errors.

Without a signal, a short first page fails as a source_error with exit 2. Configure totalPath, totalPagesPath or hasMorePath. For an API without completion metadata, pagination.allowShortFirstPage: true explicitly accepts the short first page and prints a warning. This opt-out cannot verify completeness. Later short pages still terminate pagination when no signal is configured.

Page size is 1–10,000. Repeated request URLs/cursors or exhausting `maxPages` produce source errors. 429 and 5xx responses and connection/timeout failures retry with exponential backoff; Retry-After is honored with a maximum 30-second response delay. Other HTTP errors fail immediately. `timeoutMs` covers headers and body reads for each request; the complete run may exceed one request timeout. Full pages may require one final empty-page request.

## File sources

```yaml
type: csv
file: ./out/shipments.csv
delimiter: ";"
quote: '"'
encoding: utf8
headerRow: 1
fields: { id: "Shipment ID", payout: "Driver payout" }
```

CSV defaults to comma, double quote, UTF-8 and header row 1. Other encodings: `utf16le`, `latin1`. Empty physical lines are skipped; `headerRow` counts nonempty parsed CSV records, so multiline quoted records count once. Duplicate headers, absent mapped columns and inconsistent column counts fail. Whitespace around headers is trimmed; cell values are normalized later. File locations resolve from the YAML file's directory.

XLSX requires `type: xlsx`, `file`, `sheet` (exact worksheet name), `fields` and optional `headerRow: 1` (physical worksheet row). String, boolean, numeric, date, rich text, hyperlink text and cached formula scalar results are supported. Formula execution, encrypted workbooks and Excel error cells are unsupported. Monetary columns use decimal text by default; numeric cells require the explicit allowNumber option described below. The reader opens ZIP entries lazily and uses SAX XML parsing. Workbook relationships select the requested sheet, including nonstandard worksheet filenames. Shared strings and their offset index are stored in temporary files, with a 2 MiB byte-budgeted text cache and one 64 KiB index block in memory. Temporary files are removed on success, errors and early cancellation. A shared string may contain at most 1 MiB of UTF-8 text. ExcelJS is used only to write development fixtures and is absent from the installed CLI.

## UI source (Playwright Chromium)

```yaml
type: ui
url: ${STAGING_UI_URL}/dispatcher?date={{date}}
storageState: ./auth/state.json
table: "table#shipments"
rows: "tbody tr"
nextPage: "button[aria-label='Next page']"
fields: { id: "[data-col=id]", status: "[data-col=status]" }
timeoutMs: 10000
maxPages: 1000
```

Install the pinned browser with `npx logiparity install-browser`. URL must be HTTP(S) without embedded credentials. `storageState` is optional and relative to the YAML file. Create it with Playwright on your test/staging login; it can contain credentials and must not be committed. The local demo helper `npm run demo:login` (checkout only) creates ignored state for the public synthetic account only.

Use CSS selectors: table must identify one visible table; rows defaults to tbody tr; field selectors are relative to each row and must match exactly one cell. Text is extracted in one browser batch per page. Money cells use decimal text; symbols and accounting parentheses require the explicit options below. Optional `readySelector` waits for a visible readiness marker before extraction, useful for asynchronously populated tables. Empty tables are supported; supplying an appropriate readiness marker avoids confusing a loading state with empty data.

Omit nextPage for one page. When configured, the next control must exist on page 1; a disabled, aria-disabled or hidden control ends pagination, and an absent control is accepted after page 1. After clicking, mapped table rows must change. Repeated page fingerprints or exhausting maxPages produce source errors rather than silently truncating. Defaults: timeoutMs 10,000; maxPages 1,000. Chromium startup has a minimum 10-second budget; failure screenshots have a minimum 5-second budget. Navigation/selector/pagination waits use timeoutMs.

Every read uses an isolated browser context with blocked service workers and WebSockets. HTTP(S) requests are permitted only to the URL's origin and explicitly listed `allowedOrigins` (exact origin strings without paths, trailing slash, query or fragment). Add your configured staging asset/SSO origins if required; other requests are blocked. The adapter performs configured UI navigation/pagination, not an automatic login or arbitrary action script.

On read failure the adapter attempts a PNG under report.dir/screenshots, preserving a relative screenshot path in the existing source_error finding. The browser/context always close, including cancelled reads. Failure screenshots may include visible test data: treat them with the same access controls as reports. A launch/storageState failure before a page exists cannot produce a screenshot.

## SQL source (PostgreSQL)

```yaml
type: sql
connectionEnv: STAGING_DATABASE_URL
query: SELECT id, status, payout FROM shipments WHERE shipment_date = $1 ORDER BY id
params: ["2026-11-02"]
fields: { id: id, status: status, payout: payout }
timeoutMs: 10000
batchSize: 1000
```

connectionEnv names an environment variable containing an explicit postgres:// or postgresql:// host/database URL. No connection string or secret is stored literally in YAML. Use a dedicated SELECT-only test/staging role. Bound params accept strings, finite numbers, booleans and null; put monetary parameters in decimal strings.

Before reading credentials or connecting, a PostgreSQL AST parser requires exactly one SELECT, SELECT UNION, or WITH/RECURSIVE ... SELECT. It rejects modifying CTEs, INSERT/UPDATE/DELETE/DDL, SELECT INTO, row locks, multiple statements and unsupported grammar. Supported function calls are a closed read-only builtin allowlist (aggregates, common text/numeric/date functions, current_setting and generate_series); see packages/adapters/src/sql-guard.ts. Custom functions and operational calls such as set_config, nextval, dblink and pg_terminate_backend are rejected in query text. Queries are not rewritten. Valid PostgreSQL syntax outside the parser's supported subset is rejected too.

Execution uses one dedicated pg client and BEGIN READ ONLY, local statement/lock timeouts, and a fixed pg_catalog/public search path. Rows stream with pg-query-stream; batchSize defaults to 1,000, maximum 10,000. timeoutMs defaults to 10,000 and applies to connection and PostgreSQL statements; it is not a wall-clock bound for the whole comparison. The adapter rolls back and closes its stream/client on success, error or cancellation. Transaction restrictions also reject writes reached through a view, as tested. READ ONLY is not a sandbox for privileged functions hidden inside database objects; the restricted staging role remains necessary.

Column mappings use result aliases exactly. pg numeric/int8 remain exact decimal strings; timestamptz is an absolute Date; timestamp without time zone retains its wall-clock string for sourceTimezones normalization. No global pg type parsers are changed. Error messages include the connection variable name, operation and available PostgreSQL code; connection credentials and raw server error text are not printed.

## Normalization

`compare` maps field names to rules. Without a rule, strings are trimmed, empty/null/undefined become null, and other scalar types retain their type. Non-scalar fields fail; map the relevant scalar property.

| Rule type | Options and behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| string    | `caseFold: false`, `locale: en-US`, `emptyAsNull: true`. Trimmed text comparison.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| enum      | `map: {Delivered: delivered}` followed by optional case folding. Unknown values keep their trimmed text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| number    | Locale separators/grouping with Latin digits; finite decimals; `tolerance: 0` by default. Exponents and currency symbols are rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| money     | Required ISO currency code (e.g. `USD`); decimal string → bigint minor units by default, with opt-in `allowNumber: true` for finite numeric input. Currency fraction digits follow Intl. `tolerance` is a nonnegative safe integer in minor units. No rounding is performed; excess nonzero decimal places fail. `allowCurrencySymbol: false` and `negativeParentheses: false` are strict defaults; opt in to accept the configured currency symbol/code and accounting negatives such as `(200.00)`. Other currencies and invalid grouping still fail.                                                                                    |
| datetime  | ISO 8601 → UTC milliseconds; optional `format: "MM/dd/yyyy HH:mm"` applies one Luxon format to every source, while `format: {export: "MM/dd/yyyy HH:mm"}` selects it only for that source; other sources keep ISO parsing; `sourceTimezones: {export: America/Chicago}` for offsetless values; `toleranceSeconds: 0` default. Missing zones, invalid dates, DST gaps and ambiguous local clock times fail. A date without a time reports "date has no time". A format mismatch names the configured format and source before checking offsets. Custom formats retain zone/DST checks; include an explicit offset to disambiguate overlaps. |

Empty and null are equivalent by default; `emptyAsNull: false` preserves empty strings for string/enum fields. Number/money/datetime fields still require valid nonempty values. Comparisons involving null pass only when both sides normalize to null. Keys are nonempty trimmed strings or safe integers, compared as strings; enum maps and other key rules apply before matching. Duplicate keys produce findings, with first record retained and total row counts preserved.

## Reports

`report: {outputs: [console, json], dir: ./logiparity-report}` is the default. Other outputs: html, junit and markdown. At least one supported output is required. `dir` is relative to the configuration file; selected output files are overwritten on each completed check. Reports include source errors even when another source fails. Configuration errors occur before a new report is produced. See report-formats.md for file names and CI interpretation.

## Aggregates

```yaml
aggregates:
  - { name: delivered_count, type: count, where: { status: delivered } }
  - { name: payout_total, type: sum, field: payout, tolerance: 0 }
```

Names must be unique per entity. `where` defaults to an empty mapping (all records) and combines equality predicates with AND. Values normalize using each source's field rule, including enum/case/locale handling, then compare exactly without field tolerances. Count counts matching unique keys. Sum requires a number or money rule and a reference mapping for its field. Null sum values contribute nothing; an empty set sums to zero. Duplicate keys contribute their first row once and still produce duplicate findings.

Aggregate `tolerance` defaults to zero, independently of per-record tolerances. Count tolerances must be nonnegative safe integers; money tolerances are integer minor units; numeric tolerances are finite nonnegative numbers. Money adds bigint minor units. Numeric sums add canonical normalized decimals exactly before converting back to a finite number, avoiding arrival-order differences and 0.1 + 0.2 artifacts. Numeric overflow becomes a source error.

Reference sources must map every aggregate input and predicate field. Partial compared sources skip an aggregate if they lack any input mapping. Aggregate summaries contain `values` for evaluated sources and `skippedSources` for partial mappings; failed sources publish no partial totals. Mismatch findings have an empty key and the aggregate name in `field`.

## Failure selection and thresholds

The default per-entity policy is `failOn: [missing, extra, mismatch, aggregate, duplicate]`. Categories map respectively to missing_in_source, extra_in_source, field_mismatch, aggregate_mismatch and duplicate_key. A list means zero allowed findings in each selected category; omitted categories are nonblocking. `failOn: []` or `{}` allows ordinary findings as observations.

For inclusive allowed counts:

```yaml
failOn: { missing: 2, mismatch: 10, aggregate: 0 }
```

Exactly two missing findings or ten field mismatches are allowed; a category fails when its count exceeds its limit. Counts span all sources within the entity and remain isolated between entities. When a category exceeds its limit, all its findings become blocking. Every finding remains in the report. Thresholds must be nonnegative safe integers; typos and unsupported categories are configuration errors.

Exit 0 means no blocking ordinary findings; exit 1 means at least one blocking finding. Source errors always block and force exit 2; failOn cannot suppress them. Invalid config, startup or report write failures also return 2. Policy does not change normalization, comparison tolerances or source data. Existing files from an earlier run may remain when configuration validation fails before writing; CI must use the exit code.

## Scenario configuration

Scenarios and mutation targets have separate schemas from Parity. Use `logiparity scenario run <scenario.yaml> --target <target.yaml>`. Event templates do not use Parity's flat `variables` syntax; they use scoped typed placeholders (`params`, `fixture`, `seconds`). See the [scenario reference](scenarios.md) for target consent, state field mappings, custom checks and fresh post-scenario Parity.

## AI settings

AI commands use a separate `--ai-config` file with version 1, redactFields, timeoutMs and maxFindings. Provider URL/model/key come only from the three LOGIPARITY_AI environment variables. Normal Parity/scenario configuration has no automatic AI hook. See [AI reference](ai.md).

## Numeric money inputs

Money rules default to strict decimal strings. Use `allowNumber: true` only when a source returns JSON numbers or numeric spreadsheet cells:

```yaml
compare:
  payout: {type: money, currency: USD, allowNumber: true}
```

Finite numbers are converted through `String(value)` and parsed as locale-independent decimals, including exponent notation. Conversion to bigint minor units uses the same exact rule as strings: extra nonzero decimals fail rather than round. For USD, 12.34 becomes 1234 minor units; 12.345 fails. NaN and infinities fail. A computed value such as 0.1 + 0.2 also fails when its decimal string contains extra nonzero digits. String inputs continue to use the configured locale.

JavaScript may already have lost precision while parsing or computing a number. String conversion cannot recover those digits, especially for large amounts. Decimal strings preserve the original decimal amount and remain the recommended interchange format. The option does not change JSON output, money tolerance units or exact aggregate arithmetic.

## Per-key rollups

A source can declare:

```yaml
rollup:
  by: load_id
  sum: [carrier_pay]
  first: [status, delivered_at]
  duplicates: {by: [load_id, charge]}
```

`by` must equal the entity key. Each projected field belongs to exactly one of `by`, `sum` or `first`. Optional `duplicates.by` references mapped fields and includes the entity key; identity-only fields such as `charge` need not be projected into the load total. Identity values cannot be blank. Choose fields that uniquely identify a legitimate line within a load: two valid lines sharing that identity will be flagged, so add a line ID when repeated charge types are legitimate.

Values normalize before summing; money uses bigint and numbers use exact decimal accumulation. `first` retains the first normalized value in input order, including null, and reports every conflicting later value with `reason: rollup_conflict`, with a `values` array of observed values and input line numbers. These source-local observations do not use expected or actual reference values. A blank money input in `sum` produces `reason: rollup_missing_value`; blank numeric sum inputs continue to contribute zero. Repeated duplicate identities produce `duplicate_key` with `reason: rollup_duplicate` and are excluded before summing. Duplicate messages identify the excluded monetary amount.

Conflicts mark their field uncertain; blank money or duplicate identities mark the affected sum fields uncertain. Comparisons involving those fields on that key are skipped on either side, and aggregate sums/predicates depending on them exclude only those keys and report them as uncertain. This prevents a data-quality problem from producing a misleading rounding or mapping pattern. Counts still record all input rows; count aggregates can operate on the valid unique keys. These findings use the existing mismatch/duplicate failure categories. Sources without rollup retain ordinary key duplicate detection. See the [freight settlement example](../examples/freight/README.md).

## Validate without reading sources

`logiparity --version` prints the package version. `logiparity validate --config parity.yaml` loads YAML, interpolates variables and validates schemas, field/source references, REST extraction syntax and read-only SQL syntax. `check` performs the same semantic validation before reading any source. Both commands require all referenced environment variables, including auth/header and SQL variables, to be present and nonempty. `validate --allow-missing-env` permits absent variables for CI linting, lists their names and validates placeholder values; it cannot verify real credentials or source availability. The option is rejected by `check`. Validation does not open exports, launch a browser, call an API or connect to a database. Source availability and snapshot consistency are checked separately by check.

Configuration files are trusted input: they select local files, allowed origins, credentials, queries and scenario mutations. Secret values are redacted from diagnostic paths before errors are printed or saved. A value counts as secret when its variable is referenced by `tokenEnv`, `passwordEnv`, `headersEnv`, `connectionEnv` or the explicit `secretEnv` list, when it comes from any `${NAME}` interpolation (including through `variables`), unless the name appears in `publicEnv`, or when it is `LOGIPARITY_AI_API_KEY`. Basic-auth usernames remain public unless listed in `secretEnv`. Keep configs and generated reports private when they describe internal systems.

Secret interpolation values are recorded before substitution and preserved through schema parsing for CLI, engine and scenario diagnostics and all report formats. Secret metadata is not serialized into reports.

## Warnings

An opted-in unverified short first page is recorded in `warnings` in the report as well as stderr. Warnings are counted separately from findings and do not change the exit code. Inspect the source counts: this opt-out accepts incomplete data without proving completeness. CLI validate and check also warn when a referenced secret is shorter than eight characters. Short secrets are redacted only as whole data values, URL components or header values; longer secrets are scrubbed from substrings and their URI, URL-path, query and form encodings.

Missing environment diagnostics list all absent names together. Only validate suggests `--allow-missing-env`; check and scenario run require their credentials. Semantic errors include paths such as `entities[0].compare.refund_amt`.

The SQL function allowlist checks names. Because the connection search path includes `pg_catalog, public`, a permitted unqualified name may resolve to an object in public when it is not provided by pg_catalog. The READ ONLY transaction and the restricted staging role are the execution boundary; the name allowlist alone cannot establish which implementation runs.

## Composite keys, row filters and uniqueness

`key: [load_id, charge]` matches each charge independently; every source maps both fields. Reports display `L101 · detention`. Composite identity preserves each part internally, so delimiter text cannot collide. Rollups use the same `by: [load_id, charge]`. Single-key stride detection remains available for ordinary shipment IDs.

`where` on a source or rollup accepts equality (`{posting: posted}`), a nonempty list (`{charge: [fuel, detention]}`), or negation (`{posting: {not: [void, reversed]}}`). Map every filter field. Source and rollup filters both apply before summing; excluded rows need not have valid unrelated money cells. Aggregate `where` remains scalar equality only. Report headers show the filters used.

`unique: [tender_id]` checks each named non-key field within one source across distinct keys. Blank values are ignored. A `duplicate_value` finding lists every sharing key and mapped money paid more than once. With rollups, keep uniqueness fields in `first`. See the [synthetic freight day](../examples/freight/README.md).

## Pattern support and invalid rows

`patterns: {minCount: 3}` sets minimum pattern support; smaller groups always need individual review. Configuring a threshold below 3 fails validation. Accounting a total does not resolve its underlying cause or relax `failOn`.

An invalid cell produces `invalid_value` with key, field, spreadsheet row (header counted), observed value and a fix hint. Other valid cells and rows continue comparing. `maxInvalidRows` defaults to 50 per source; more invalid rows produce a source error and exit 2. Configuration, connection, extraction structure and file failures also exit 2. Ordinary findings exit 1 unless allowed by the configured failure policy. Blank money in a rolled-up sum makes that key uncertain rather than zero.

## Environment guard and redaction

`environment: test` is a label, not proof of the target environment. Optional `allowedHosts: [localhost, staging.example.test, 'db.example.test:5432']` restricts REST, UI and PostgreSQL connections before I/O. Hostnames allow any port on that host; an explicit host:port restricts the port. UI asset origins must satisfy both this guard and `allowedOrigins`. Mutation-enabled scenario targets require `allowedHosts`.

Every interpolated environment value is a secret wherever it is used, including through `variables`. Explicit `publicEnv: [PUBLIC_API_URL]` permits non-secret values to appear. Never mark credentials public. Short secrets under eight characters are masked only as whole data values, URL components or header values so configuration and file paths remain readable; one warning names the variable. Basic-auth encodings and report data values are masked too. Redaction is not general PII detection.

`report.displayTimezone: America/New_York` changes all human date displays; UTC is the default. Source parsing still requires explicit sourceTimezones for values without an offset.

The XLSX reader caps each XML entry at 128 MiB, individual text tokens at 256 KiB, tags/attributes at 32 KiB and accumulated cells at 1 MiB. Shared-string temporary data plus its index have a 64 MiB quota; decompression above 200:1 after the first 1 MiB fails. Task-owned temporary files are removed on success, errors, exit, SIGINT, SIGTERM and SIGHUP. Total materialized text is limited to 64 MiB for the selected sheet and source, counting repeated shared-string uses as well as inline text. An uncatchable SIGKILL can prevent cleanup; resource quotas bound the residue.

### Source formatting, currencies and retained totals

Sources may set `locale: de-DE`, `numberFormat: {decimal: ',', group: '.'}` and `datetimeFormat: 'dd.MM.yyyy HH:mm'`. A field rule's explicit locale, numberFormat or format overrides the source default. Locales and IANA sourceTimezones are checked by `validate`. Offset-free XLSX date cells are wall-clock values interpreted in sourceTimezones, independently of the runner's TZ. DST gaps and overlaps require explicit offsets.

Use `currencyField: currency` on a source or money rule, and map that field. Values must be three-letter currency codes. Money totals are partitioned by currency; cross-currency rows produce findings, and mixed currencies within one rollup key are invalid. A configured money currency is the fallback only when no currencyField is set. No exchange conversion is performed. Money is strict by default; opt into `round: half-up` or `round: half-even` to round excess precision in the rule.

Text filters are case-insensitive by default. Set source `caseSensitive: true` for exact text matching. Scalar values, lists and `{not: ...}` work in source, rollup and aggregate filters. Fields without a comparison rule use canonical strings (CSV `"5"` matches YAML `5`); typed fields use their parsing rule. An entirely filtered source emits a warning.

Duplicate keys without a rollup retain the first row, which counts once in totals. Reports show raw source totals and retained/certain totals when they differ, with excluded row numbers. Rollup sums with invalid or blank inputs remain uncertain. A uniqueness field on a rollup must be retained in `by` or `first`. Reconciliation lists missing rows, extra rows, individual value differences, qualifying patterns and uncertain lines; any contribution without a supporting finding stays in the remainder.

REST sources limit each decoded response to `maxResponseBytes` (default 67108864, 64 MiB), including chunked responses without Content-Length. Redirects are refused immediately. PostgreSQL connection URLs may not override host, hostaddr or port in query parameters. allowedHosts accepts host or host:port only, without URL schemes or paths. Report writers refuse existing symlink destinations and replace complete reports atomically.

Failure categories are missing, extra, mismatch, aggregate, duplicate and invalid. duplicate_value belongs to duplicate; invalid_value belongs to invalid. All are enabled by default. Explicit category lists opt out of all unlisted categories.

For currencyField rules, the legacy scalar values entry is the configured-currency bucket. Read valuesByCurrency for the complete set of totals; it is never an exchange-converted combined total. Reconciliation diagrams apply to a single currency; mixed-currency totals remain separate and are not marked accounted for by a combined sum.
