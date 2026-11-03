import type { SourceConfig } from './config.js';

export type DataRow = Record<string, unknown>;
export interface AdapterContext {
  baseDir: string;
  env: NodeJS.ProcessEnv;
  reportDir?: string;
  warn?: (message: string) => void;
}
export interface Adapter {
  read(config: SourceConfig, context: AdapterContext): AsyncIterable<DataRow>;
}
export type FindingType =
  'missing_in_source' | 'extra_in_source' | 'field_mismatch' | 'aggregate_mismatch' | 'duplicate_key' | 'source_error';
export type NormalizedValue = string | number | bigint | boolean | null;
export interface Finding {
  type: FindingType;
  entity: string;
  source: string;
  key: string;
  field: string;
  message: string;
  expected?: NormalizedValue;
  actual?: NormalizedValue;
  values?: { line: number; value: NormalizedValue }[];
  reason?: 'rollup_conflict' | 'rollup_missing_value' | 'rollup_duplicate';
  blocking?: boolean;
  screenshot?: string;
  referencePosition?: number;
}
export interface AggregateResult {
  name: string;
  type: 'count' | 'sum';
  values: Record<string, number | bigint>;
  skippedSources: string[];
  reconciliation?: Record<
    string,
    {
      missingRows: { count: number; amount: bigint | string };
      patterns: { group: number; count: number; amount: bigint | string }[];
      remainder: bigint | string;
    }
  >;
}
export interface EntitySummary {
  entity: string;
  reference: string;
  counts: Record<string, number>;
  aggregates?: AggregateResult[];
}
export interface FindingGroup {
  entity: string;
  source: string;
  field: string;
  count: number;
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
  findings: Finding[];
  entities: EntitySummary[];
  groups?: FindingGroup[];
  warnings?: ReportWarning[];
  coverage?: { explained: number; needsReview: number };
}
export type SourceReader = (source: string, config: SourceConfig, context: SourceReadContext) => AsyncIterable<DataRow>;
