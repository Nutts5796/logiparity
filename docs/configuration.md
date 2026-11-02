# Configuration reference (M1)

The strict Zod schema is [packages/core/src/config.ts](../packages/core/src/config.ts). Unknown options fail with the file and configuration path; this includes future milestone options such as `aggregates`, `failOn`, `ui`, `sql` and HTML report outputs. YAML syntax errors include line/column. A missing environment variable is reported by name, without echoing its value.

Required root fields: `version: 1` and a nonempty `entities` array. Optional `environment` is `test` (default) or `staging`; `production` is rejected. This declaration cannot verify a target's actual deployment environment. Entity names must be unique. `variables` maps names to quoted strings. Every scalar string supports `${ENV_VAR}` substitution followed by `{{variable}}`; interpolation occurs after YAML parsing so values cannot inject additional YAML structure.

An entity requires `name`, `key` and at least two named `sources`. The first source is the reference; missing/extra findings describe subsequent sources relative to it. Each source must map the key in `fields`. Only mapped fields shared with the reference are compared, allowing later partial UI sources. Empty sources with valid headers are valid; missing/malformed headers are source errors.

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

`report: {outputs: [console, json], dir: ./logiparity-report}` is the default. At least one supported output is required. `dir` is relative to the configuration file; `report.json` is overwritten on each completed check. JSON output includes source errors even when another source fails. Configuration errors occur before a report is produced. All findings fail in M1; source/runtime failures use exit 2 and take precedence over ordinary findings (exit 1).
