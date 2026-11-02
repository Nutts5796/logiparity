# Freight settlement lines

This synthetic closed-day example compares three TMS load totals with nine carrier settlement lines. Each load has linehaul, fuel and detention charges. Both exports describe the closed day of 2026-11-01.

From the repository root after installing and building:

```sh
./node_modules/.bin/logiparity validate --config examples/freight/parity.yaml
./node_modules/.bin/logiparity check --config examples/freight/parity.yaml
```

Expected: exit 0 and zero findings. Open `output/freight-report/report.html`. JSON counts show three TMS rows and nine settlement rows; the comparison uses three rolled-up load keys in each source.

The settlement source sums `carrier_pay` by `load_id`, checks agreement on the `first` fields `status` and `delivered_at`, and declares `duplicates: {by: [load_id, charge]}`. Amounts normalize to integer USD cents before summing. Repeated load IDs are expected; repeated load/charge pairs in this fixture are duplicate findings and are excluded before summing. `charge` identifies a line and is not projected into the load total. If real data permits multiple lines of one charge type, add a line identifier to `duplicates.by`.

`by` must match the entity key. Projected fields belong to by, sum or first with no overlap; duplicate identity fields must be mapped and include the key. Money uses bigint; numeric sums use exact decimal accumulation. Blank money or conflicting first values produce findings. Comparisons for uncertain fields and aggregates depending on them are skipped, so a duplicate fuel line is not presented as rounding. Blank numeric sums still contribute zero; normalization errors fail the entire source. See the [rollup reference](../../docs/configuration.md#per-key-rollups).

Change L001's detention from 50.25 to 50.24 to see a one-cent payout finding and exit 1. Restore the fixture afterwards. For live staging data, export and query at the same cutoff, or compare a closed day so an in-flight update does not look like a parity defect.
