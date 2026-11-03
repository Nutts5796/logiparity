# Freight settlement reconciliation

This is a synthetic closed day of 40 loads: 149 rate confirmation charge lines and 151 posted settlement lines. One additional void row is filtered out. No production data is included.

From a project with LogiParity installed:

```sh
cp -R node_modules/logiparity/examples/freight ./freight-example
npx logiparity validate --config freight-example/parity.yaml
npx logiparity check --config freight-example/parity.yaml
```

From a checkout:

```sh
npm ci
npm run build
node packages/cli/dist/main.js validate --config examples/freight/parity.yaml
node packages/cli/dist/main.js check --config examples/freight/parity.yaml
```

Expected: validation exits 0; the check exits 1 because the fixture includes intentional defects. Open `freight-example/logiparity-report/report.html` (or `examples/freight/logiparity-report/report.html` in a checkout).

The load comparison sums 151 settlement rows into 40 load keys, against 40 TMS totals. Its non-key uniqueness check finds tender T9006 on L106 and L107 and reports the amount paid more than once. The charge comparison uses `[load_id, charge]` to distinguish each accessorial. L102's $15 detention is absent from its rate confirmation and stays an individual finding. It must not become a rounding pattern.

Other intentional defects are a repeated fuel row on L103, a blank fuel amount on L104 and a conflicting status on L105. Duplicate identities are excluded before summing. Uncertain loads are listed separately while certain loads still reconcile. Source `where` excludes void rows; rollup `where` accepts only the listed charge types. Row numbers count the CSV header.

Reports are generated locally and are excluded from the published package. For staging data, export and query at the same cutoff time, or reconcile a closed day. Extend the duplicate identity with a line identifier if a load can legitimately have several lines for one charge type.
