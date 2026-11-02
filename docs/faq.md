# Frequently asked questions

**Can I use production data or inject production events?** Use only test/staging targets and synthetic or appropriately controlled test data. Environment declarations do not identify a production hostname. Scenario mutations require explicit allowMutations and have no rollback.

**What is compared?** The first source in an entity is the reference; other sources are joined by the canonical key. Missing/extra records, duplicate keys, scalar mismatches and configured aggregates become findings. Duplicate keys contribute the first row once. Source failures exit 2 and suppress misleading incomplete comparisons.

**Why did a one-cent difference appear?** Monetary inputs must be decimal strings, not floating-point numbers. Normalization converts to exact bigint minor units; tolerance is an integer in those units. The intentionally buggy demo export rounds some values incorrectly. HTML/Markdown show both minor units and configured currency equivalents; JSON keeps exact minor-unit strings.

**Why show both epoch milliseconds and UTC text?** Normalized JSON retains numeric UTC epoch milliseconds for consumers. HTML/Markdown add ISO 8601 UTC from the field's comparison rule, preserving nonzero milliseconds. Numeric fields are not guessed to be dates. Set source timezones explicitly for offsetless timestamps; do not reinterpret the injected timezone bug to hide it.

**Why can all sources agree while a scenario fails?** An order can disappear from every surface or be assigned twice in independent assignment records. Domain invariants compare baseline and final state; post-scenario Parity independently checks the final surfaces. Both results remain visible.

**Why do UI reads fail after restarting the demo?** Restarting invalidates synthetic login sessions. Repeat demo:login and export again. Configure storageState, table/rows/field selectors, readiness, pagination and allowed origins. Virtualized tables, service workers and WebSockets are unsupported by the snapshot adapter. Failure screenshots can contain visible test data.

**Can SQL modify data?** The adapter validates a restricted SELECT grammar before connecting and uses a READ ONLY transaction. Use a dedicated read-only staging role; privileged side effects hidden in database objects are outside a universal sandbox guarantee. Development fixture setup is restricted to disposable loopback databases and is not packaged as the read adapter.

**Does it send data to AI by default?** No. Normal checks/scenarios never invoke AI. AI commands default to a local payload preview; --send and all three provider variables are required. Structured redaction is not general PII detection. Outputs are new marked drafts and never execute automatically; see [AI reference](ai.md).

**How large can datasets be?** Functional checks cover 100,000 records per source for the engine and streaming adapters. Memory also depends on indexed records, mapped fields, XLSX shared strings and findings. Browser/scenario throughput is not benchmarked. No cross-machine timing guarantee is claimed.

**Do I need PostgreSQL/Chromium to try the quickstart?** The API/CSV/XLSX quickstart needs Node/npm only. Chromium is needed for UI sources, and a database for SQL sources. The complete contributor suite additionally needs xmllint and disposable PostgreSQL fixtures.

**Why is the npm tarball larger than the TypeScript sources?** It includes the private compiled workspaces and their exact locked runtime dependencies/licenses. Installing it does not fetch private @logiparity packages or download browsers. Chromium is installed separately for UI, or comes in the Docker image. First-party tests, auth state and generated reports/exports are excluded.

**How do I install before npm publication?** Use the [versioned GitHub release tarball](https://github.com/Nutts5796/logiparity/releases/download/v1.0.0/logiparity-1.0.0.tgz) once attached, or build a local tarball from source. The source quickstart works without a registry package. `npm install logiparity@1.0.0` is the future registry option. See the [release guide](release.md).
