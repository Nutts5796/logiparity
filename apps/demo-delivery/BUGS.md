# Synthetic demo bug switches

All records are generated for demonstration and tests. Never connect this application to production data or systems. M1 exposes a read-only API and daily shipment/payout exports; event injection and UI arrive later.

| Flag (`1` enables) | M1 behavior | Evidence |
| --- | --- | --- |
| `BUG_EXPORT_DROPS_LAST_ROW` | Drops the final XLSX record in every export page of up to 200 rows, including the final partial page. CSV remains complete. | Missing `S000200`, `S000400`, …, `S002600`, `S002750`: 14 findings. |
| `BUG_ROUNDING_PAYOUT` | Uses intentionally wrong floating-point half-up rounding on decimal payout bases in CSV and XLSX. | `S000001`: expected `1.01`, actual `1.00`. There are 142 affected orders per format. |
| `BUG_STATUS_STALE_UI` | Planned for M3; no effect in M1. | No dispatcher UI yet. |
| `BUG_TZ_SHIFT_EXPORT` | Planned for M3; no effect in M1. | M1 exports explicit UTC offsets. |
| `BUG_REPLAN_LOSES_ORDER` | Planned for M4; no effect in M1. | No re-plan/event endpoint yet. |
| `BUG_DOUBLE_ASSIGN` | Planned for M4; no effect in M1. | No re-plan/event endpoint yet. |

`npm run demo` leaves M1 flags off unless explicitly set in the environment. `npm run demo:bugs` enables both implemented M1 bugs. For isolated reproduction:

```sh
BUG_EXPORT_DROPS_LAST_ROW=1 npm run demo
# Or:
BUG_ROUNDING_PAYOUT=1 npm run demo
```

Restarting reseeds all data deterministically. Fetch exports again after each restart. API order IDs are `S000001` through `S002750`, driver IDs `D01` through `D55`, vehicle IDs `V01` through `V55`. Every route initially has 50 orders. The normal payout path uses integer arithmetic; floating-point payout arithmetic exists only in the deliberately broken export path.
