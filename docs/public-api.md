# Supported public API

The package exposes logiparity/core, logiparity/adapters, logiparity/scenarios and logiparity/ai. Import package exports rather than lib paths; lib and private #logiparity imports are implementation details.

logiparity/core supports compareEntities, loadConfig, configSchema, entitySchema, sourceSchema, ruleSchema, normalize, moneyMinor, equalValues, reportExitCode, writeReports, jsonReport, consoleReport, htmlReport, markdownReport and junitReport. Public contracts are Config, EntityConfig, SourceConfig, ComparisonRule, LoadedConfig, Report, Finding, FindingGroup, AggregateResult, DataRow, SourceReader, ReportPresentation, Adapter and AdapterContext.

The adapters export supports adapters.read and source readers; scenarios exports runScenario, validateScenario and the documented invariant contracts; ai exports draft preparation and provider contracts. Normal parity and built-in scenarios do not load jiti or optional database/browser clients. Custom modules load jiti only after --allow-modules and path validation. Non-exported helpers may change without a public API guarantee. Compatible optional additions follow semver; removing supported exports requires a major release.

## Deprecated compatibility exports

The 1.0 core runtime exports restored until 2.0 are SourceError, ConfigError, aggregateSchema, failOnSchema, errorText, loadYaml, formatConfigIssues, isSecretName, secretValues, redactSecrets, safeConsole, sortFindings, groupFindings, reportGroups, formatDatetimeUtc, formatMoneyMajor, presentationValue, findingCategories, isBlocking, applyFailurePolicies and writeJsonReport. Existing declaration aliases are retained too (RestConfig, FileConfig, UiConfig, SqlConfig, AggregateConfig, FindingType, NormalizedValue, EntitySummary, FindingCategory and FailurePolicy). Prefer loadConfig/schema validation, compareEntities, reportExitCode and the report writers listed above for new integrations; internal grouping, diagnostics and policy mutation helpers will be removed in 2.0.

The scenario entry point explicitly exports runScenario, validateScenario, loadScenario, loadTarget, scenarioSchema, targetSchema and the five scenario report functions, plus the Scenario, Target, ScenarioReport and invariant contracts. Compatibility helpers eventTypes, builtinNames, affectedBy, checkBuiltin, invariantLabels, prepareInvariant, canonical, requiredStateSources, validateState and scenarioFixture remain deprecated until 2.0. Internal HTTP/state helpers are not exported through this entry point.

The AI entry point explicitly exports prepareDraft, generateDraft, renderDraft, loadAiSettings, aiSettingsSchema, ChatCompletionsProvider, redactInput, draftMarker and their contracts. Compatibility helpers providerConfig, maxRequestBytes, maxResponseBytes, chatBody, requestBody, redacted, defaultRedactFields and prepareDestination remain deprecated until 2.0. Tokenizer and input/parser helpers remain private.

JSON Schema exports are `logiparity/report-schema.json` and `logiparity/scenario-report-schema.json`; see [wire stability](report-schema.md).
