export {
  compareEntities,
  loadConfig,
  configSchema,
  entitySchema,
  sourceSchema,
  ruleSchema,
  normalize,
  moneyMinor,
  equalValues,
  reportExitCode,
  writeReports,
  jsonReport,
  consoleReport,
  htmlReport,
  markdownReport,
  junitReport,
} from '@logiparity/core';
export type {
  Config,
  EntityConfig,
  SourceConfig,
  ComparisonRule,
  LoadedConfig,
  Report,
  Finding,
  FindingGroup,
  AggregateResult,
  DataRow,
  SourceReader,
  ReportPresentation,
  Adapter,
  AdapterContext,
} from '@logiparity/core';

// Compatibility aliases from 1.0.x; migrate before 2.0.
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { SourceError } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { ConfigError } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { aggregateSchema } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { failOnSchema } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { errorText } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { loadYaml } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { formatConfigIssues } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { isSecretName } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { secretValues } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { redactSecrets } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { safeConsole } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { sortFindings } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { groupFindings } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { reportGroups } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { formatDatetimeUtc } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { formatMoneyMajor } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { presentationValue } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { findingCategories } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { isBlocking } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { applyFailurePolicies } from '@logiparity/core';
/** @deprecated Compatibility export retained until 2.0. See docs/public-api.md. */
export { writeJsonReport } from '@logiparity/core';
export type {
  RestConfig,
  FileConfig,
  UiConfig,
  SqlConfig,
  AggregateConfig,
  FindingType,
  NormalizedValue,
  EntitySummary,
  FindingCategory,
  FailurePolicy,
} from '@logiparity/core';
