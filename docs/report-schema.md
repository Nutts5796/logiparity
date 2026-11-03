# JSON report schema, version 1

The root contains `schemaVersion: 1`, `entities`, `findings` and additive `groups`. No timestamps, absolute local filenames on successful comparisons, or random run IDs are added, allowing byte-stable output for the same normalized data/configuration. Source errors describe the observed input location and may naturally vary with row order or environment. Object properties follow configuration order; findings are sorted with binary string ordering by entity, key, field, source, type. Entity summaries sort by entity name.

```json
{
  "schemaVersion": 1,
  "findings": [
    {
      "type": "field_mismatch",
      "entity": "shipment",
      "source": "export",
      "key": "S000001",
      "field": "payout",
      "expected": "101",
      "actual": "100",
      "blocking": true,
      "message": "export: key S000001, field payout differs from reference api; check formatting, rounding and business rules."
    }
  ],
  "entities": [{"entity": "shipment", "reference": "api", "counts": {"api": 2750, "export": 2750}}],
  "groups": [{"entity": "shipment", "source": "export", "field": "payout", "count": 1, "kind": "money_delta", "delta": "-1", "summary": "1 payout value in export differs by exactly -$0.01 (1 cent) (likely rounding)."}]
}
```

Each finding has string fields type, entity, source, key, field and message. expected/actual are optional normalized scalars. Rollup findings may include optional `reason`: `rollup_conflict`, `rollup_missing_value` or `rollup_duplicate`. A missing money input has `actual: null` and no fabricated expected amount; conflict findings contain `values: [{line: 1, value: "delivered"}, {line: 2, value: "cancelled"}]` and omit expected and actual. Intrinsic rollup issues are excluded from pattern grouping. Engine findings include blocking after applying failure policies; older inputs default to blocking. Source errors always block. The UI adapter uses the existing optional screenshot property for relative failure evidence paths; launch/state failures without a page have none.

Money serializes as decimal **integer minor-unit strings**, avoiding JSON number precision loss. Datetimes serialize as UTC epoch milliseconds. Consumers should read the config to interpret currency/types; a numeric-looking string alone does not identify currency.

HTML/Markdown currency equivalents use separate configuration context. They do not change JSON values, units, structure or schemaVersion, and add no display fields to the report.

| Finding type       | Key/field                                   | Meaning                                                                             |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| missing_in_source  | key set, field empty                        | Key exists in the first/reference source but not this source.                       |
| extra_in_source    | key set, field empty                        | Key is absent from the first/reference source.                                      |
| field_mismatch     | key and field set, optional expected/actual | Normalized values exceed tolerance, or a rollup field conflicts/is blank.           |
| duplicate_key      | key and entity key field set                | Repeated key within one source; first record retained.                              |
| source_error       | key and field empty                         | Read/normalization failed; message includes available source/row/key/field details. |
| aggregate_mismatch | key empty, field is aggregate name          | Normalized count/sum differs beyond aggregate tolerance; expected/actual present.   |

`entities[].counts` contains successfully read rows, including duplicates. Failed sources have no count; a failed reference stops comparisons for that entity. No partial comparisons from failed sources are published. Optional `entities[].aggregates` contains `{name, type, values, skippedSources}`: `values` maps source names to numbers or minor-unit strings; `skippedSources` lists sources missing aggregate inputs or containing rollup uncertainty affecting those inputs. Failed sources publish no aggregate values. Aggregates count unique keys and ignore null sum values.

Exit 0 means no blocking findings; exit 1 means blocking ordinary findings, with source errors taking precedence as exit 2. Thresholds apply per entity/category across sources; all findings remain in reports. Schema changes will increment schemaVersion; optional properties may be added within a version. See report-formats.md for HTML/JUnit/Markdown.

For datetime presentation, configured datetime values show epoch milliseconds plus ISO 8601 UTC. Existing Parity JSON retains the same schema and numeric epochs. The separate `scenario.json` envelope uses `schemaVersion: 1`, `kind: scenario`, target/environment, completed event steps, invariant results, optional nested unchanged Parity report, runtime error and exit code; it omits raw snapshots and request bodies. Its format is documented in [scenario reference](scenarios.md).

## Finding groups (additive field)

New Parity JSON includes `groups: []` when no uniform patterns exist. Schema version stays 1; older reports without groups remain readable. Each group has entity, source, field, count, kind and summary. Kinds are datetime_offset, money_delta, value_mapping, missing_stride and extra_stride. Stride groups contain a positive decimal-integer stride string and use an empty field. Offset/delta groups contain a signed decimal-integer delta string, defined as actual minus expected; datetime units are milliseconds and money units are configured minor units. Value mappings contain the normalized expected and actual pair. No individual finding is removed or changes blocking status.

Grouping considers all field mismatches in one entity/source/field bucket. A delta group requires a single nonzero delta across every mismatch and a known datetime or money rule. A value mapping requires the same expected/actual pair across the bucket. Mixed patterns remain individual findings. Summaries describe observed patterns; likely-cause labels are investigation hints. AI explain accepts both old reports and the additive groups field.

Missing/extra groups appear first. They require runs of at least three keys sharing a prefix and a uniform numeric suffix stride greater than one. Runs do not overlap; irregular or contiguous keys remain individual findings. Their page-boundary label is a heuristic.

Warnings are an optional `warnings` array of objects with `message` and optional `entity` and `source`. They are observations about configuration or completeness, not ordinary findings, and do not change failure thresholds or the exit code. Every report format displays them.

Stride groups include their explained `keys`. A missing final reference key can join a regular page-boundary run when it lies after the last periodic key and before the next expected boundary. Its summary names the final key explicitly. Console and Markdown show unexplained findings before explained findings when truncating the list. JSON retains deterministic finding order and every finding.

The rounding hint is limited to absolute money deltas of at most three configured minor units. Larger uniform deltas are labelled "consistent fixed difference". A constant delta establishes an observed pattern, not its cause.

Conflict line numbers are one-based extracted data-row numbers; file header rows are not counted.
