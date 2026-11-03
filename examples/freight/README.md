# Freight settlement reconciliation

This static synthetic carrier-settlement fixture has 120 loads, 358 confirmed charge lines and 361 settlement rows including a filtered void row. It includes multiple U.S. zones and both explicit offsets of the 2026 fall-back overlap. No production data is included.

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
npx logiparity validate --config examples/freight/parity.yaml
npx logiparity check --config examples/freight/parity.yaml
```

Expected: validation exits 0; the check exits 1 because the fixture includes intentional defects. Open `freight-example/logiparity-report/report.html` (or `examples/freight/logiparity-report/report.html` in a checkout).

The load comparison rolls up settlement charge lines against TMS totals. Tender T9006 appears on L106 and L107 because L107 has a tender typo; that alone is not evidence of a duplicate payment. The charge comparison uses composite load/charge keys. L102 has an unconfirmed $15 detention line at charge level and a +$15 carrier-pay difference at load level, traced into totals. TONU loads L144, L155 and L166 are cancelled and contain only a TONU charge; L155 has the intentional missing $250 TONU; L150 has an extra $35 stop charge. Accessorials include varied detention, lumper, layover and claim amounts. Each load maps its facility IANA zone for human datetime displays; JSON keeps UTC epoch milliseconds. Explicit charge value maps preserve TONU/STP and readable Fuel/Linehaul keys.

Other intentional defects are a repeated fuel row on L103, a blank fuel amount on L104 and a conflicting status on L105. Duplicate identities are excluded before summing. Uncertain loads are listed separately while certain loads still reconcile. Source `where` excludes void rows; rollup `where` accepts only the listed charge types. Row numbers count the CSV header.

Reports are generated locally and are excluded from the published package. For staging data, export and query at the same cutoff time, or reconcile a closed day. Extend the duplicate identity with a line identifier if a load can legitimately have several lines for one charge type.
