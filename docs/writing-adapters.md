# Writing adapters

The shared [Adapter interface](../packages/core/src/types.ts) exposes `read(config, context): AsyncIterable<DataRow>`. A DataRow is a field-to-scalar mapping using the logical entity field names, including its join key. The context supplies the config directory and environment. An adapter must use only user-configured test/staging targets; read operations must not mutate the target.

Implement an async generator, map external fields to logical names, and yield one row at a time. Preserve decimal text for monetary fields and dates as ISO strings with offsets or Date values. Do not silently skip unreadable rows, missing mapped fields or failed pages. Throw an actionable error with file/line or page/record context; the engine adds entity/source/key/field context and generates `source_error` instead of misleading missing records after partial reads.

Add a discriminated source variant to the strict Zod source schema, wire it in `packages/adapters/src/index.ts`, and test fixtures, empty data, malformed input and a source failure after partial reading. Release resources in a `finally` block so cancellation also closes files and streams. Never log auth values, request headers or complete error response bodies.

For streaming sources, memory should track a page or parser buffer rather than the complete source. The comparison engine currently indexes the reference and one candidate source in memory. Do not add network calls outside the configured target or telemetry. Pin and document each runtime dependency and review the transitive license inventory.

The UI and PostgreSQL variants are planned for M3. Playwright integration tests will accompany the UI adapter; no browser tests are claimed in M1.
