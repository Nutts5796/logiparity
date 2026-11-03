# Synthetic delivery demo

The demo creates 55 drivers and 2,750 orders for a fixed day. Every record is synthetic. Driver payouts range from about $18 to $45 per stop. The correct payout uses integer half-up rounding from the synthetic decimal basis; the optional bug uses floating-point arithmetic.

From the repository root, run `DEMO_PORT=3010 npm run demo` for healthy data or `DEMO_PORT=3010 npm run demo:bugs` to enable all six defects:

1. Missing XLSX rows at page boundaries and at the end of the last page.
2. Incorrect payout rounding in CSV and XLSX exports.
3. Stale statuses in the dispatcher screen.
4. Export datetimes shifted by six hours.
5. An order lost when replanning after a disruption.
6. A duplicate order assignment after replanning.

The startup log lists each enabled defect by name. The first four concern data surfaces; dispatcher staleness requires the UI configuration. The last two require scenario invariants to expose operational failures. A parity report alone does not exercise every scenario defect. See [bug switches](BUGS.md) and the main [quickstart](../../README.md#quickstart).
