import { redactSecrets, secretValues } from './diagnostics.js';
import { errorText, type EntityConfig, type SourceConfig } from './config.js';
import { equalValues, normalize } from './normalize.js';
import type { EntitySummary, Finding, NormalizedValue, Report, SourceReader } from './types.js';
import { aggregateEqual, measureAggregate, DecimalSum } from './aggregates.js';
import { applyFailurePolicies } from './policy.js';
import { groupFindings } from './groups.js';
import { formatMoneyMajor } from './money-display.js';
import { SourceError } from './source-error.js';

type Row = Record<string, NormalizedValue>;
interface SourceState {
  rows: Map<string, Row>;
  uncertain: Map<string, Set<string>>;
  issues: Finding[];
  firstLines: Map<string, number>;
  conflicts: Map<string, Finding>;
  identities: Set<string>;
  sums: Map<string, Map<string, DecimalSum>>;
  projection?: Set<string>;
  measurements: Map<string, number | bigint | undefined>;
  count: number;
  context: string;
}
const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      order(a.entity, b.entity) ||
      order(a.key, b.key) ||
      order(a.field, b.field) ||
      order(a.source, b.source) ||
      order(a.type, b.type),
  );
}
function uncertain(state: SourceState, key: string, fields: readonly string[]): void {
  const names = state.uncertain.get(key) ?? new Set<string>();
  for (const field of fields) names.add(field);
  state.uncertain.set(key, names);
}
function readKey(entity: EntityConfig, raw: Record<string, unknown>): string {
  const value = raw[entity.key];
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    String(value).trim() === '' ||
    (typeof value === 'number' && !Number.isSafeInteger(value))
  )
    throw new Error(`Invalid key ${entity.key}; provide a nonempty string or safe integer.`);
  return String(value).trim();
}
function normalizeRow(
  entity: EntityConfig,
  source: string,
  raw: Record<string, unknown>,
  state: SourceState,
  key: string,
): Row {
  const row: Row = Object.create(null) as Row;
  for (const [field, value] of Object.entries(raw)) {
    state.context = `row ${state.count}, key ${key}, field ${field}`;
    row[field] = field === entity.key ? key : normalize(value, entity.compare[field], source);
  }
  return row;
}
// Check line identities and disagreements before adding anything to a rolled-up total.
function rollUpRow(
  entity: EntityConfig,
  source: string,
  config: SourceConfig,
  key: string,
  row: Row,
  state: SourceState,
): boolean {
  const rollup = config.rollup!;
  const previous = state.rows.get(key);
  for (const field of rollup.first)
    if (previous && previous[field] !== row[field]) {
      const id = JSON.stringify([key, field]);
      let finding = state.conflicts.get(id);
      if (!finding) {
        finding = {
          type: 'field_mismatch',
          reason: 'rollup_conflict',
          entity: entity.name,
          source,
          key,
          field,
          values: [{ line: state.firstLines.get(key)!, value: previous[field] ?? null }],
          message: `${source}: rollup field ${field} has conflicting values within load ${key}; the first value is retained.`,
        };
        state.conflicts.set(id, finding);
        state.issues.push(finding);
      }
      finding.values!.push({ line: state.count, value: row[field] ?? null });
      uncertain(state, key, [field]);
    }
  for (const field of rollup.sum)
    if (entity.compare[field]?.type === 'money' && row[field] === null) {
      state.issues.push({
        type: 'field_mismatch',
        reason: 'rollup_missing_value',
        entity: entity.name,
        source,
        key,
        field,
        actual: null,
        message: `${source}: blank money in ${field} at row ${state.count}, key ${key}; monetary comparison and affected totals are skipped.`,
      });
      uncertain(state, key, [field]);
    }
  if (rollup.duplicates) {
    const fields = rollup.duplicates.by;
    if (fields.some((field) => row[field] === null || row[field] === undefined))
      throw new Error('Rollup duplicate identity fields cannot be blank');
    const identity = JSON.stringify(fields.map((field) => [typeof row[field], String(row[field])]));
    if (state.identities.has(identity)) {
      const amounts = rollup.sum
        .map((field) => {
          const rule = entity.compare[field];
          const value = row[field];
          return rule?.type === 'money' && typeof value === 'bigint'
            ? `excluded ${formatMoneyMajor(value, rule.currency!, rule.locale)} from load ${key} (${field})`
            : undefined;
        })
        .filter(Boolean);
      state.issues.push({
        type: 'duplicate_key',
        reason: 'rollup_duplicate',
        entity: entity.name,
        source,
        key,
        field: entity.key,
        message: `${source}: duplicate rollup line identity (${fields.map((field) => `${field}=${String(row[field])}`).join(', ')}) at row ${state.count}; ${amounts.length ? amounts.join('; ') : 'the repeated line is excluded'} before summing.`,
      });
      uncertain(state, key, rollup.sum);
      return false;
    }
    state.identities.add(identity);
  }
  for (const field of rollup.sum) {
    const value = row[field];
    if (value !== null && typeof value !== 'number' && typeof value !== 'bigint')
      throw new Error(`Rollup sum field ${field} is not numeric`);
    if (entity.compare[field]?.type === 'money')
      row[field] = ((previous?.[field] as bigint | undefined) ?? 0n) + ((value as bigint | null) ?? 0n);
    else {
      const perKey = state.sums.get(key) ?? new Map<string, DecimalSum>();
      const sum = perKey.get(field) ?? new DecimalSum();
      if (typeof value === 'number') sum.add(value);
      perKey.set(field, sum);
      state.sums.set(key, perKey);
      row[field] = sum.value();
    }
  }
  if (previous) for (const field of rollup.first) row[field] = previous[field] ?? null;
  for (const field of Object.keys(row)) if (!state.projection!.has(field)) delete row[field];
  return true;
}
// Measure only inputs with complete, unambiguous values after rollup.
function measureSource(entity: EntityConfig, source: string, config: SourceConfig, state: SourceState): void {
  const measuredConfig = state.projection
    ? {
        ...config,
        fields: Object.fromEntries(Object.entries(config.fields).filter(([field]) => state.projection!.has(field))),
      }
    : config;
  for (const aggregate of entity.aggregates) {
    state.context = `aggregate ${aggregate.name}`;
    const required = [...Object.keys(aggregate.where), ...(aggregate.type === 'sum' ? [aggregate.field] : [])];
    const ambiguous = [...state.uncertain.values()].some((fields) => required.some((field) => fields.has(field)));
    state.measurements.set(
      aggregate.name,
      ambiguous ? undefined : measureAggregate(aggregate, entity, source, measuredConfig, state.rows),
    );
  }
}
// Read and normalize a whole source transactionally; discard partial results on any error.
async function readSource(
  entity: EntityConfig,
  source: string,
  config: SourceConfig,
  read: SourceReader,
  secrets: string[],
  report: Report,
): Promise<SourceState | undefined> {
  const state: SourceState = {
    rows: new Map(),
    uncertain: new Map(),
    issues: [],
    firstLines: new Map(),
    conflicts: new Map(),
    identities: new Set(),
    sums: new Map(),
    measurements: new Map(),
    count: 0,
    context: '',
    ...(config.rollup ? { projection: new Set([config.rollup.by, ...config.rollup.sum, ...config.rollup.first]) } : {}),
  };
  try {
    for await (const raw of read(source, config, {
      warn: (message) => {
        const warning = { entity: entity.name, source, message: redactSecrets(message, secrets) };
        report.warnings ??= [];
        if (
          !report.warnings.some(
            (item) => item.entity === entity.name && item.source === source && item.message === warning.message,
          )
        )
          report.warnings.push(warning);
      },
    })) {
      state.count++;
      state.context = `row ${state.count}`;
      const key = readKey(entity, raw);
      state.context += `, key ${key}`;
      if (state.rows.has(key) && !config.rollup) {
        state.issues.push({
          type: 'duplicate_key',
          entity: entity.name,
          source,
          key,
          field: entity.key,
          message: `${source}: duplicate key ${key} at row ${state.count}; the first record is used.`,
        });
        continue;
      }
      const row = normalizeRow(entity, source, raw, state, key);
      if (config.rollup && !rollUpRow(entity, source, config, key, row, state)) continue;
      if (!state.firstLines.has(key)) state.firstLines.set(key, state.count);
      state.rows.set(key, row);
    }
    measureSource(entity, source, config, state);
    return state;
  } catch (error) {
    report.findings.push({
      type: 'source_error',
      entity: entity.name,
      source,
      key: '',
      field: '',
      message: redactSecrets(
        `${entity.name}/${source}${state.context ? ` (${state.context})` : ''}: ${errorText(error)}`,
        secrets,
      ),
      ...(error instanceof SourceError && error.screenshot ? { screenshot: error.screenshot } : {}),
    });
    return undefined;
  }
}
// Compare unique keys and fields, skipping values made uncertain by source-local issues.
function compareSource(
  entity: EntityConfig,
  source: string,
  reference: string,
  config: SourceConfig,
  baseline: SourceState,
  current: SourceState,
  report: Report,
): void {
  for (const [key, expected] of baseline.rows) {
    const actual = current.rows.get(key);
    if (!actual) {
      report.findings.push({
        type: 'missing_in_source',
        entity: entity.name,
        source,
        key,
        field: '',
        message: `${source}: key ${key} exists in reference ${reference} but is missing here.`,
      });
      continue;
    }
    for (const [field, value] of Object.entries(expected)) {
      if (
        field === entity.key ||
        !Object.hasOwn(config.fields, field) ||
        (current.projection && !current.projection.has(field)) ||
        current.uncertain.get(key)?.has(field) ||
        baseline.uncertain.get(key)?.has(field)
      )
        continue;
      const actualValue = actual[field] ?? null;
      if (!equalValues(value, actualValue, entity.compare[field]))
        report.findings.push({
          type: 'field_mismatch',
          entity: entity.name,
          source,
          key,
          field,
          expected: value,
          actual: actualValue,
          message: `${source}: key ${key}, field ${field} differs from reference ${reference}.`,
        });
    }
  }
  for (const key of current.rows.keys())
    if (!baseline.rows.has(key))
      report.findings.push({
        type: 'extra_in_source',
        entity: entity.name,
        source,
        key,
        field: '',
        message: `${source}: key ${key} is absent from reference ${reference}.`,
      });
}
// Publish aggregate values only after a complete source has been read.
function publishAggregates(
  entity: EntityConfig,
  source: string,
  reference: string,
  state: SourceState,
  summary: EntitySummary,
  report: Report,
): void {
  for (const [index, aggregate] of entity.aggregates.entries()) {
    const result = summary.aggregates?.[index];
    if (!result) continue;
    const actual = state.measurements.get(aggregate.name);
    if (actual === undefined) {
      result.skippedSources.push(source);
      continue;
    }
    result.values[source] = actual;
    const expected = result.values[reference];
    if (source !== reference && expected !== undefined && !aggregateEqual(expected, actual, aggregate))
      report.findings.push({
        type: 'aggregate_mismatch',
        entity: entity.name,
        source,
        key: '',
        field: aggregate.name,
        expected,
        actual,
        message: `${source}: aggregate ${aggregate.name} differs from reference ${reference}.`,
      });
  }
}
export async function compareEntities(
  entities: EntityConfig[],
  read: SourceReader,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Report> {
  const secrets = secretValues(entities, env);
  const report: Report = { schemaVersion: 1, findings: [], entities: [] };
  const finalKeys: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const entity of entities) {
    const sources = Object.entries(entity.sources);
    const reference = sources[0]?.[0] ?? '';
    const summary: EntitySummary = {
      entity: entity.name,
      reference,
      counts: {},
      ...(entity.aggregates.length
        ? {
            aggregates: entity.aggregates.map((a) => ({
              name: a.name,
              type: a.type,
              values: Object.create(null) as Record<string, number | bigint>,
              skippedSources: [],
            })),
          }
        : {}),
    };
    report.entities.push(summary);
    let baseline: SourceState | undefined;
    for (const [source, config] of sources) {
      const current = await readSource(entity, source, config, read, secrets, report);
      if (!current) {
        if (source === reference) break;
        continue;
      }
      summary.counts[source] = current.count;
      report.findings.push(...current.issues);
      publishAggregates(entity, source, reference, current, summary, report);
      if (source === reference) {
        baseline = current;
        const last = [...current.rows.keys()].at(-1);
        if (last) finalKeys[entity.name] = last;
      } else if (baseline) compareSource(entity, source, reference, config, baseline, current, report);
    }
  }
  // Sort findings deterministically, then derive investigation groups without dropping any rows.
  sortFindings(report.findings);
  report.entities.sort((a, b) => order(a.entity, b.entity));
  applyFailurePolicies(report, entities);
  report.groups = groupFindings(report.findings, entities, finalKeys);
  return report;
}
