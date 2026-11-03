import type { RowFilter } from './config.js';
import type { SourceConfig } from './config.js';

export const wallClock = Symbol.for('logiparity.wallClock');
export const sourceIssue = Symbol.for('logiparity.sourceIssue');
export const sourceRow = Symbol.for('logiparity.sourceRow');
export type DataRow = Record<string, unknown> & { [sourceRow]?: number; [sourceIssue]?: Error };
export function withSourceRow(row: DataRow, position: number): DataRow {
  Object.defineProperty(row, sourceRow, { value: position });
  return row;
}
export interface AdapterContext {
  sourceName?: string;
  baseDir: string;
  env: NodeJS.ProcessEnv;
  reportDir?: string;
  warn?: (message: string) => void;
  allowedHosts?: readonly string[];
}
export interface Adapter {
  read(config: SourceConfig, context: AdapterContext): AsyncIterable<DataRow>;
}
export type FindingType =
  | 'missing_in_source'
  | 'extra_in_source'
  | 'field_mismatch'
  | 'aggregate_mismatch'
  | 'duplicate_key'
  | 'source_error'
  | 'invalid_value'
  | 'duplicate_value';
export type NormalizedValue = string | number | bigint | boolean | null;
export interface Finding {
  type: FindingType;
  entity: string;
  source: string;
  key: string;
  keyParts?: string[];
  row?: number;
  relatedKeys?: string[];
  amounts?: { field: string; currency?: string; amount: bigint | string }[];
  currency?: string;
  field: string;
  message: string;
  hint?: string;
  expected?: NormalizedValue;
  actual?: NormalizedValue;
  values?: { row: number; value: NormalizedValue }[];
  reason?: 'rollup_conflict' | 'rollup_missing_value' | 'rollup_duplicate' | 'currency_mismatch';
  blocking?: boolean;
  screenshot?: string;
  referencePosition?: number;
  evidence?: {
    offsetFree?: boolean;
    paginated?: boolean;
    pageSizes?: number[];
    referenceInvalid?: boolean;
    referenceUncertain?: boolean;
    referenceValue?: NormalizedValue;
    timezone?: string;
  };
  accounting?: { causes: string[]; remainder: string };
}
export interface AggregateReconciliation {
  missingRows: { count: number; amount: bigint | string };
  extraRows?: { count: number; amount: bigint | string };
  valueDifferences?: { count: number; amount: bigint | string };
  patterns: { group: number; count: number; amount: bigint | string }[];
  remainder: bigint | string;
  uncertain?: { keys: string[][]; amount: bigint | string };
  causes?: string[];
}
export interface AggregateResult {
  name: string;
  type: 'count' | 'sum';
  values: Record<string, number | bigint>;
  rawValues?: Record<string, number | bigint>;
  valuesByCurrency?: Record<string, Record<string, bigint | string>>;
  rawValuesByCurrency?: Record<string, Record<string, bigint | string>>;
  excludedRows?: Record<string, number[]>;
  skippedSources: string[];
  sourceStatus?: Record<string, 'certain' | 'uncertain' | 'not_mapped' | 'not_read'>;
  uncertainKeys?: Record<string, string[][]>;
  reconciliation?: Record<string, AggregateReconciliation>;
  reconciliationByCurrency?: Record<string, Record<string, AggregateReconciliation>>;
}
export interface EntitySummary {
  entity: string;
  reference: string;
  counts: Record<string, number>;
  uniqueCounts?: Record<string, number>;
  filters?: Record<string, { source: RowFilter; rollup: RowFilter; caseSensitive?: boolean }>;
  rollupSources?: string[];
  pluralLabel?: string;
  aggregates?: AggregateResult[];
}
export interface FindingGroup {
  entity: string;
  source: string;
  field: string;
  count: number;
  currency?: string;
  cause?: 'timezone' | 'pagination';
  kind: 'datetime_offset' | 'money_delta' | 'value_mapping' | 'missing_stride' | 'extra_stride';
  delta?: string;
  stride?: string;
  keys?: string[];
  expected?: NormalizedValue;
  actual?: NormalizedValue;
  summary: string;
  findingIndexes?: number[];
}
export interface ReportWarning {
  message: string;
  entity?: string;
  source?: string;
}
export interface SourceReadContext {
  warn: (message: string) => void;
}
export interface Report {
  schemaVersion: 1;
  truncated?: boolean;
  patterns?: { minCount: number };
  findings: Finding[];
  entities: EntitySummary[];
  groups?: FindingGroup[];
  warnings?: ReportWarning[];
  coverage?: { explained: number; needsReview: number };
}
export type SourceReader = (source: string, config: SourceConfig, context: SourceReadContext) => AsyncIterable<DataRow>;
