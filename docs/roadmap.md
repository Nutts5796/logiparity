# Roadmap

Current focus is reliable first-use workflows: pagination completeness, actionable report summaries, numeric API money and small staging scenarios.

Next areas to explore:

- Additional export producers, workbook formats and localization fixtures.
- Clearer readiness contracts for asynchronous browser tables.
- More logistics examples with independently verified invariant state.
- Broader container-platform checks and dependency maintenance.

## Starter issues

| Task                                                                    | Suggested label  |
| ----------------------------------------------------------------------- | ---------------- |
| Document a second CSV mapping with localized decimal strings            | good first issue |
| Add regression fixtures for workbook cell types and alternate producers | help wanted      |
| Add a custom adapter example using synthetic records                    | good first issue |
| Improve console examples for missing and duplicate keys                 | good first issue |
| Extend locale fixtures to additional numeral and grouping systems       | help wanted      |

## Shipped in 1.1.0

- Composite keys and a where filter on rollup lines, allowing settlement comparisons per charge line.
- Uniqueness checks on fields other than the join key, such as one shipper PO appearing under two load IDs.
- An affected_reassigned invariant that verifies reassignment after a disruption.
- A scenario validate command for mutation-free preflight.
- Optional Playwright and PostgreSQL adapters through optional or peer dependencies, keeping a CSV and REST installation small.
