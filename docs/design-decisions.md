# Design decisions

## Money as integer minor units

Binary floating-point arithmetic can introduce fractional artifacts when comparing or summing monetary values. Normalization converts decimal text into bigint minor units using the configured currency's fraction digits. Tolerances use those same integer units. Numeric API inputs require explicit opt-in because parsing a JSON number may already lose decimal precision.

Origin: [author to fill in from real experience]

## Refusing to guess timezones

An offsetless wall clock does not identify an instant. A source timezone must be configured; ambiguous daylight-saving times and gaps fail. Explicit offsets and zones let the same instant compare consistently across machines.

Origin: [author to fill in from real experience]

## First source as reference

Configuration order defines the reference dataset. This gives missing and extra records an explicit direction without inferring which business system is authoritative. A failed reference stops comparisons for that entity.

Origin: [author to fill in from real experience]

## Failing on short pages

A short first page can mean a complete small result or an undocumented server page-size cap. Comparing an incomplete dataset can wrongly blame another source. Page and offset sources therefore require completion metadata for short first pages, with an explicit allowShortFirstPage opt-out for APIs without it.

Origin: [author to fill in from real experience]

## Grouping heuristics

Groups summarize observed uniform differences while preserving every finding and its blocking status. Constant deltas or value mappings use all mismatches in an entity/source/field bucket. Missing and extra groups require a run of at least three keys with the same prefix and a constant numeric stride greater than one. Outliers, such as a final partial-page key, remain individual findings. Likely-cause labels suggest an investigation; snapshot and producer behavior determine the actual cause.

Origin: [author to fill in from real experience]

## Read-only SQL

Query parsing rejects writes, row locks and functions outside the documented allowlist before connecting. Queries then run in a read-only transaction using a dedicated SELECT-only role. Both controls reduce unintended changes when checking staging data; database permissions remain necessary for views and functions defined by the database.

Origin: [author to fill in from real experience]
