# Configuration reference (M3)

The strict Zod schema is [packages/core/src/config.ts](../packages/core/src/config.ts). Supported sources are REST, CSV, XLSX, UI and PostgreSQL. Unknown options fail with the file/configuration path. YAML errors include line/column; missing environment variables are reported by name without their value. `logiparity init [--config path]` writes a commented REST/CSV starter without loading sources or overwriting files.

Required root fields: `version: 1` and a nonempty `entities` array. Optional `environment` is `test` (default) or `staging`; `production` is rejected. This declaration cannot verify a target's actual deployment environment. Entity names must be unique. `variables` maps names to quoted strings. Every scalar string supports `${ENV_VAR}` substitution followed by `{{variable}}`; interpolation occurs after YAML parsing so values cannot inject additional YAML structure.

An entity requires `name`, `key` and at least two named `sources`. The first is the reference; missing/extra findings describe subsequent sources relative to it. Every source must map the key in `fields`. Shared mapped fields are compared, allowing partial UI tables. Empty sources with valid structure are valid; malformed input is a source error.

## REST source

```yaml
type: rest
baseUrl: ${STAGING_API_URL}
path: /api/shipments?date={{date}}
headers: { Accept: application/json }
headersEnv: { X-API-Key: STAGING_API_KEY }
auth: { type: bearer, tokenEnv: STAGING_API_TOKEN }
pagination: { type: page, pageParam: page, sizeParam: limit, size: 200, start: 1 }
items: $.data[*]
fields: { id: $.id, payout: $.driver_payout }
timeoutMs: 10000
retries: 3
backoffMs: 100
maxPages: 10000
```

Use either bearer auth or `auth: {type: basic, usernameEnv: API_USER, passwordEnv: API_PASSWORD}`. `headersEnv` values are environment variable names. Literal Authorization, Proxy-Authorization, Cookie and X-API-Key values in `headers` are rejected. Embedded URL credentials are rejected. `path` and pagination URLs must remain on the configured origin. Every request uses GET; redirects are errors, including same-origin redirects, to prevent implicit forwarding.

`items` defaults to `$.data[*]`; `$.data` is also supported when it selects one array. Field paths must select one value per record. Paths support `$`, `.property`, `['quoted property']`, `["quoted property"]`, `[0]`, and `[*]`. No evaluation, filters, slices or recursive descent are supported; unsupported syntax fails when the source is read.

Pagination options (omit `pagination` for a single request):

| Type | Configuration | Completion |
| --- | --- | --- |
| page | `pageParam: page`, `sizeParam: limit`, `size: 200`, `start: 1` | Page contains fewer than `size` records. |
| offset | `offsetParam: offset`, `sizeParam: limit`, `size: 200` | Fewer than `size`; offset begins at 0. |
| cursor | `cursorParam: cursor`, `sizeParam: limit`, `size: 200`, required `next: $.next_cursor` | Next value is null or empty. Response must include the mapped path. |
| link | No other fields. | No `rel="next"` in the Link header. |

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

XLSX requires `type: xlsx`, `file`, `sheet` (exact worksheet name), `fields` and optional `headerRow: 1` (physical worksheet row). String, boolean, numeric, date, rich text, hyperlink text and cached formula scalar results are supported. Formula execution, encrypted workbooks and Excel error cells are unsupported. Monetary columns must contain decimal text. The reader opens ZIP entries lazily, parses metadata first, then streams the selected sheet through ExcelJS; shared strings and metadata are cached. Standard `xl/worksheets/sheetN.xml` worksheet paths are currently required.

## UI source (Playwright Chromium)

```yaml
type: ui
url: ${STAGING_UI_URL}/dispatcher?date={{date}}
storageState: ./auth/state.json
table: "table#shipments"
rows: "tbody tr"
nextPage: "button[aria-label='Next page']"
fields: { id: "td[data-col=id]", status: "td[data-col=status]" }
timeoutMs: 10000
maxPages: 1000
```

Install the pinned browser with `npx playwright install chromium`. URL must be HTTP(S) without embedded credentials. `storageState` is optional and relative to the YAML file. Create it with Playwright on your test/staging login; it can contain credentials and must not be committed. The local demo helper `npm run demo:login` creates ignored state for the public synthetic account only.

Use CSS selectors: table must identify one visible table; rows defaults to tbody tr; field selectors are relative to each row and must match exactly one cell. Text is extracted in one browser batch per page. Money cells must contain decimal text without currency symbols. Optional `readySelector` waits for a visible readiness marker before extraction, useful for asynchronously populated tables. Empty tables are supported; supplying an appropriate readiness marker avoids confusing a loading state with empty data.

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

| Rule type | Options and behavior |
| --- | --- |
| string | `caseFold: false`, `locale: en-US`, `emptyAsNull: true`. Trimmed text comparison. |
| enum | `map: {Delivered: delivered}` followed by optional case folding. Unknown values keep their trimmed text. |
| number | Locale separators/grouping with Latin digits; finite decimals; `tolerance: 0` by default. Exponents and currency symbols are rejected. |
| money | Required ISO currency code (e.g. `USD`); decimal string → bigint minor units. Currency fraction digits follow Intl. `tolerance` is a nonnegative safe integer in minor units. No rounding is performed; excess nonzero decimal places fail. |
| datetime | ISO 8601 → UTC milliseconds; `sourceTimezones: {export: America/Chicago}` for offsetless values; `toleranceSeconds: 0` default. Missing zones, invalid dates, DST gaps and ambiguous local clock times fail. |

Empty and null are equivalent by default; `emptyAsNull: false` preserves empty strings for string/enum fields. Number/money/datetime fields still require valid nonempty values. Comparisons involving null pass only when both sides normalize to null. Keys are nonempty trimmed strings or safe integers, compared as strings; normalization rules do not change key identity. Duplicate keys produce findings, with first record retained and total row counts preserved.

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
