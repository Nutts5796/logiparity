# Freight settlement reconciliation

This static synthetic carrier-settlement fixture has 120 loads, 377 confirmed charge lines and 380 settlement rows including a filtered void row. It includes multiple U.S. zones and both explicit offsets of the 2026 fall-back overlap. No production data is included.

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

The load comparison rolls up settlement charge lines against TMS totals. Tender T9006 appears on L106 and L107 because L107 has a tender typo; that alone is not evidence of a duplicate payment. The charge comparison uses composite load/charge keys. The individual $15 L102 detention difference remains a listed value difference, with its contribution traced into totals. L155 has a missing $250 TONU; L150 has an extra $35 stop charge. Accessorials also include lumper fees, layovers and claim deductions.

Other intentional defects are a repeated fuel row on L103, a blank fuel amount on L104 and a conflicting status on L105. Duplicate identities are excluded before summing. Uncertain loads are listed separately while certain loads still reconcile. Source `where` excludes void rows; rollup `where` accepts only the listed charge types. Row numbers count the CSV header.

Reports are generated locally and are excluded from the published package. For staging data, export and query at the same cutoff time, or reconcile a closed day. Extend the duplicate identity with a line identifier if a load can legitimately have several lines for one charge type.
