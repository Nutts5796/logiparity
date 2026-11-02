# JSON report schema, version 1 (M1)

The root contains `schemaVersion: 1`, `entities` and `findings`. No timestamps, absolute local filenames on successful comparisons, or random run IDs are added, allowing byte-stable output for the same normalized data/configuration. Source errors describe the observed input location and may naturally vary with row order or environment. Object properties follow configuration order; findings are sorted with binary string ordering by entity, key, field, source, type. Entity summaries sort by entity name.

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
      "message": "export: key S000001, field payout differs from reference api; check formatting, rounding and business rules."
    }
  ],
  "entities": [{"entity": "shipment", "reference": "api", "counts": {"api": 2750, "export": 2750}}]
}
```

Each finding has string fields `type`, `entity`, `source`, `key`, `field`, and `message`. `expected` and `actual` are optional normalized scalar values. Money values serialize as decimal **integer minor-unit strings**, avoiding JSON number precision loss. Datetimes serialize as UTC epoch milliseconds. Consumers should read the config to interpret currency and normalization types; a numeric-looking string is not sufficient to infer currency.

| Finding type | Key/field | Meaning |
| --- | --- | --- |
| missing_in_source | key set, field empty | Key exists in the first/reference source but not this source. |
| extra_in_source | key set, field empty | Key is absent from the first/reference source. |
| field_mismatch | key and field set, expected/actual present | Normalized values exceed tolerance. |
| duplicate_key | key and entity key field set | Repeated key within one source; first record retained. |
| source_error | key and field empty | Read/normalization failed; message includes available source/row/key/field details. |
| aggregate_mismatch | Reserved | Aggregate reporting begins in M2; M1 never emits this type. |

`entities[].counts` contains total successfully read rows (including duplicates). Failed sources have no count; a failed reference stops comparisons for that entity. No partial comparisons from a failed source are published. All findings cause exit 1, with source errors taking precedence as exit 2. JSON schema changes will increment schemaVersion; new optional properties can be added within a version. HTML, JUnit and Markdown formats begin in M2.
