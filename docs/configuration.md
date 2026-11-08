# Configuration reference

Configuration is strict YAML (`version: 1`, `environment: test` or `staging`); unknown keys fail validation. The [source schema](https://github.com/Nutts5796/logiparity/blob/main/packages/core/src/config.ts) defines the complete contract. Paths resolve relative to the YAML file. The first source in each entity is the reference. Compare snapshots from the same cutoff or a closed day.

## Validate before reading

```sh
npx logiparity validate --config parity.yaml
npx logiparity check --config parity.yaml
```

`-c` is the documented alias for `--config`; give it once. Validation checks schemas, mappings, supported JSONPath and read-only SQL without opening files, browsers or connections. `validate --allow-missing-env` permits placeholder environment values for CI linting; `check` requires real values. Scenario files use `scenario validate <file> --target <file>` instead.

## Root, entities and labels

Root options are `version`, `environment`, `entities`, `variables`, `publicEnv`, `secretEnv`, `allowedHosts`, `maxInvalidRows` (50 per source), `maxFindings` (10,000, maximum 1,000,000), `patterns` and `report`. `patterns.minCount` defaults to 3 and cannot be less than 3. A findings limit stops comparison with a truncated notice and source error, exit 2; it never turns a partial report into a pass.

An entity declares `name`, optional `label` and `pluralLabel`, `key`, `sources`, `compare`, `aggregates` and `failOn`. A key is a field name or a list of field names. Every source maps all key fields. Key values are nonempty canonical strings (safe integers are accepted); comparison rules such as enum maps apply before joining. Composite identities preserve each part independently, including delimiter text. Reports show key parts exactly as data, for example `L103 · fuel`; use an explicit enum map to change a code.

```yaml
entities:
  - name: charge
    label: Charge
    pluralLabel: charges
    key: [load_id, charge]
    sources:
      confirmation:
        type: csv
        label: Rate confirmation
        file: ./confirmed.csv
        fields:
          load_id: Load ID
          charge: Charge
          amount: {path: Amount, label: Charge amount}
      settlement:
        type: csv
        label: Settlement lines
        file: ./settlement.csv
        fields: {load_id: Load ID, charge: Charge, amount: Amount}
    compare:
      amount: {type: money, currency: USD}
```

Fields map logical names to paths, column headers or selectors. `{path: ..., label: ...}` supplies a human label. Entity, source, field and aggregate labels have humanized fallbacks; identifiers and raw source text are preserved. Untyped shared fields compare trimmed canonical strings, so CSV `"5"`, XLSX 5 and JSON 5 match. Null remains distinct from a nonempty string.

## Common source options and filters

Every source accepts `label`, `fields`, `where`, `caseSensitive` (false), `unique` (empty), `rollup`, `maxRows` (100,000, maximum 10,000,000), `locale`, `numberFormat`, `datetimeFormat`, `dateFormat` and `currencyField`. Row limits count physical input records before filtering; exceeding a limit yields a source error. The engine indexes the reference and one candidate in memory. With Node's default heap (about 2 GB on an 8 GB Mac), two 1,000,000-row CSV sources with six columns ran out of memory; the same check passed with `NODE_OPTIONS=--max-old-space-size=6144`. Raise `maxRows` together with the heap size.

`where` combines fields with AND. Values can be scalar equality, a nonempty list, or `{not: value}` / `{not: [values]}`. The same predicate grammar applies to source, rollup and aggregate filters. Text equality is case-insensitive by default; set source `caseSensitive: true` for exact text matching. Typed filter values use their field normalization without comparison tolerances; untyped values use canonical strings. Quote money in major units: `{pay: "10.00"}`. Source filters run before unrelated cells are parsed; an all-filtered source warns with its entity/source and applied predicates.

```yaml
where: {posting: {not: [void, reversed]}}
locale: de-DE
numberFormat: {decimal: ',', group: '.'}
datetimeFormat: 'dd.MM.yyyy HH:mm'
maxRows: 100000
```

A rule's explicit locale, numberFormat or format overrides the source default. `dateFormat` is the default for calendar-date fields; `datetimeFormat` applies to datetime fields. Validation checks locales and formats. `unique: [tender_id]` finds a nonblank value reused across distinct keys in one source (`duplicate_value`); with rollups, keep that field in `by` or `first`. A repeated tender alone does not prove a duplicate payment.

## Source types

| Type | Required options                   | Other options and defaults                                                                                                                                                      |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| csv  | `file`, `fields`                   | `delimiter: ','`, `quote: '"'`, `encoding: utf8` (also utf16le, latin1), `headerRow: 1`                                                                                         |
| xlsx | `file`, `sheet`, `fields`          | `headerRow: 1`; missing sheets/headers fail                                                                                                                                     |
| rest | `baseUrl`, `path`, `fields`        | `items: $.data[*]`, `auth`, `headers`, `headersEnv`, `pagination`, `timeoutMs: 10000`, `retries: 3`, `backoffMs: 100`, `maxPages: 10000`, `maxResponseBytes: 67108864` (64 MiB) |
| ui   | `url`, `table`, `fields`           | `rows: 'tbody tr'`, `storageState`, `readySelector`, `nextPage`, `allowedOrigins: []`, `timeoutMs: 10000`, `maxPages: 1000`                                                     |
| sql  | `connectionEnv`, `query`, `fields` | `params: []`, `timeoutMs: 10000`, `batchSize: 1000`                                                                                                                             |

REST mappings use supported JSONPath property/index/wildcard selections; unsupported syntax names its source and field. File/SQL mappings use headers/column names. UI mappings are selectors relative to each row; extraction reads rendered text. UI requires Playwright and Chromium; SQL requires the three optional PostgreSQL peers. Missing-peer errors give exact `--save-exact` install commands. Playwright supports `>=1.63.0 <2.0.0`; installed-package tests cover 1.63.0 and the pinned development version 1.64.1. Other peer ranges are in [dependencies](dependencies.md).

### Absent REST properties

REST mappings are strict by default. If an API omits null-valued JSON properties, opt in for the whole REST source with `absentAsNull: true`, or just one field with `missing: null`:

```yaml
fields:
  id: $.id
  name: {path: $.name, label: Name, missing: null}
```

An absent property, including an absent ancestor object, becomes null. Explicit null already maps to null. Wrong object/array shapes, multiple selected values and unreadable pages still fail; missing pagination metadata is never treated as a null field. The setting does not make a missing entity key valid. `missing: null` is a REST-only mapping option; `absentAsNull` defaults to false. The strict error names both opt-ins. Use a per-field opt-in when omitted properties might otherwise hide a misspelled mapping.

### REST completion and authentication

```yaml
pagination:
  type: page
  pageParam: page
  sizeParam: limit
  size: 200
  totalPath: $.pagination.total
```

Page pagination also supports `start: 1`; offset pagination uses `type: offset`, `offsetParam: offset`, `sizeParam`, `size`. Both support `totalPath`, `totalPagesPath` or `hasMorePath` completion signals. A short first page without a signal fails unless `allowShortFirstPage: true` explicitly opts into an unverified result (warning). Cursor pagination uses `type: cursor`, required `next`, `cursorParam: cursor`, `sizeParam: limit`, `size: 200`; link pagination uses `type: link`. Page sizes are 1–10,000. Exhausted page limits, loops and inconsistent completion fail instead of comparing partial data. Redirects are refused immediately; selected items are counted while decoding, before large arrays materialize.

When page/offset pagination has none of those completion signals, a successful read emits one report warning: completeness is not verified. A short later page still ends the read; an empty probe page does too. A matching comparison is not proof of complete extraction. Run a separate count request with the same filter and a stable dataset version, then compare the count with the physical rows read. Cursor/Link endpoints retain their explicit next-pointer termination. The [Socrata recipe](recipes/socrata.md) shows count requests and stable ordering. There is no automatic `countUrl` option in this version.

Use `auth: {type: bearer, tokenEnv: STAGING_TOKEN}` or `auth: {type: basic, usernameEnv: STAGING_USER, passwordEnv: STAGING_PASSWORD}`. `headersEnv: {Authorization: {env: STAGING_TOKEN, prefix: 'Bearer '}}` constructs a header; a string names an environment variable containing the complete value. Literal `headers` cannot contain sensitive auth/cookie/API-key headers. Credentials must not be embedded in URLs.

### Browser and SQL restrictions

UI reads use isolated contexts, optional authenticated `storageState`, readiness and a Next button selector. Cross-origin assets require `allowedOrigins` and must also pass `allowedHosts` when configured. Virtualized tables, service workers and WebSockets are unsupported. Failure screenshots capture the viewport, use atomic private writes and can contain test data. Slim containers do not include optional peers or Chromium; use the matching full image for UI/SQL.

SQL accepts the restricted read-only SELECT grammar and bound `params`; the adapter uses a READ ONLY transaction and a restricted staging role remains necessary. Connection URLs cannot contain query overrides `host`, `hostaddr` or `port`; `validate` rejects them too. The effective URL/environment port is checked before connecting (URL, then PGPORT, then 5432). URL host selection cannot be redirected by PGHOST. Database objects may have privileged behavior: the function-name allowlist is not a complete sandbox. With `pg_catalog, public` search paths, an allowed unqualified name can resolve to a public implementation.

## Comparison rules

| Type     | Behavior                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| string   | Trim text; optional `caseFold: true` and `whitespaceFold: true` (collapse repeated whitespace to one space). `emptyAsNull: true` by default.                                                                                                                                                                  |
| enum     | Apply `map: {Delivered: delivered}`, optional case folding and `whitespaceFold`. Unknown values keep their trimmed text.                                                                                                                                                                                      |
| number   | Finite decimals with locale or explicit separators, Latin digits, valid grouping; `tolerance: 0`. Numeric JSON/exponent input is accepted; exponent text and currency symbols are rejected.                                                                                                                   |
| money    | Required fallback `currency: USD`; decimal text becomes bigint minor units. `allowNumber: false`, `allowCurrencySymbol: false`, `negativeParentheses: false` by default. `tolerance: 0` in integer minor units. Excess nonzero decimal places fail unless `round: half-up` or `round: half-even` is selected. |
| datetime | ISO 8601 becomes UTC epoch milliseconds; `toleranceSeconds: 0`. Offset-free values require `sourceTimezones`; missing zones, impossible dates, DST gaps and ambiguous wall clocks fail.                                                                                                                       |
| date     | Calendar day normalized as `yyyy-MM-dd`, without a time zone, epoch or tolerance; see below.                                                                                                                                                                                                                  |

Null compares equal only to null. Empty input becomes null by default; `emptyAsNull: false` preserves empty strings only for string/enum fields. Currency digits follow Intl, not a hard-coded two decimals. Numeric sums use exact canonical decimals before returning a finite number; overflow fails.

### Money, currencies and rounding

```yaml
compare:
  pay:
    type: money
    currency: USD
    currencyField: currency
    allowNumber: true
    round: half-even
```

Map `currency` in every source using it. A source-level `currencyField` is also available; a rule overrides it. Codes are three letters and case-insensitive (`usd` equals `USD`). Without a currencyField the configured currency applies. No currency conversion occurs. Mixed currencies within a rolled-up key are invalid. A cross-source currency change emits one currency finding, separate from vocabulary patterns.

`allowNumber: true` converts finite numeric values through their canonical decimal text, including exponent notation. Decimal strings preserve original precision and remain preferable: conversion cannot recover precision already lost by JavaScript. For USD, 12.345 fails unless explicit rounding is configured; `0.1 + 0.2` can fail for the same reason. String inputs still use locale parsing. Rounding applies to input normalization, not to a combined total.

### Calendar dates

Use `type: date` for a calendar day, rather than an instant. The default input is strict ISO `yyyy-MM-dd`; month/year-only, timestamps and zone suffixes fail. `format: yyyyMMdd` or `format: {sms: dd-MMM-yy, census: yyyyMMdd}` selects supported calendar formats by source. The source-level `dateFormat` supplies a fallback; an explicit field format takes precedence. Formats must contain year, month and day and must not contain time or zone tokens. Impossible dates, including invalid leap days, become invalid-value findings. Null follows the normal null rules. Excel serial dates use their recorded calendar day; native JavaScript Date inputs use their UTC day.

The `yy` rule is fixed: **00–68 means 2000–2068; 69–99 means 1969–1999**. It is independent of the current year, host time zone and Luxon global settings. Prefer four-digit years when century ambiguity matters. For example, `20250107` and `07-JAN-25` normalize to `2025-01-07`. A date rule rejects time zones, display-zone fields and nonzero time/numeric tolerances. JSON and every human format retain the canonical day. Calendar-day mismatches stay individual findings rather than timezone or vocabulary patterns.

String/enum comparison still trims surrounding whitespace by default. Repeated internal whitespace remains significant unless `whitespaceFold: true`; letter case remains significant unless `caseFold: true`. Both fold settings default to false. Formatting patterns preserve the actual normalized spelling and suggest those opt-ins without automatically accepting differences.

### Datetimes and facility display

Validation rejects a datetime format without time tokens and recommends `type: date`, including a source's effective `datetimeFormat`. `format: 'MM/dd/yyyy HH:mm'` applies a supported Luxon format to every source; `format: {export: 'MM/dd/yyyy HH:mm'}` applies only to that source. Other sources keep ISO parsing. Literal text must be quoted within a format. Explicit Z/±hh:mm offsets are authoritative, including XLSX `t="d"` cells. Naive cells and Excel serials use `sourceTimezones: {export: America/Chicago}`; ambiguous serials require a time zone column or unambiguous text, not a guessed offset.

`report.displayTimezone: America/New_York` changes human displays (default UTC), never parsing. A datetime rule's optional `displayTimezoneField: facility_zone` selects a mapped per-row IANA zone from the reference record for finding values and example charts; retain it in rollup `first`. Invalid/absent display metadata falls back to the report zone. This display-only option cannot repair offset-free input; configure source parsing separately. JSON retains normalized epoch milliseconds.

## Rollups and duplicate identities

```yaml
rollup:
  by: load_id
  sum: [carrier_pay]
  first: [status, delivered_at]
  where: {charge: [linehaul, fuel, detention]}
  duplicates: {by: [load_id, charge]}
```

`by` must match the entity key (including composite keys). Projected `by`, `sum` and `first` fields are disjoint. Every mapped field must be used in projection, filters or duplicate identity. A duplicate identity must include the entity key; add a line ID when multiple legitimate charges share a code.

Money sums are exact bigint; numeric sums use exact decimals. `first` retains the first normalized value including null and reports conflicting later values with physical rows (`rollup_conflict`). Blank money in a sum is uncertain (`rollup_missing_value`), rather than zero. Repeated identities do not add another amount; affected sum fields for the whole key are excluded from certain totals (`rollup_duplicate`). Conflicts make only their dependent fields uncertain, preserving unrelated comparisons.

Without rollup, a duplicate key retains the first row and counts it once in totals. Later rows produce findings and are excluded. All physical rows remain in source counts. Messages distinguish the repeated amount from removal of an entire uncertain rolled-up key.

## Aggregates and reconciliation

```yaml
aggregates:
  - {name: delivered_count, label: Delivered loads, type: count, where: {status: delivered}}
  - {name: total, label: Total carrier pay, type: sum, field: carrier_pay, tolerance: 0}
```

Names are unique within an entity. Count operates on matching unique keys; sum requires a mapped number/money rule. Aggregate predicates accept the common filter grammar. Null sum values add nothing and an empty set sums to zero. Reference sources map every input; partial candidate mappings skip the aggregate explicitly. Failed sources publish no partial totals. Aggregate tolerance is independent of row tolerance (money: integer minor units; count: safe integer; number: finite nonnegative).

Money totals reconcile independently per currency in stable code order. `values` and `reconciliation` retain the configured-currency bucket for compatibility; read `valuesByCurrency` and `reconciliationByCurrency` for every bucket. Raw sum totals, retained/certain totals and actual excluded physical rows are shown when different; raw charge-line counts are not placed next to load counts. Unknown/uncertain amounts remain explicit. Missing/extra rows, value differences, supported patterns and filter-membership moves explain contributions. A remaining amount or uncertain lines keep the total in review. A zero unexplained remainder does not resolve the underlying findings or change `failOn`.

## Failure selection and reports

Default `failOn` is `[missing, extra, mismatch, aggregate, duplicate, invalid]`. Categories select missing_in_source, extra_in_source, field_mismatch, aggregate_mismatch, duplicate_key/duplicate_value and invalid_value. An explicit list omitting `invalid` warns. `[]` or `{}` is report-only for ordinary findings. `failOn: {missing: 2, mismatch: 10}` allows those inclusive counts; a category fails above its limit, and all its findings then block. Counts are per entity across sources.

Exit 0: no blocking findings. Exit 1: blocking findings. Exit 2: source, config, runtime or write error; these cannot be suppressed by `failOn`. Invalid rows produce individual findings up to `maxInvalidRows`; exceeding that limit fails the source. Configuration errors occur before a fresh report is written, so check the exit code instead of relying on an old file.

```yaml
report:
  outputs: [console, html, markdown, json, junit]
  dir: ./logiparity-report
  fileMode: '0640'
  displayTimezone: America/Chicago
```

Defaults are `outputs: [console, json]`, `dir: ./logiparity-report`, `fileMode: '0600'`, `displayTimezone: UTC`. Use a quoted octal string such as `'0640'` or `'0o640'`; unquoted numeric modes are rejected to avoid YAML decimal/octal ambiguity; fileMode allows a shared host group/UID setup in containers. Writers replace complete reports atomically, refuse symlink destinations and apply the requested mode. See [formats](report-formats.md) and the [parity/scenario JSON schemas](report-schema.md). All writers remove unsafe controls and line separators and redact configured secrets. HTML embeds fonts and works offline.

## Environment guard and redaction

`environment: test` is a label, not proof of the environment. Optional `allowedHosts: [localhost, 'staging.example.test:443', '[::1]:5432']` restricts REST, browser and SQL targets before I/O. Hostnames are case-insensitive; host-only entries permit any port, while host:port matches the effective scheme port (80, 443 or 5432 by default). Wildcards, zero/empty ports, socket hosts, schemes and paths are rejected. Mutation-enabled scenario targets require this list.

`${NAME}` interpolation (also through `variables`) treats environment values as secret unless explicitly named in `publicEnv`. Auth/header/connection variables, `secretEnv` and the AI API key are secrets. Basic usernames are public unless explicitly marked. Secret provenance is retained through parsing without serializing it. Normalized URL forms and invisible-character splits are scrubbed too. Values under eight characters warn and are masked as whole values/components to avoid corrupting ordinary text. Redaction is not general PII detection. Keep configuration, cookies, screenshots and internal reports private.

XLSX quotas: 128 MiB per XML entry, 256 KiB text tokens, 32 KiB tags/attributes, 1 MiB accumulated cells, 64 MiB materialized sheet text and 64 MiB shared-string temporary data/index. Decompression over 200:1 after the first MiB fails. Temporary files are removed on completion, errors, exit, SIGINT, SIGTERM and SIGHUP; SIGKILL can prevent cleanup.

## Scenarios and AI

Scenarios have separate schemas and typed `params`, `fixture` and `seconds` placeholders. Fixtures must stay inside the scenario directory tree, including realpaths; move old `../fixtures` layouts under that directory. Artifact downloads default to 64 MiB each (`target.artifacts[].maxBytes`), refuse redirects/symlinks and write atomically. Scenario `report.fileMode` has the same 0600 default. See [scenarios](scenarios.md).

AI settings use a separate version-1 `--ai-config` with `redactFields`, `timeoutMs`, `maxFindings`. Provider URL/model/key use only the three LOGIPARITY_AI variables. Checks and scenarios never invoke AI automatically. See [AI reference](ai.md).
