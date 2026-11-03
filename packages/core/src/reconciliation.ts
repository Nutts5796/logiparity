import type { EntityConfig } from './config.js';
import type { SourceState, Row } from './source-state.js';
import type { AggregateResult, EntitySummary, Report } from './types.js';
import { matchesFilter } from './filters.js';

type Contribution = { key: string; amount: bigint; fields: string[] };
// Keep row-level attribution until group membership is known, without serializing
// internal source rows or retaining an entire second copy of the dataset.
const ledgers = new WeakMap<AggregateResult, Map<string, Contribution[]>>();
function contribution(
  entity: EntityConfig,
  aggregate: EntityConfig['aggregates'][number],
  row: Row | undefined,
  source: string,
): bigint {
  if (!row || !matchesFilter(row, aggregate.where, entity, source)) return 0n;
  if (aggregate.type === 'count') return 1n;
  const value = row[aggregate.field];
  return typeof value === 'bigint' ? value : 0n;
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
    if (definition.type === 'sum' && entity.compare[definition.field]?.type !== 'money') continue;
    const aggregate = summary.aggregates?.find((item) => item.name === definition.name);
    if (!aggregate || aggregate.values[source] === undefined || aggregate.values[reference] === undefined) continue;
    const currencies = new Set([
      ...Object.keys(aggregate.valuesByCurrency?.[source] ?? {}),
      ...Object.keys(aggregate.valuesByCurrency?.[reference] ?? {}),
    ]);
    if (
      currencies.size > 1 ||
      (currencies.size === 1 &&
        !currencies.has(entity.compare[definition.type === 'sum' ? definition.field : '']?.currency ?? 'USD'))
    )
      continue;
    const currentExcluded = current.excluded.get(definition.name) ?? new Set<string>();
    const baselineExcluded = baseline.excluded.get(definition.name) ?? new Set<string>();
    const missingRows = { count: 0, amount: 0n },
      extraRows = { count: 0, amount: 0n };
    let uncertain = 0n;
    const uncertainKeys = new Set<string>(),
      entries: Contribution[] = [];
    for (const key of new Set([...baseline.rows.keys(), ...current.rows.keys()])) {
      const expectedRow = baseline.rows.get(key),
        actualRow = current.rows.get(key);
      const expected = baselineExcluded.has(key) ? 0n : contribution(entity, definition, expectedRow, reference);
      const actual = currentExcluded.has(key) ? 0n : contribution(entity, definition, actualRow, source);
      const difference = actual - expected;
      if (currentExcluded.has(key) || baselineExcluded.has(key)) {
        uncertainKeys.add(key);
        uncertain += difference;
      } else if (!actualRow) {
        missingRows.amount += difference;
        if (expectedRow && matchesFilter(expectedRow, definition.where, entity, reference)) missingRows.count++;
      } else if (!expectedRow) {
        extraRows.amount += difference;
        if (matchesFilter(actualRow, definition.where, entity, source)) extraRows.count++;
      } else if (difference !== 0n) {
        const required = [...Object.keys(definition.where), ...(definition.type === 'sum' ? [definition.field] : [])];
        entries.push({
          key,
          amount: difference,
          fields: required.filter((field) => expectedRow[field] !== actualRow[field]),
        });
      }
    }
    const ledger = ledgers.get(aggregate) ?? new Map<string, Contribution[]>();
    ledger.set(source, entries);
    ledgers.set(aggregate, ledger);
    aggregate.reconciliation ??= {};
    aggregate.reconciliation[source] = {
      missingRows,
      extraRows,
      valueDifferences: { count: 0, amount: 0n },
      patterns: [],
      remainder: 0n,
      uncertain: {
        keys: [...uncertainKeys].map((key) => current.parts.get(key) ?? baseline.parts.get(key) ?? [key]),
        amount: uncertain,
      },
    };
  }
}
function attributeDifferences(report: Report, entity: EntityConfig, aggregate: AggregateResult, source: string): void {
  const parts = aggregate.reconciliation?.[source];
  if (!parts) return;
  const patterns = new Map<number, { group: number; count: number; amount: bigint }>();
  parts.valueDifferences = { count: 0, amount: 0n };
  for (const entry of ledgers.get(aggregate)?.get(source) ?? []) {
    const indexes = entry.fields.map((field) =>
      report.findings.findIndex(
        (finding) =>
          finding.entity === entity.name &&
          finding.source === source &&
          finding.key === entry.key &&
          finding.field === field &&
          finding.type === 'field_mismatch' &&
          !finding.reason,
      ),
    );
    // A tolerated or unlisted change has no supporting finding: retain the entire
    // contribution in the remainder rather than guessing a cause.
    if (!indexes.length || indexes.some((index) => index < 0)) continue;
    const group = (report.groups ?? []).findIndex(
      (item) => indexes.every((index) => item.findingIndexes?.includes(index)) && item.kind === 'money_delta',
    );
    if (group >= 0) {
      const part = patterns.get(group) ?? { group, count: 0, amount: 0n };
      part.count++;
      part.amount += entry.amount;
      patterns.set(group, part);
    } else {
      parts.valueDifferences.count++;
      parts.valueDifferences.amount = BigInt(parts.valueDifferences.amount) + entry.amount;
    }
  }
  parts.patterns = [...patterns.values()];
}
export function reconcileAggregates(report: Report, entities: readonly EntityConfig[]): void {
  for (const summary of report.entities) {
    const entity = entities.find((item) => item.name === summary.entity);
    if (!entity) continue;
    for (const aggregate of summary.aggregates ?? []) {
      for (const [source, parts] of Object.entries(aggregate.reconciliation ?? {})) {
        attributeDifferences(report, entity, aggregate, source);
        const actual = aggregate.values[source],
          expected = aggregate.values[summary.reference];
        if (actual === undefined || expected === undefined) continue;
        parts.remainder =
          BigInt(actual) -
          BigInt(expected) -
          BigInt(parts.missingRows.amount) -
          BigInt(parts.extraRows?.amount ?? 0) -
          BigInt(parts.valueDifferences?.amount ?? 0) -
          BigInt(parts.uncertain?.amount ?? 0) -
          parts.patterns.reduce((sum, item) => sum + BigInt(item.amount), 0n);
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
            item.entity === summary.entity &&
            item.source === source &&
            item.field === aggregate.name,
        );
        if (finding && BigInt(parts.remainder) === 0n) finding.accounting = { causes: parts.causes, remainder: '0' };
      }
    }
  }
}
