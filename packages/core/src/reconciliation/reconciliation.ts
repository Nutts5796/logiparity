import type { EntityConfig } from '../configuration/config.js';
import type { SourceState, Row } from '../matching/source-state.js';
import type { AggregateResult, AggregateReconciliation, EntitySummary, Report } from '../foundation/types.js';
import { matchesFilter } from '../values/filters.js';
import { negateDecimal, sumDecimal } from '../values/aggregates.js';

type Amount = bigint | string;
const sum = (...values: Amount[]): Amount =>
  values.every((v) => typeof v === 'bigint') ? (values as bigint[]).reduce((a, b) => a + b, 0n) : sumDecimal(...values);
const zero = (value: Amount) => sumDecimal(value) === '0';
type Contribution = { key: string; amount: Amount; fields: string[] };
const ledgers = new WeakMap<AggregateReconciliation, Contribution[]>();
function contributes(
  entity: EntityConfig,
  definition: EntityConfig['aggregates'][number],
  row: Row | undefined,
  source: string,
): row is Row {
  return !!row && matchesFilter(row, definition.where, entity, source);
}
function contribution(
  entity: EntityConfig,
  definition: EntityConfig['aggregates'][number],
  state: SourceState,
  key: string,
  source: string,
  currency?: string,
): Amount {
  const row = state.rows.get(key);
  if (!contributes(entity, definition, row, source) || state.excluded.get(definition.name)?.has(key)) return 0n;
  if (definition.type === 'count') return 1n;
  if (currency && state.currencies.get(key)?.get(definition.field) !== currency) return 0n;
  const value = row[definition.field];
  return typeof value === 'bigint' ? value : typeof value === 'number' ? sumDecimal(value) : 0n;
}
function collectBucket(
  entity: EntityConfig,
  definition: EntityConfig['aggregates'][number],
  baseline: SourceState,
  current: SourceState,
  source: string,
  reference: string,
  currency?: string,
): AggregateReconciliation {
  const parts: AggregateReconciliation = {
    missingRows: { count: 0, amount: 0n },
    extraRows: { count: 0, amount: 0n },
    valueDifferences: { count: 0, amount: 0n },
    patterns: [],
    remainder: 0n,
    uncertain: { keys: [], amount: 0n },
  };
  const entries: Contribution[] = [];
  for (const key of new Set([...baseline.rows.keys(), ...current.rows.keys()])) {
    const expectedRow = baseline.rows.get(key),
      actualRow = current.rows.get(key);
    const expected = contribution(entity, definition, baseline, key, reference, currency);
    const actual = contribution(entity, definition, current, key, source, currency);
    if (currency && definition.type === 'sum') {
      const code = (state: SourceState, row: Row | undefined, name: string) => {
        const known = state.currencies.get(key)?.get(definition.field);
        if (known) return known;
        if (!row) return undefined;
        const rule = entity.compare[definition.field],
          field = rule?.currencyField ?? entity.sources[name]?.currencyField;
        const value = field ? row[field] : rule?.currency;
        return typeof value === 'string' && /^[A-Z]{3}$/i.test(value) ? value.toUpperCase() : undefined;
      };
      const codes = [code(baseline, expectedRow, reference), code(current, actualRow, source)].filter(Boolean);
      if (codes.length && codes.every((code) => code !== currency)) continue;
    }
    const difference = sum(actual, negateDecimal(expected));
    if (current.excluded.get(definition.name)?.has(key) || baseline.excluded.get(definition.name)?.has(key)) {
      parts.uncertain?.keys.push(current.parts.get(key) ?? baseline.parts.get(key) ?? [key]);
      if (parts.uncertain) parts.uncertain.amount = sum(parts.uncertain.amount, difference);
    } else if (!actualRow) {
      parts.missingRows.amount = sum(parts.missingRows.amount, difference);
      if (!zero(expected)) parts.missingRows.count++;
    } else if (!expectedRow) {
      if (parts.extraRows) {
        parts.extraRows.amount = sum(parts.extraRows.amount, difference);
        if (!zero(actual)) parts.extraRows.count++;
      }
    } else if (!zero(difference)) {
      const moved =
        contributes(entity, definition, expectedRow, reference) !== contributes(entity, definition, actualRow, source);
      const currencyField =
        definition.type === 'sum'
          ? (entity.compare[definition.field]?.currencyField ??
            entity.sources[source]?.currencyField ??
            entity.sources[reference]?.currencyField)
          : undefined;
      const changedCurrency =
        currencyField &&
        baseline.currencies.get(key)?.get(definition.type === 'sum' ? definition.field : '') !==
          current.currencies.get(key)?.get(definition.type === 'sum' ? definition.field : '');
      // Membership changes explain the whole included/excluded amount, including
      // tolerated amount changes. Otherwise every changed amount needs evidence.
      const required = changedCurrency
        ? [currencyField]
        : moved
          ? Object.keys(definition.where)
          : definition.type === 'sum'
            ? [definition.field]
            : [];
      entries.push({
        key,
        amount: difference,
        fields: required.filter((field) => expectedRow[field] !== actualRow[field]),
      });
    }
  }
  ledgers.set(parts, entries);
  return parts;
}
export function collectReconciliation(
  entity: EntityConfig,
  baseline: SourceState,
  current: SourceState,
  source: string,
  reference: string,
  summary: EntitySummary,
): void {
  for (const definition of entity.aggregates) {
    const aggregate = summary.aggregates?.find((item) => item.name === definition.name);
    if (!aggregate || aggregate.values[source] === undefined || aggregate.values[reference] === undefined) continue;
    aggregate.reconciliation ??= {};
    const currencies = Object.keys({
      ...aggregate.valuesByCurrency?.[source],
      ...aggregate.valuesByCurrency?.[reference],
    }).sort();
    if (!currencies.length) {
      aggregate.reconciliation[source] = collectBucket(entity, definition, baseline, current, source, reference);
      continue;
    }
    aggregate.reconciliationByCurrency ??= {};
    const buckets: Record<string, AggregateReconciliation> = {};
    for (const currency of currencies)
      buckets[currency] = collectBucket(entity, definition, baseline, current, source, reference, currency);
    aggregate.reconciliationByCurrency[source] = buckets;
    const defaultCurrency = definition.type === 'sum' ? (entity.compare[definition.field]?.currency ?? 'USD') : 'USD';
    const primary = buckets[defaultCurrency];
    if (primary) aggregate.reconciliation[source] = primary;
  }
}
function attributeDifferences(
  report: Report,
  entity: EntityConfig,
  parts: AggregateReconciliation,
  source: string,
): void {
  const patterns = new Map<number, { group: number; count: number; amount: Amount }>();
  parts.valueDifferences = { count: 0, amount: 0n };
  for (const entry of ledgers.get(parts) ?? []) {
    const indexes = entry.fields.map((field) =>
      report.findings.findIndex(
        (finding) =>
          finding.entity === entity.name &&
          finding.source === source &&
          finding.key === entry.key &&
          finding.field === field &&
          finding.type === 'field_mismatch' &&
          (!finding.reason || finding.reason === 'currency_mismatch'),
      ),
    );
    if (!indexes.length || indexes.some((index) => index < 0)) continue;
    const group = (report.groups ?? []).findIndex(
      (item) => indexes.every((index) => item.findingIndexes?.includes(index)) && item.kind === 'money_delta',
    );
    if (group >= 0) {
      const part = patterns.get(group) ?? { group, count: 0, amount: 0n };
      part.count++;
      part.amount = sum(part.amount, entry.amount);
      patterns.set(group, part);
    } else {
      parts.valueDifferences.count++;
      parts.valueDifferences.amount = sum(parts.valueDifferences.amount, entry.amount);
    }
  }
  parts.patterns = [...patterns.values()];
}
function reconcileBucket(
  report: Report,
  entity: EntityConfig,
  aggregate: AggregateResult,
  source: string,
  reference: string,
  parts: AggregateReconciliation,
  currency?: string,
): void {
  attributeDifferences(report, entity, parts, source);
  const actual = currency
    ? (aggregate.valuesByCurrency?.[source]?.[currency] ?? 0)
    : (aggregate.exactValues?.[source] ?? aggregate.values[source]);
  const expected = currency
    ? (aggregate.valuesByCurrency?.[reference]?.[currency] ?? 0)
    : (aggregate.exactValues?.[reference] ?? aggregate.values[reference]);
  if (actual === undefined || expected === undefined) return;
  const numeric = entity.aggregates.some(
    (d) => d.name === aggregate.name && d.type === 'sum' && entity.compare[d.field]?.type === 'number',
  );
  const remainder = sumDecimal(
    String(actual),
    negateDecimal(String(expected)),
    ...[
      parts.missingRows.amount,
      parts.extraRows?.amount ?? 0n,
      parts.valueDifferences?.amount ?? 0n,
      parts.uncertain?.amount ?? 0n,
      ...parts.patterns.map((p) => p.amount),
    ].map(negateDecimal),
  );
  parts.remainder = numeric ? remainder : BigInt(remainder);
  parts.causes = [
    ...(parts.missingRows.count ? ['missing rows'] : []),
    ...(parts.extraRows?.count ? ['extra rows'] : []),
    ...(parts.valueDifferences?.count ? ['value differences'] : []),
    ...new Set(
      parts.patterns.map((part) => {
        const delta = BigInt(report.groups?.[part.group]?.delta ?? 0);
        return delta >= -3n && delta <= 3n ? 'rounding' : 'fixed differences';
      }),
    ),
    ...(parts.uncertain?.keys.length ? ['uncertain lines'] : []),
  ];
  const finding = report.findings.find(
    (item) =>
      item.type === 'aggregate_mismatch' &&
      item.entity === entity.name &&
      item.source === source &&
      item.field === aggregate.name &&
      item.currency === currency,
  );
  if (finding && zero(parts.remainder) && !parts.uncertain?.keys.length)
    finding.accounting = { causes: parts.causes, remainder: '0' };
}
export function reconcileAggregates(report: Report, entities: readonly EntityConfig[]): void {
  for (const summary of report.entities) {
    const entity = entities.find((item) => item.name === summary.entity);
    if (!entity) continue;
    for (const aggregate of summary.aggregates ?? []) {
      for (const [source, parts] of Object.entries(aggregate.reconciliation ?? {})) {
        if (!aggregate.reconciliationByCurrency?.[source])
          reconcileBucket(report, entity, aggregate, source, summary.reference, parts);
      }
      for (const [source, buckets] of Object.entries(aggregate.reconciliationByCurrency ?? {}))
        for (const [currency, parts] of Object.entries(buckets))
          reconcileBucket(report, entity, aggregate, source, summary.reference, parts, currency);
    }
  }
}
