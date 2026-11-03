import { resourceLimitMessage } from './resource-limit.js';
import { reportLabels } from './labels.js';
import { appendFinding } from './finding-limit.js';
import { humanize } from './labels.js';
import { rowCurrency, recordRawTotals, measureCurrencies } from './source-totals.js';
import { keyFields, errorText, type EntityConfig, type SourceConfig } from './config.js';
import { sourceRule, normalize } from './normalize.js';
import { matchesFilter } from './filters.js';
import { keyText } from './keys.js';
import { formatMoneyMajor } from './money-display.js';
import { DecimalSum, measureAggregate } from './aggregates.js';
import { sourceRow, sourceIssue, type Finding, type NormalizedValue, type SourceReader, type Report } from './types.js';
import { redactSecrets } from './diagnostics.js';
import { SourceError } from './source-error.js';
export type Row = Record<string, NormalizedValue>;
export interface SourceState {
  rows: Map<string, Row>;
  currencies: Map<string, Map<string, string>>;
  qualifyingRows: Map<string, Set<number>>;
  rawMeasurements: Map<string, number | bigint>;
  rawCurrencies: Map<string, Record<string, bigint>>;
  currencyMeasurements: Map<string, Record<string, bigint>>;
  rawSums: Map<string, DecimalSum>;
  excludedRows: Set<number>;
  offsetFree: Map<string, Set<string>>;
  parts: Map<string, string[]>;
  positions: Map<string, number>;
  uncertain: Map<string, Set<string>>;
  issues: Finding[];
  firstRows: Map<string, number>;
  rowNumbers: Map<string, number[]>;
  conflicts: Map<string, Finding>;
  identities: Map<string, number>;
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
function readKey(
  entity: EntityConfig,
  raw: Record<string, unknown>,
  source: string,
): { key: string; parts?: string[] } {
  const parts = keyFields(entity.key).map((field) => {
    const value = raw[field];
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      String(value).trim() === '' ||
      (typeof value === 'number' && !Number.isSafeInteger(value))
    )
      throw new Error(`Key field ${field} must be a nonempty string or safe integer.`);
    const normalized = String(
      normalize(value, sourceRule(entity.compare[field], entity.sources[source], source), source) ?? '',
    ).trim();
    const currency =
      entity.sources[source]?.currencyField === field ||
      Object.values(entity.compare).some((rule) => rule.currencyField === field);
    return currency ? normalized.toUpperCase() : normalized;
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
    message: `${entity.sources[source]?.type === 'rest' ? 'Record' : 'Row'} ${state.position}: ${errorText(error)}`,
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
      let rule = sourceRule(entity.compare[field], entity.sources[source], source);
      const config = entity.sources[source];
      if (rule?.type === 'money' && config) rule = { ...rule, currency: rowCurrency(rule, config, raw) };
      row[field] = normalize(value, rule, source);
      if (field === config?.currencyField || Object.values(entity.compare).some((item) => item.currencyField === field))
        row[field] = String(row[field] ?? '')
          .trim()
          .toUpperCase();
      if (keys.has(field)) row[field] = String(row[field] ?? '');
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
    ? `${reportLabels({ entities: [entity] }).field(entity.name, field)}=${formatMoneyMajor(value, rule.currency ?? 'USD')}`
    : `${reportLabels({ entities: [entity] }).field(entity.name, field)}=${value === null ? '(blank)' : typeof value === 'string' && !keyFields(entity.key).includes(field) ? humanize(value) : String(value)}`;
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
    state.identities.set(id, state.position);
    return false;
  }
  state.issues.push({
    type: 'duplicate_key',
    reason: 'rollup_duplicate',
    ...identityFields(entity, key, state.parts.get(key)),
    source,
    field: keyFields(entity.key).join(', '),
    row: state.position,
    message: `Duplicate key ${fields.map((field) => formattedIdentity(field, row[field], entity)).join(', ')} at rows ${state.identities.get(id)} and ${state.position}; the repeated row is not added; all amounts for ${keyText(key, state.parts.get(key))} are excluded from certain totals.`,
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
          values: [{ row: state.firstRows.get(key) ?? state.position, value: previous[field] ?? null }],
          message: `${reportLabels({ entities: [entity] }).field(entity.name, field)} has conflicting values within ${keyText(key, state.parts.get(key))}. Check the source rows.`,
        };
        state.conflicts.set(id, finding);
        state.issues.push(finding);
      }
      finding.values?.push({ row: state.position, value: row[field] ?? null });
      uncertain(state, key, [field]);
    }
  for (const field of rollup.sum) {
    const value = row[field];
    if (value === null) {
      if (!state.uncertain.get(key)?.has(field))
        state.issues.push({
          type: 'invalid_value',
          reason: 'rollup_missing_value',
          ...identityFields(entity, key, state.parts.get(key)),
          source,
          field,
          row: state.position,
          actual: null,
          message: `${reportLabels({ entities: [entity] }).field(entity.name, field)} is (blank) at row ${state.position}. Supply the missing amount.`,
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
          const totals = new Map<string, bigint>();
          for (const key of keys.slice(1)) {
            const amount = state.rows.get(key)?.[moneyField];
            const currency = state.currencies.get(key)?.get(moneyField) ?? rule.currency ?? 'USD';
            if (typeof amount === 'bigint') totals.set(currency, (totals.get(currency) ?? 0n) + amount);
          }
          return [...totals].map(([currency, amount]) => ({ field: moneyField, amount, currency }));
        });
        const paid = amounts
          .map((amount) =>
            formatMoneyMajor(BigInt(amount.amount), amount.currency ?? entity.compare[amount.field]?.currency ?? 'USD'),
          )
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
          message: `${reportLabels({ entities: [entity] }).field(entity.name, field)} ${String(value)} appears on ${keys.map((key) => keyText(key, state.parts.get(key))).join(' and ')}${paid ? `; amounts on additional records: ${paid}` : ''}.`,
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
  maxFindings: number,
  sourcePath = `sources.${source}`,
): Promise<SourceState | undefined> {
  const state: SourceState = {
    rows: new Map(),
    offsetFree: new Map(),
    currencies: new Map(),
    rawMeasurements: new Map(),
    qualifyingRows: new Map(),
    rawCurrencies: new Map(),
    currencyMeasurements: new Map(),
    rawSums: new Map(),
    excludedRows: new Set(),
    parts: new Map(),
    positions: new Map(),
    uncertain: new Map(),
    issues: [],
    firstRows: new Map(),
    rowNumbers: new Map(),
    conflicts: new Map(),
    identities: new Map(),
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
      sourcePath,
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
      if (records > (config.maxRows ?? 100000))
        throw new Error(resourceLimitMessage(`${sourcePath}.maxRows`, config.maxRows ?? 100000));
      if (state.issues.length > maxFindings) throw new Error(resourceLimitMessage('maxFindings', maxFindings));
      state.position = raw[sourceRow] ?? records;
      // Reject excluded rows before parsing unrelated cells or requiring their key.
      const filters = { ...config.where, ...(config.rollup?.where ?? {}) };
      const filterRow: Row = {};
      let filterInvalid = false;
      for (const field of Object.keys(filters)) {
        try {
          filterRow[field] = normalize(raw[field], sourceRule(entity.compare[field], config, source), source);
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
        const identity = readKey(entity, raw, source);
        key = identity.key;
        if (identity.parts) state.parts.set(key, identity.parts);
      } catch (error) {
        invalid(state, entity, source, '', keyFields(entity.key).join(', '), undefined, error);
        if (state.invalidRows.size > maxInvalidRows)
          throw new Error(`More than maxInvalidRows (${maxInvalidRows}) rows are invalid.`);
        continue;
      }
      const offsetFree = new Set(
        Object.entries(raw)
          .filter(
            ([field, value]) =>
              entity.compare[field]?.type === 'datetime' &&
              (typeof value === 'string'
                ? !/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)
                : value instanceof Date && Reflect.has(value, Symbol.for('logiparity.wallClock'))),
          )
          .map(([field]) => field),
      );
      state.offsetFree.set(key, offsetFree);
      const retainedUncertainty = state.rows.has(key) && !config.rollup ? new Set(state.uncertain.get(key)) : undefined;
      const row = normalizeRow(entity, source, raw, state, key);
      if (raw[sourceIssue]) {
        invalid(state, entity, source, key, '', undefined, raw[sourceIssue]);
        uncertain(state, key, Object.keys(row));
      }
      if (state.invalidRows.size > maxInvalidRows)
        throw new Error(`More than maxInvalidRows (${maxInvalidRows}) rows are invalid.`);
      if (
        !matchesFilter(row, config.where, entity, source) ||
        !matchesFilter(row, config.rollup?.where ?? {}, entity, source)
      )
        continue;
      state.count++;
      const rowNumbers = state.rowNumbers.get(key) ?? [];
      rowNumbers.push(state.position);
      state.rowNumbers.set(key, rowNumbers);
      recordRawTotals(entity, source, row, raw, state);
      const currencies = state.currencies.get(key) ?? new Map<string, string>();
      for (const [field, rule] of Object.entries(entity.compare))
        if (rule.type === 'money' && typeof row[field] === 'bigint') {
          const currency = rowCurrency(rule, config, raw),
            previous = currencies.get(field);
          if (previous && previous !== currency && config.rollup) {
            invalid(
              state,
              entity,
              source,
              key,
              field,
              row[field],
              new Error(
                `Currency ${currency} conflicts with ${previous} within this rollup key. Split the key by currency.`,
              ),
            );
            row[field] = null;
          } else if (!previous) currencies.set(field, currency);
        }
      state.currencies.set(key, currencies);
      if (state.rows.has(key) && !config.rollup) {
        state.uncertain.set(key, retainedUncertainty ?? new Set());
        state.issues.push({
          type: 'duplicate_key',
          ...identityFields(entity, key, state.parts.get(key)),
          source,
          field: keyFields(entity.key).join(', '),
          row: state.position,
          message: `Duplicate key ${keyText(key, state.parts.get(key))} at rows ${state.firstRows.get(key)} and ${state.position}; the first row counts once.`,
        });
        state.excludedRows.add(state.position);
        continue;
      }
      const included = rollUpRow(entity, source, config, key, row, state);
      if (!state.firstRows.has(key)) {
        state.firstRows.set(key, state.position);
        state.positions.set(key, records);
      }
      if (!included) state.excludedRows.add(state.position);
      if (included) state.rows.set(key, row);
      else if (!state.rows.has(key)) state.rows.set(key, row);
      if (state.invalidRows.size > maxInvalidRows)
        throw new Error(`More than maxInvalidRows (${maxInvalidRows}) rows are invalid.`);
    }
    if (records > 0 && state.count === 0 && !state.invalidRows.size) {
      report.warnings ??= [];
      report.warnings.push({
        entity: entity.name,
        source,
        message: `${entity.label ?? humanize(entity.name)} · ${config.label ?? humanize(source)}: All rows were filtered out. Check the where values and source export.`,
      });
    }
    checkUniqueness(entity, source, config, state);
    measureSource(entity, source, config, state);
    measureCurrencies(entity, source, config, state);
    return state;
  } catch (error) {
    const message = errorText(error);
    const prefix = [config.label ?? humanize(source), source].find((label) =>
      message.toLowerCase().startsWith(label.toLowerCase() + ': '),
    );
    const diagnostic = redactSecrets(prefix ? message.slice(prefix.length + 2) : message, secrets);
    for (const issue of state.issues) appendFinding(report, issue);
    appendFinding(report, {
      type: 'source_error',
      entity: entity.name,
      source,
      key: '',
      field: '',
      message:
        diagnostic +
        (diagnostic.includes('[REDACTED]') && /connection|refused|GET|timed/.test(diagnostic)
          ? ' For a public service URL, list its environment variable in publicEnv.'
          : ''),
      ...(error instanceof SourceError && error.screenshot ? { screenshot: error.screenshot } : {}),
    });
    return undefined;
  }
}
