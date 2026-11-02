# Synthetic demo bug switches

All records are synthetic. Never connect this application to production data or systems. M3 exposes the read-only API, daily exports and a dispatcher UI/login. Operational event injection remains M4 work. The data snapshot is fixed at 14:00 UTC on the selected synthetic date; there is no virtual-clock control endpoint yet.

| Flag (`1` enables) | Behavior | Evidence |
| --- | --- | --- |
| `BUG_EXPORT_DROPS_LAST_ROW` | Drops the final XLSX record in every export page of up to 200 rows, including the final partial page. CSV remains complete. | Missing `S000200`, `S000400`, …, `S002600`, `S002750`: 14 findings. |
| `BUG_ROUNDING_PAYOUT` | Uses intentionally wrong floating-point half-up rounding on decimal payout bases in CSV and XLSX. | `S000001`: expected `1.01`, actual `1.00`. There are 142 affected orders per format. |
| `BUG_STATUS_STALE_UI` | UI shows In transit for orders delivered in the last ten minutes of the fixed snapshot. API/exports remain current. | 315 field mismatches with exact keys, starting at S000051; UI delivered_count is 1518 instead of 1833. |
| `BUG_TZ_SHIFT_EXPORT` | CSV/XLSX write America/Chicago local wall time without an offset, violating their UTC serialization contract. | UTC-configured export readers see a six-hour shift on 1833 delivered orders per complete export. |
| `BUG_REPLAN_LOSES_ORDER` | Planned for M4; no effect in M1. | No re-plan/event endpoint yet. |
| `BUG_DOUBLE_ASSIGN` | Planned for M4; no effect in M1. | No re-plan/event endpoint yet. |

`npm run demo` leaves flags off unless set in the environment. `npm run demo:bugs` enables all four implemented bugs. For isolated reproduction:

```sh
BUG_EXPORT_DROPS_LAST_ROW=1 npm run demo
# Or:
BUG_ROUNDING_PAYOUT=1 npm run demo
# Or the M3 bugs:
BUG_STATUS_STALE_UI=1 npm run demo
BUG_TZ_SHIFT_EXPORT=1 npm run demo
```

Restarting reseeds all data deterministically. Fetch exports again after each restart. API order IDs are `S000001` through `S002750`, driver IDs `D01` through `D55`, vehicle IDs `V01` through `V55`. Every route initially has 50 orders. The normal payout path uses integer arithmetic; floating-point payout arithmetic exists only in the deliberately broken export path.

For the UI example, also repeat `npm run demo:login`: restart invalidates its server-side session. Use examples/demo/parity-ui.yaml with DEMO_API_URL and DEMO_UI_URL set to the local server origin. It reports 4273 findings with all four bugs on (14 missing, 4255 field and 4 aggregate mismatches), or zero with bugs off. The API/file-only parity.yaml reports 3957 findings with all bugs on because it does not read UI statuses.

Both configs declare UTC for offsetless export values because the export contract is UTC. Reinterpreting the broken wall clocks as America/Chicago would recover their instant and hide this serialization defect; it would not repair the exported contract. Normal exports carry explicit UTC offsets. The fixed date 2026-11-02 is six hours behind UTC in Chicago; another selected date may use daylight-saving rules.
