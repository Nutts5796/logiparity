# Freight settlement lines

This synthetic closed-day example compares three TMS load totals with nine carrier settlement lines. Each load has linehaul, fuel and detention charges. Both exports describe the closed day of 2026-11-01.

From the repository root after installing and building:

```sh
./node_modules/.bin/logiparity validate --config examples/freight/parity.yaml
./node_modules/.bin/logiparity check --config examples/freight/parity.yaml
```

Expected: exit 0 and zero findings. Open `output/freight-report/report.html`. JSON counts show three TMS rows and nine settlement rows; the comparison uses three rolled-up load keys in each source.

The settlement source declares `rollup: {by: load_id, sum: [carrier_pay], first: [status, delivered_at]}`. Amounts normalize to integer USD cents before summing. Repeated load IDs in this source are expected. Without rollup, repeated keys remain duplicate findings. The Charge column explains each synthetic line and is not mapped into the comparison.

`by` must match the entity key. Every mapped field belongs to by, sum or first, with no overlap. Sum fields require number or money rules; nulls contribute zero. Numeric sums use exact decimal accumulation, and money uses bigint. `first` retains the first normalized value in input order, including null; use it only for fields where this is your intended contract. It does not verify agreement between lines. Normalization errors still fail the entire source.

Change L001's detention from 50.25 to 50.24 to see a one-cent payout finding and exit 1. Restore the fixture afterwards. For live staging data, export and query at the same cutoff, or compare a closed day so an in-flight update does not look like a parity defect.
