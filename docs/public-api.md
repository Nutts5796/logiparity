# Supported public API

The package exposes logiparity/core, logiparity/adapters, logiparity/scenarios and logiparity/ai. Import package exports rather than lib paths; lib and private #logiparity imports are implementation details.

logiparity/core supports compareEntities, loadConfig, configSchema, entitySchema, sourceSchema, ruleSchema, normalize, moneyMinor, equalValues, reportExitCode, writeReports, jsonReport, consoleReport, htmlReport, markdownReport and junitReport. Public contracts are Config, EntityConfig, SourceConfig, ComparisonRule, LoadedConfig, Report, Finding, FindingGroup, AggregateResult, DataRow, SourceReader, ReportPresentation, Adapter and AdapterContext.

The adapters export supports adapters.read and source readers; scenarios exports runScenario, validateScenario and the documented invariant contracts; ai exports draft preparation and provider contracts. Normal parity and built-in scenarios do not load jiti or optional database/browser clients. Custom modules load jiti only after --allow-modules and path validation. Non-exported helpers may change without a public API guarantee. Compatible optional additions follow semver; removing supported exports requires a major release.
