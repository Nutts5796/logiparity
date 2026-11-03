import type { EntityConfig } from './config.js';
import type { SourceState, Row } from './source-state.js';
import type { AggregateResult, EntitySummary, Report } from './types.js';
import { matchesFilter } from './filters.js';
import { keyText } from './keys.js';

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
    const currentExcluded = current.excluded.get(definition.name) ?? new Set<string>();
    const baselineExcluded = baseline.excluded.get(definition.name) ?? new Set<string>();
    let missing = 0n,
      missingCount = 0,
      uncertain = 0n;
    const uncertainKeys = new Set<string>();
    for (const [key, row] of baseline.rows) {
      if (currentExcluded.has(key) || baselineExcluded.has(key)) {
        uncertainKeys.add(key);
        if (!baselineExcluded.has(key)) uncertain -= contribution(entity, definition, row, reference);
        if (!currentExcluded.has(key)) uncertain += contribution(entity, definition, current.rows.get(key), source);
      } else if (!current.rows.has(key)) {
        const amount = contribution(entity, definition, row, reference);
        missing -= amount;
        if (amount !== 0n || definition.type === 'sum') missingCount++;
      }
    }
    for (const key of currentExcluded) uncertainKeys.add(key);
    aggregate.reconciliation ??= {};
    aggregate.reconciliation[source] = {
      missingRows: { count: missingCount, amount: missing },
      patterns: [],
      remainder: 0n,
      uncertain: {
        keys: [...uncertainKeys].map((key) => keyText(key, current.parts.get(key) ?? baseline.parts.get(key))),
        amount: uncertain,
      },
    };
  }
}
function applyPatternParts(
  report: Report,
  entity: EntityConfig,
  aggregate: AggregateResult,
  field: string,
  source: string,
): void {
  const reconciliation = aggregate.reconciliation?.[source];
  if (!reconciliation) return;
  reconciliation.patterns = (report.groups ?? []).flatMap((group, index) =>
    group.entity === entity.name && group.source === source && group.field === field && group.kind === 'money_delta'
      ? [
          {
            group: index,
            count: group.findingIndexes?.length ?? 0,
            amount: BigInt(group.delta ?? 0) * BigInt(group.findingIndexes?.length ?? 0),
          },
        ]
      : [],
  );
}
export function reconcileAggregates(report: Report, entities: readonly EntityConfig[]): void {
  for (const summary of report.entities) {
    const entity = entities.find((item) => item.name === summary.entity);
    if (!entity) continue;
    for (const aggregate of summary.aggregates ?? []) {
      const definition = entity.aggregates.find((item) => item.name === aggregate.name);
      if (!definition) continue;
      for (const [source, parts] of Object.entries(aggregate.reconciliation ?? {})) {
        if (definition.type === 'sum') applyPatternParts(report, entity, aggregate, definition.field, source);
        const actual = aggregate.values[source],
          expected = aggregate.values[summary.reference];
        if (actual === undefined || expected === undefined) continue;
        parts.remainder =
          BigInt(actual) -
          BigInt(expected) -
          BigInt(parts.missingRows.amount) -
          BigInt(parts.uncertain?.amount ?? 0) -
          parts.patterns.reduce((sum, item) => sum + BigInt(item.amount), 0n);
        parts.causes = [
          ...(BigInt(parts.missingRows.amount) !== 0n ? ['missing rows'] : []),
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
        if (finding && BigInt(parts.remainder) === 0n && !parts.uncertain?.keys.length)
          finding.accounting = { causes: parts.causes, remainder: '0' };
      }
    }
  }
}
