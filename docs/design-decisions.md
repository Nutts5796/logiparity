# Design decisions

## Keyed parity across sources

Every comparison matches the same record by key in each configured source and reports what is missing, extra or different. Built-in scenario invariants such as `no_order_lost` apply the same idea after a disruption.

Origin: Before I moved into QA, I ran transport logistics for a delivery service with 50-60 drivers. Every order had to match across four places: the waybill a driver loaded from in the morning, the status the driver set in the mobile app, the record in our system, and the returns that a warehouse employee checked against the waybill when the driver came back. If an item was in one place and missing in another, the driver was fined for the lost item. We did this reconciliation by hand every day. LogiParity automates the same idea.

## Money as integer minor units

Binary floating-point arithmetic can introduce fractional artifacts when comparing or summing monetary values. Normalization converts decimal text into bigint minor units using the configured currency's fraction digits. Tolerances use those same integer units. Numeric API inputs require explicit opt-in because parsing a JSON number may already lose decimal precision.

Origin: As a QA engineer on a FinTech platform, I found that our income and accrual statistics did not match the accountant's figures. Two things were wrong. The formulas rounded intermediate values with ordinary half-up rounding, and the code applied a fixed standard percentage for each of the five client tariffs, while the accountant adjusted the percentage whenever the business changed its terms. I traced both causes, and the developers fixed them quickly. Since then I treat rounding as a business rule, not a formatting detail, so LogiParity compares money as exact integer minor units and rejects values with extra decimal places instead of rounding them.

## Refusing to guess timezones

An offsetless wall clock does not identify an instant. A source timezone must be configured; ambiguous daylight-saving times and gaps fail. Explicit offsets and zones let the same instant compare consistently across machines.

Origin: On every project I worked on, the timezone of a timestamp was a question I had to confirm with the product owner, the customer or the team lead. The right answer depends on the business, not on the code. So LogiParity never guesses: a timestamp without an offset is an error until the configuration states which timezone that source uses.

## First source as reference

Configuration order defines the reference dataset. This gives missing and extra records an explicit direction without inferring which business system is authoritative. A failed reference stops comparisons for that entity.

Origin: In the delivery service the waybill was the reference: returns were checked against it, not the other way round. Which system is authoritative is a business decision, so the configuration states it explicitly.

## Failing on short pages

A short first page can mean a complete small result or an undocumented server page-size cap. Comparing an incomplete dataset can wrongly blame another source. Page and offset sources therefore require completion metadata for short first pages, with an explicit `allowShortFirstPage` opt-out for APIs without it.

## Grouping heuristics

Groups summarize observed uniform differences while preserving every finding and its blocking status. Constant deltas or value mappings use all mismatches in an entity, source and field bucket. Missing and extra groups require a run of at least three keys with the same prefix and a constant numeric stride greater than one. Outliers, such as a final partial-page key, remain individual findings. Likely-cause labels suggest an investigation; snapshot and producer behavior determine the actual cause.

## Read-only SQL

Query parsing rejects writes, row locks and functions outside the documented allowlist before connecting. Queries then run in a read-only transaction using a dedicated SELECT-only role. Both controls reduce unintended changes when checking staging data; database permissions remain necessary for views and functions defined by the database.
