# Generic record comparison

Copy this directory from the installed package to a writable project directory, then run `logiparity validate --config parity.yaml` and `logiparity check --config parity.yaml`. These synthetic records demonstrate keyed matching, strict money, enum and calendar-date rules. This example does not start a service or require UI/SQL peers.

The intended difference is record R2: amount 20.00 versus 20.01 USD. Its expected exit code is 1. Row order is intentionally different. The field is mapped explicitly in both sources; the example never ignores an unmatched column.

Try `logiparity suggest --source reference=reference.csv --source candidate=candidate.csv --output draft.yaml`. The command writes a separate, intentionally blocked draft for review. Compare it with parity.yaml, confirm every field/key/type/currency, and remove the TODO marker only when resolved. Existing files are not overwritten. See the [setup recipe](../../docs/recipes/suggest.md).

The [delivery demo](../demo/) and [freight settlement](../freight/) are logistics example packs using this same engine; their published paths are unchanged.
