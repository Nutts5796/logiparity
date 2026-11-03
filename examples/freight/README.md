# Freight settlement lines

This synthetic closed-day example compares three TMS load totals with nine carrier settlement lines. Each load has linehaul, fuel and detention charges. Both exports describe the closed day of 2026-11-01.

From a source checkout after installing and building:

```sh
./node_modules/.bin/logiparity validate --config examples/freight/parity.yaml
./node_modules/.bin/logiparity check --config examples/freight/parity.yaml
```

From a project with LogiParity installed through npm, copy the packaged example into your own folder first:

```sh
cp -R node_modules/logiparity/examples/freight ./freight-example
./node_modules/.bin/logiparity validate --config freight-example/parity.yaml
./node_modules/.bin/logiparity check --config freight-example/parity.yaml
```

Expected: exit 0 and zero findings. Reports are written under the example's own `logiparity-report/` directory. JSON counts show three TMS rows and nine settlement rows; comparison uses three rolled-up load keys in each source.

The settlement source sums `carrier_pay` by `load_id`, checks agreement on `status` and `delivered_at`, and declares `duplicates: {by: [load_id, charge]}`. Repeated load IDs are expected; repeated load and charge pairs are duplicate findings and are excluded before summing. If real data permits several lines for one charge type, add a line identifier to the duplicate identity.

Money uses exact integer minor units. Blank money or conflicting first values produce findings. Comparisons and aggregates that depend on uncertain values are skipped. Duplicate messages state the amount excluded. Change L001's detention from 50.25 to 50.24 to see a one-cent finding. Restore the fixture afterwards. For staging data, export and query at the same cutoff time or compare a closed day.
