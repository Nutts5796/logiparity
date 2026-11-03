# Security

Use LogiParity only against test and staging systems. Configuration labels do not detect a production hostname. Configuration files are trusted input and select file paths, queries, origins and credentials.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Nutts5796/logiparity/security/advisories/new). Include the version, affected component, impact and a minimal synthetic reproduction. Keep credentials, browser state and customer data out of public issues. For general bugs, use the normal issue template with sanitized examples.

## Operational boundaries

Parity reads configured sources. REST requests reject redirects and embedded credentials. Browser reads restrict requests to configured origins and block service workers and WebSockets. Saved authentication and failure screenshots can contain sensitive test data; keep them private.

SQL is parsed before connecting and runs in a READ ONLY transaction. Use a dedicated SELECT-only staging role. This is not a sandbox for privileged effects hidden inside database objects. Development database fixtures are separate from the installed read adapter and restricted to disposable loopback databases.

Scenarios send only explicitly mapped requests to a configured test or staging target with allowMutations: true. There is no automatic rollback or retry. Custom invariant modules require --allow-modules and a scenario-local entry path. They are trusted Node.js code with local permissions; review their imports and behavior.

AI commands preview locally by default. --send and complete provider configuration are required for a request; normal checks and scenarios never use AI. Structured field masking is not general PII detection. Review the full prompt and protect preview logs. Draft files are marked for review, written privately and never executed automatically.

## Supported versions

| Version                | Security fixes                    |
| ---------------------- | --------------------------------- |
| Latest 1.x release     | Supported                         |
| Older 1.x patches      | Upgrade to the latest 1.x release |
| 1.1.0 pre-release work | Under review; not published       |

The maintainer aims to acknowledge private reports within seven days and provide an initial assessment or progress update within 30 days. This is an expected response time, not a guaranteed service level.

## Dependencies and distribution

Runtime dependencies are exact-pinned and consumer overrides remain available. Browser and PostgreSQL packages are optional peers. The source checkout has development-only moderate advisories; see [audit notes](docs/dependency-audit.md). The installed CLI excludes development tools. Full dependency and font license texts are included with the package. No telemetry or automatic update check runs during checks.

`allowedHosts` restricts configured connections before I/O; mutation-enabled targets require it. `environment: test` remains a label. Scenario paths enforce the base path and encoded placeholders; setup fixture realpaths cannot escape the scenario directory. XLSX streaming quotas bound XML tokens, decompression and temporary disk use. Exit and signal handlers clean task-owned temporary files; SIGKILL cannot run cleanup handlers.
