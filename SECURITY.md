# Security

Use LogiParity only against test and staging systems. Configuration labels do not detect a production hostname. Configuration files are trusted input and select file paths, queries, origins and credentials.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Nutts5796/logiparity/security/advisories/new). Include the version, affected component, impact and a minimal synthetic reproduction. Keep credentials, browser state and customer data out of public issues. For general bugs, use the normal issue template with sanitized examples.

## Operational boundaries

Parity reads configured sources. REST requests reject redirects and embedded credentials. Browser reads restrict requests to configured origins and block service workers and WebSockets. Saved authentication and failure screenshots can contain sensitive test data; keep them private.

SQL is parsed before connecting and runs in a READ ONLY transaction. Use a dedicated SELECT-only staging role. This is not a sandbox for privileged effects hidden inside database objects. Development database fixtures are separate from the installed read adapter and restricted to disposable loopback databases.

Scenarios send only explicitly mapped requests to a configured test or staging target with allowMutations: true. There is no automatic rollback or retry. Custom invariant modules require --allow-modules and a scenario-local entry path. They are trusted Node.js code with local permissions; review their imports and behavior.

AI commands preview locally by default. --send and complete provider configuration are required for a request; normal checks and scenarios never use AI. Structured field masking is not general PII detection. Review the full prompt and protect preview logs. Draft files are marked for review, written privately and never executed automatically.

## Dependencies and distribution

Runtime versions and integrity hashes are locked; [licenses](docs/dependencies.md) and [audit notes](docs/dependency-audit.md) document the bundle. Existing ExcelJS dependencies have moderate advisories. Do not parse adversarial exports, and review the dependency chain and final container image before deployment. No telemetry or automatic update check runs during checks.
