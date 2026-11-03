import type { EntityConfig, SourceConfig, ComparisonRule } from './config.js';
import type { Row, SourceState } from './source-state.js';
import { DecimalSum } from './aggregates.js';
import { matchesFilter } from './filters.js';

export function rowCurrency(rule: ComparisonRule, config: SourceConfig, row: Record<string, unknown>): string {
  const field = rule.currencyField ?? config.currencyField;
  if (!field) return rule.currency ?? 'USD';
  const value = String(row[field] ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) throw new Error(`Currency field ${field} must contain a three-letter currency code.`);
  return value;
}
export function recordRawTotals(
  entity: EntityConfig,
  source: string,
  row: Row,
  raw: Record<string, unknown>,
  state: SourceState,
): void {
  const config = entity.sources[source];
  if (!config) return;
  for (const aggregate of entity.aggregates) {
    if (!matchesFilter(row, aggregate.where, entity, source)) continue;
    const qualifying = state.qualifyingRows.get(aggregate.name) ?? new Set<number>();
    qualifying.add(state.position);
    state.qualifyingRows.set(aggregate.name, qualifying);
    if (aggregate.type === 'count') {
      state.rawMeasurements.set(aggregate.name, Number(state.rawMeasurements.get(aggregate.name) ?? 0) + 1);
      continue;
    }
    const value = row[aggregate.field];
    if (typeof value === 'bigint') {
      const rule = entity.compare[aggregate.field];
      if (!rule) continue;
      const currency = rowCurrency(rule, config, raw);
      const values = state.rawCurrencies.get(aggregate.name) ?? {};
      values[currency] = (values[currency] ?? 0n) + value;
      state.rawCurrencies.set(aggregate.name, values);
      state.rawMeasurements.set(aggregate.name, values[rule.currency ?? 'USD'] ?? 0n);
    } else if (typeof value === 'number') {
      const sum = state.rawSums.get(aggregate.name) ?? new DecimalSum();
      sum.add(value);
      state.rawSums.set(aggregate.name, sum);
      state.rawMeasurements.set(aggregate.name, sum.value());
    }
  }
}
export function measureCurrencies(
  entity: EntityConfig,
  source: string,
  config: SourceConfig,
  state: SourceState,
): void {
  for (const aggregate of entity.aggregates) {
    if (
      aggregate.type !== 'sum' ||
      entity.compare[aggregate.field]?.type !== 'money' ||
      !Object.hasOwn(config.fields, aggregate.field)
    )
      continue;
    if (state.measurements.get(aggregate.name) === undefined) continue;
    const values: Record<string, bigint> = {};
    for (const [key, row] of state.rows) {
      if (state.excluded.get(aggregate.name)?.has(key) || !matchesFilter(row, aggregate.where, entity, source))
        continue;
      const value = row[aggregate.field],
        currency = state.currencies.get(key)?.get(aggregate.field);
      if (typeof value === 'bigint' && currency) values[currency] = (values[currency] ?? 0n) + value;
    }
    state.currencyMeasurements.set(aggregate.name, values);
    state.measurements.set(aggregate.name, values[entity.compare[aggregate.field]?.currency ?? 'USD'] ?? 0n);
  }
}
