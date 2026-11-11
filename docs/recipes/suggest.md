# Draft a configuration from local samples

Save small samples from each source before starting. `suggest` accepts 2–8 named local CSV/TSV, XLSX and JSON files. It never makes an API request, invokes AI or runs a comparison.

```sh
npx logiparity suggest \
  --source reference=reference.csv \
  --source export=export.xlsx \
  --sheet export=Records \
  --source api=saved-response.json \
  --items 'api=$.data[*]' \
  --sample-rows 200 \
  --output new-parity.yaml
```

Omit `--output` to print YAML to stdout. A named output must be new; it is created privately and never overwritten. Paths in the draft resolve relative to that output file. Quote source/path assignments when paths contain spaces. XLSX needs an explicit sheet. JSON defaults to a root array or `data` array; other envelopes need the supported JSONPath subset through `--items`.

Review candidate keys, every matched/unmatched field and each evidence comment. The normalizer matches case/camel-case/space/underscore variants and a small alias list, such as record_id/id, cust_id/customer_id, total_amount/amount and status_code/status. This is a proposal, not proof that definitions agree. Ambiguous normalized headers fail instead of silently choosing a column. Every sampled column remains mapped; unmatched counterparts have explicit TODO paths.

The draft intentionally fails validation: `TODO_REVIEW_REQUIRED` is not a supported configuration property and the key is unresolved. Money currency/units, naive timestamp zones and REST endpoints also remain TODOs. Resolve every item before removing the marker. There is no accept-all option. For saved JSON, the draft describes a future REST source; configure its real test/staging origin/path, pagination and omitted-property policy. JSON-file comparison is not a new source adapter.

Type comments report nonempty counts and why number, money, date, datetime, enum or text was proposed. Inference cannot prove currency or major/minor units; integer cents require a deliberate conversion before major-unit money parsing. Numeric JSON/Excel money requires an explicit allowNumber decision. Comma grouping/dot decimals are a hypothesis; alternate locales, invalid dates, case variants, blank/complex columns and date order need review. No type guess weakens strict parsing or enables case/whitespace folding.

The default is 200 records per sample, configurable from 1 to 1,000, at most 8 MiB per input and 200 columns. A truncated sample is labelled. JSON is bounded before parsing; XLSX uses the existing guarded reader. Uniqueness in a sample is not uniqueness of a whole dataset, and fields absent outside the sample are not discovered. Check the full source schema separately. No sample values are printed into comments, but headers/paths can still contain sensitive identifiers.

After review:

```sh
npx logiparity validate --config new-parity.yaml
npx logiparity check --config new-parity.yaml
```

A ready-made local starting point is the [generic example](../../examples/generic/README.md). [Setup-time protocol](../evaluation/setup-time.md) is intentionally unfilled; owner stopwatch measurements are needed before claiming a speedup.
