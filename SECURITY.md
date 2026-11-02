# Security and operational scope

LogiParity is intended only for test/staging environments. The environment declaration is not a production-host detector. Supply only test/staging URLs and credentials. M3 adds browser reads and read-only PostgreSQL; later scenario mutation features must remain test/staging only.

There is no telemetry, analytics, automatic update check or AI provider integration. Install/development tooling may access npm; normal checks access only configured source targets. REST redirects, embedded URL credentials and cross-origin pagination links are rejected. Authentication is read from environment variables, never written into the report. Reports intentionally contain compared field values and may include local file paths in errors: treat artifacts according to the sensitivity of your test data.

UI browser requests are restricted to configured origins; service workers and WebSockets are blocked. storageState files contain session material and must remain private/ignored. UI error screenshots can contain visible test data. The local demo login uses public synthetic credentials and is not production authentication; its login helper refuses non-loopback targets.

SQL is parsed before connecting and executed with READ ONLY on a dedicated client. Use a SELECT-only staging role: transaction restrictions are not a general sandbox for privileged side effects hidden inside database objects. The adapter never seeds/migrates databases. Development tests create disposable loopback clusters or random schemas only in an explicitly named logiparity_test database, and remove their fixtures.

Do not submit secrets, real customer records or exploit details in a public issue. Agree a private reporting channel with the owner, Sergei Orekhovskii, before transmitting sensitive details. No security mailbox or private advisory process is currently configured. This project is unreleased and does not claim an independent security audit.

Dependency versions and integrity hashes are committed in package-lock.json; direct/runtime licenses are in docs/dependencies.md. The M1 milestone report records the most recent npm audit result and remaining limitations. ExcelJS 4.4.0 depends on older glob/minimatch chains with moderate advisories; forcing a new major minimatch into callers expecting the legacy callable API is not a safe automatic fix. Do not parse untrusted or adversarial exports. Reassess the dependency tree before any public release. Vitest is a development dependency and runs in non-listening run mode for these tests.
