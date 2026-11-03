import { keyFields, errorText, type EntityConfig, type SourceConfig } from './config.js';
import { normalize } from './normalize.js';
import { matchesFilter } from './filters.js';
import { keyText } from './keys.js';
import { formatMoneyMajor } from './money-display.js';
import { DecimalSum, measureAggregate } from './aggregates.js';
import { sourceRow, type Finding, type NormalizedValue, type SourceReader, type Report } from './types.js';
import { redactSecrets } from './diagnostics.js';
import { SourceError } from './source-error.js';
export type Row = Record<string, NormalizedValue>;
export interface SourceState {
  rows: Map<string, Row>;
  parts: Map<string, string[]>;
  positions: Map<string, number>;
  uncertain: Map<string, Set<string>>;
  issues: Finding[];
  firstRows: Map<string, number>;
  conflicts: Map<string, Finding>;
  identities: Set<string>;
  sums: Map<string, Map<string, DecimalSum>>;
  measurements: Map<string, number | bigint | undefined>;
  excluded: Map<string, Set<string>>;
  count: number;
  position: number;
  invalidRows: Set<number>;
}
function uncertain(state: SourceState, key: string, fields: readonly string[]): void {
  const names = state.uncertain.get(key) ?? new Set<string>();
  fields.forEach((field) => names.add(field));
  state.uncertain.set(key, names);
}
function readKey(entity: EntityConfig, raw: Record<string, unknown>): { key: string; parts?: string[] } {
  const parts = keyFields(entity.key).map((field) => {
    const value = raw[field];
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      String(value).trim() === '' ||
      (typeof value === 'number' && !Number.isSafeInteger(value))
    )
      throw new Error(`Key field ${field} must be a nonempty string or safe integer.`);
    return String(value).trim();
  });
  return typeof entity.key === 'string' ? { key: parts[0] ?? '' } : { key: JSON.stringify(parts), parts };
}
function identityFields(entity: EntityConfig, key: string, parts?: string[]) {
  return { entity: entity.name, key, ...(parts ? { keyParts: parts } : {}) };
}
function invalid(
  state: SourceState,
  entity: EntityConfig,
  source: string,
  key: string,
  field: string,
  value: unknown,
  error: unknown,
): void {
  state.invalidRows.add(state.position);
  if (key) uncertain(state, key, [field]);
  const actual =
    value instanceof Error
      ? undefined
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null
        ? value
        : undefined;
  state.issues.push({
    type: 'invalid_value',
    ...identityFields(entity, key, state.parts.get(key)),
    source,
    field,
    row: state.position,
    ...(actual === undefined ? {} : { actual }),
    message: `Row ${state.position}: ${errorText(error)}`,
  });
}
function normalizeRow(
  entity: EntityConfig,
  source: string,
  raw: Record<string, unknown>,
  state: SourceState,
  key: string,
): Row {
  const row: Row = Object.create(null) as Row;
  const keys = new Set(keyFields(entity.key));
  for (const [field, value] of Object.entries(raw)) {
    try {
      if (value instanceof Error) throw value;
      row[field] = keys.has(field) ? String(value).trim() : normalize(value, entity.compare[field], source);
    } catch (error) {
      row[field] = null;
      invalid(state, entity, source, key, field, value, error);
    }
  }
  return row;
}
function formattedIdentity(field: string, value: NormalizedValue | undefined, entity: EntityConfig): string {
  const rule = entity.compare[field];
  return rule?.type === 'money' && typeof value === 'bigint'
    ? `${field}=${formatMoneyMajor(value, rule.currency ?? 'USD')}`
    : `${field}=${value === null ? '(blank)' : String(value)}`;
}
// Check duplicate identities before adding a line to its rolled-up amount.
function duplicateLine(
  entity: EntityConfig,
  source: string,
  key: string,
  row: Row,
  config: SourceConfig,
  state: SourceState,
): boolean {
  const fields = config.rollup?.duplicates?.by;
  if (!fields) return false;
  const blank = fields.find((field) => row[field] === null || row[field] === undefined || row[field] === '');
  if (blank) {
    invalid(
      state,
      entity,
      source,
      key,
      blank,
      row[blank],
      new Error(`Rollup duplicate identity field ${blank} is blank.`),
    );
    uncertain(state, key, config.rollup?.sum ?? []);
    return true;
  }
  const id = JSON.stringify(fields.map((field) => [typeof row[field], String(row[field])]));
  if (!state.identities.has(id)) {
    state.identities.add(id);
    return false;
  }
  const amounts = (config.rollup?.sum ?? []).flatMap((field) => {
    const rule = entity.compare[field],
      value = row[field];
    return rule?.type === 'money' && typeof value === 'bigint'
      ? [`excluded ${formatMoneyMajor(value, rule.currency ?? 'USD')} from ${keyText(key, state.parts.get(key))}`]
      : [];
  });
  state.issues.push({
    type: 'duplicate_key',
    reason: 'rollup_duplicate',
    ...identityFields(entity, key, state.parts.get(key)),
    source,
    field: keyFields(entity.key).join(', '),
    row: state.position,
    message: `Duplicate identity ${fields.map((field) => formattedIdentity(field, row[field], entity)).join(', ')} at row ${state.position}; ${amounts.join('; ') || 'the repeated row is excluded'}.`,
  });
  uncertain(state, key, config.rollup?.sum ?? []);
  return true;
}
function rollUpRow(
  entity: EntityConfig,
  source: string,
  config: SourceConfig,
  key: string,
  row: Row,
  state: SourceState,
): boolean {
  const rollup = config.rollup;
  if (!rollup) return true;
  if (duplicateLine(entity, source, key, row, config, state)) return false;
  const previous = state.rows.get(key);
  for (const field of rollup.first)
    if (previous && previous[field] !== row[field]) {
      const id = JSON.stringify([key, field]);
      let finding = state.conflicts.get(id);
      if (!finding) {
        finding = {
          type: 'field_mismatch',
          reason: 'rollup_conflict',
          ...identityFields(entity, key, state.parts.get(key)),
          source,
          field,
          row: state.position,
          values: [{ line: state.firstRows.get(key) ?? state.position, value: previous[field] ?? null }],
          message: `${field} has conflicting values within ${keyText(key, state.parts.get(key))}. Check the source rows.`,
        };
        state.conflicts.set(id, finding);
        state.issues.push(finding);
      }
      finding.values?.push({ line: state.position, value: row[field] ?? null });
      uncertain(state, key, [field]);
    }
  for (const field of rollup.sum) {
    const value = row[field];
    if (value === null && entity.compare[field]?.type === 'money') {
      if (!state.uncertain.get(key)?.has(field))
        state.issues.push({
          type: 'invalid_value',
          reason: 'rollup_missing_value',
          ...identityFields(entity, key, state.parts.get(key)),
          source,
          field,
          row: state.position,
          actual: null,
          message: `${field} is (blank) at row ${state.position}. Supply the missing amount.`,
        });
      uncertain(state, key, [field]);
      state.invalidRows.add(state.position);
    }
    if (entity.compare[field]?.type === 'money')
      row[field] =
        (typeof previous?.[field] === 'bigint' ? previous[field] : 0n) + (typeof value === 'bigint' ? value : 0n);
    else {
      const sums = state.sums.get(key) ?? new Map<string, DecimalSum>();
      const sum = sums.get(field) ?? new DecimalSum();
      if (typeof value === 'number') sum.add(value);
      sums.set(field, sum);
      state.sums.set(key, sums);
      row[field] = sum.value();
    }
  }
  if (previous) for (const field of rollup.first) row[field] = previous[field] ?? null;
  const projection = new Set([...keyFields(rollup.by), ...rollup.sum, ...rollup.first]);
  for (const field of Object.keys(row)) if (!projection.has(field)) delete row[field];
  return true;
}
function measureSource(entity: EntityConfig, source: string, config: SourceConfig, state: SourceState): void {
  const projection = config.rollup
    ? new Set([...keyFields(config.rollup.by), ...config.rollup.sum, ...config.rollup.first])
    : undefined;
  const fields = Object.fromEntries(
    Object.entries(config.fields).filter(([field]) => !projection || projection.has(field)),
  );
  for (const aggregate of entity.aggregates) {
    const required = [...Object.keys(aggregate.where), ...(aggregate.type === 'sum' ? [aggregate.field] : [])];
    const excluded = new Set(
      [...state.uncertain].flatMap(([key, uncertainFields]) =>
        required.some((field) => uncertainFields.has(field)) ? [key] : [],
      ),
    );
    state.excluded.set(aggregate.name, excluded);
    try {
      state.measurements.set(
        aggregate.name,
        measureAggregate(
          aggregate,
          entity,
          source,
          { ...config, fields },
          new Map([...state.rows].filter(([key]) => !excluded.has(key))),
        ),
      );
    } catch (error) {
      throw new Error(`Aggregate ${aggregate.name}: ${errorText(error)}`);
    }
  }
}
function checkUniqueness(entity: EntityConfig, source: string, config: SourceConfig, state: SourceState): void {
  for (const field of config.unique) {
    const values = new Map<string, { value: NormalizedValue; keys: string[] }>();
    for (const [key, row] of state.rows) {
      const value = row[field];
      if (value === null || value === undefined || value === '') continue;
      const id = JSON.stringify([typeof value, String(value)]);
      const item = values.get(id) ?? { value, keys: [] };
      item.keys.push(key);
      values.set(id, item);
    }
    for (const { value, keys } of values.values())
      if (keys.length > 1) {
        const amounts = Object.entries(entity.compare).flatMap(([moneyField, rule]) => {
          if (rule.type !== 'money' || !Object.hasOwn(config.fields, moneyField)) return [];
          const total = keys.slice(1).reduce((sum, key) => {
            const amount = state.rows.get(key)?.[moneyField];
            return sum + (typeof amount === 'bigint' ? amount : 0n);
          }, 0n);
          return [{ field: moneyField, amount: total }];
        });
        const paid = amounts
          .map((amount) => formatMoneyMajor(BigInt(amount.amount), entity.compare[amount.field]?.currency ?? 'USD'))
          .join(', ');
        state.issues.push({
          type: 'duplicate_value',
          entity: entity.name,
          source,
          key: keys[0] ?? '',
          field,
          actual: value,
          relatedKeys: keys,
          amounts,
          message: `${field} ${String(value)} appears on ${keys.map((key) => keyText(key, state.parts.get(key))).join(' and ')}${paid ? `; paid more than once: ${paid}` : ''}.`,
        });
      }
  }
}
export async function readSource(
  entity: EntityConfig,
  source: string,
  config: SourceConfig,
  read: SourceReader,
  secrets: string[],
  report: Report,
  maxInvalidRows: number,
): Promise<SourceState | undefined> {
  const state: SourceState = {
    rows: new Map(),
    parts: new Map(),
    positions: new Map(),
    uncertain: new Map(),
    issues: [],
    firstRows: new Map(),
    conflicts: new Map(),
    identities: new Set(),
    sums: new Map(),
    measurements: new Map(),
    excluded: new Map(),
    count: 0,
    position: 0,
    invalidRows: new Set(),
  };
  let records = 0;
  try {
    for await (const raw of read(source, config, {
      warn: (message) => {
        report.warnings ??= [];
        const warning = { entity: entity.name, source, message: redactSecrets(message, secrets) };
        if (
          !report.warnings.some(
            (item) => item.message === warning.message && item.source === source && item.entity === entity.name,
          )
        )
          report.warnings.push(warning);
      },
    })) {
      records++;
      state.position = raw[sourceRow] ?? records;
      // Reject excluded rows before parsing unrelated cells or requiring their key.
      const filters = { ...config.where, ...(config.rollup?.where ?? {}) };
      const filterRow: Row = {};
      let filterInvalid = false;
      for (const field of Object.keys(filters)) {
        try {
          filterRow[field] = normalize(raw[field], entity.compare[field], source);
        } catch {
          filterInvalid = true;
          break;
        }
      }
      if (
        !filterInvalid &&
        (!matchesFilter(filterRow, config.where, entity, source) ||
          !matchesFilter(filterRow, config.rollup?.where ?? {}, entity, source))
      )
        continue;
      let key: string;
      try {
        const identity = readKey(entity, raw);
        key = identity.key;
        if (identity.parts) state.parts.set(key, identity.parts);
      } catch (error) {
        invalid(state, entity, source, '', keyFields(entity.key).join(', '), undefined, error);
        if (state.invalidRows.size > maxInvalidRows)
          throw new Error(`More than maxInvalidRows (${maxInvalidRows}) rows are invalid.`);
        continue;
      }
      const row = normalizeRow(entity, source, raw, state, key);
      if (state.invalidRows.size > maxInvalidRows)
        throw new Error(`More than maxInvalidRows (${maxInvalidRows}) rows are invalid.`);
      if (
        !matchesFilter(row, config.where, entity, source) ||
        !matchesFilter(row, config.rollup?.where ?? {}, entity, source)
      )
        continue;
      state.count++;
      if (state.rows.has(key) && !config.rollup) {
        state.issues.push({
          type: 'duplicate_key',
          ...identityFields(entity, key, state.parts.get(key)),
          source,
          field: keyFields(entity.key).join(', '),
          row: state.position,
          message: `Duplicate key ${keyText(key, state.parts.get(key))} at row ${state.position}; the first record is retained.`,
        });
        uncertain(state, key, Object.keys(row));
        continue;
      }
      const included = rollUpRow(entity, source, config, key, row, state);
      if (!state.firstRows.has(key)) {
        state.firstRows.set(key, state.position);
        state.positions.set(key, records);
      }
      if (included) state.rows.set(key, row);
      else if (!state.rows.has(key)) state.rows.set(key, row);
      if (state.invalidRows.size > maxInvalidRows)
        throw new Error(`More than maxInvalidRows (${maxInvalidRows}) rows are invalid.`);
    }
    checkUniqueness(entity, source, config, state);
    measureSource(entity, source, config, state);
    return state;
  } catch (error) {
    report.findings.push(...state.issues, {
      type: 'source_error',
      entity: entity.name,
      source,
      key: '',
      field: '',
      message: redactSecrets(errorText(error), secrets),
      ...(error instanceof SourceError && error.screenshot ? { screenshot: error.screenshot } : {}),
    });
    return undefined;
  }
}
