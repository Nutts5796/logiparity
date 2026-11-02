# Synthetic demo bug switches

All records are synthetic. Never connect this application to production data or systems. The demo exposes API/exports, dispatcher login, operational events, a replan trigger/status and a virtual clock. The default snapshot starts at 14:00 UTC; each shipped scenario resets a synthetic operations fixture at 08:00 UTC.

| Flag (`1` enables) | Behavior | Evidence |
| --- | --- | --- |
| `BUG_EXPORT_DROPS_LAST_ROW` | Drops the final XLSX record in every export page of up to 200 rows, including the final partial page. CSV remains complete. | Missing `S000200`, `S000400`, …, `S002600`, `S002750`: 14 findings. |
| `BUG_ROUNDING_PAYOUT` | Uses intentionally wrong floating-point half-up rounding on decimal payout bases in CSV and XLSX. | `S000001`: expected `1.01`, actual `1.00`. There are 142 affected orders per format. |
| `BUG_STATUS_STALE_UI` | UI shows In transit for orders delivered in the last ten minutes of the virtual snapshot. API/exports remain current. | 315 field mismatches with exact keys, starting at S000051; UI delivered_count is 1518 instead of 1833. |
| `BUG_TZ_SHIFT_EXPORT` | CSV/XLSX delivered_at and ETA write America/Chicago local wall time without an offset, violating their UTC serialization contract. | UTC-configured export readers see a six-hour shift on 1833 delivered orders per complete export. |
| `BUG_REPLAN_LOSES_ORDER` | Drops the first affected order after a breakdown replan. | Breakdown scenario: no_order_lost fails for S000801. |
| `BUG_DOUBLE_ASSIGN` | Adds a second assignment after a breakdown replan. | single_assignment fails for S000801, or S000802 when the lost-order bug is also on. |

`npm run demo` leaves flags off unless set in the environment. `npm run demo:bugs` enables all six bugs. For isolated reproduction:

```sh
BUG_EXPORT_DROPS_LAST_ROW=1 npm run demo
# Or:
BUG_ROUNDING_PAYOUT=1 npm run demo
# Or the dispatcher and timezone bugs:
BUG_STATUS_STALE_UI=1 npm run demo
BUG_TZ_SHIFT_EXPORT=1 npm run demo
```

Restarting reseeds all data deterministically. Fetch exports again after each restart. API order IDs are `S000001` through `S002750`, driver IDs `D01` through `D55`, vehicle IDs `V01` through `V55`. Every route initially has 50 orders. The normal payout path uses integer arithmetic; floating-point payout arithmetic exists only in the deliberately broken export path.

For the UI example, also repeat `npm run demo:login`: restart invalidates its server-side session. Use examples/demo/parity-ui.yaml with DEMO_API_URL and DEMO_UI_URL set to the local server origin. It reports 4273 findings with all six bugs on before scenario execution (14 missing, 4255 field and 4 aggregate mismatches), or zero with bugs off. The API/file-only parity.yaml reports 3957 findings with all bugs on because it does not read UI statuses.

Both configs declare UTC for offsetless export values because the export contract is UTC. Reinterpreting the broken wall clocks as America/Chicago would recover their instant and hide this serialization defect; it would not repair the exported contract. Normal exports carry explicit UTC offsets. The fixed date 2026-11-02 is six hours behind UTC in Chicago; another selected date may use daylight-saving rules.

## Operations

`BUG_REPLAN_LOSES_ORDER=1 npm run demo` and `BUG_DOUBLE_ASSIGN=1 npm run demo` enable the replan defects independently. They have no effect before a breakdown scenario. Use the command in [scenario reference](../../docs/scenarios.md); with both defects off all five examples pass.

POST endpoints require `x-logiparity-environment: test` and a JSON object, bounded to 64 KiB: `/api/test/reset`, `/api/events/driver-no-show`, `/api/events/vehicle-breakdown`, `/api/events/traffic-delay`, `/api/events/order-cancel`, `/api/events/capacity-change`, `/api/replan`, `/api/clock/advance`. GET `/api/state` returns the singleton status/clock; `/api/assignments` exposes independent assignment records. GET collections retain pagination/detail support. Event `at` is UTC HH:mm or a UTC ISO instant and cannot move the clock backwards. Clock advances take positive seconds up to 3600; a pending replan completes after two virtual seconds.

The recipe fixture sets 55 drivers, 50 active orders per driver and capacity 60. Replanning reserves unaffected assignments, redistributes affected orders deterministically to available capacity, updates ETAs and records synthetic notifications. Cancelled orders stay in the API with no assignment and zero payout. The planner is a small synthetic demonstration; it does not optimize real routes. If capacity is insufficient, invariants report unassigned orders.

Scenario state and exports change in memory. The server updates the dispatcher and regenerates exports from the current state; resetting retains the data object's identity used by UI sessions. Run scenarios serially against a shared instance. Fetch the usual demo exports again after resetting/replanning if using the standalone Parity configs.
