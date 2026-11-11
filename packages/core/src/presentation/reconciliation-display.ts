import { reportLabels, uncertainKeyText } from './labels.js';
import { formatMoneyMajor, type ReportPresentation } from './money-display.js';
import type { Report, AggregateReconciliation } from '../foundation/types.js';
import { displayDecimal, sumDecimal } from '../values/aggregates.js';

export function reconciliationDetails(
  report: Report,
  presentation: ReportPresentation = {},
  onlyEntity?: string,
): string[] {
  const labels = reportLabels(presentation),
    lines: string[] = [];
  for (const entity of report.entities) {
    if (onlyEntity && entity.entity !== onlyEntity) continue;
    for (const aggregate of entity.aggregates ?? [])
      for (const [source, value] of Object.entries(
        aggregate.reconciliationByCurrency ?? aggregate.reconciliation ?? {},
      )) {
        const partitions = aggregate.reconciliationByCurrency
          ? Object.entries(value).map(([currency, parts]) => ({ currency, parts: parts as AggregateReconciliation }))
          : [{ currency: undefined, parts: value as AggregateReconciliation }];
        for (const { currency, parts } of partitions) {
          const actual = currency
            ? (aggregate.valuesByCurrency?.[source]?.[currency] ?? 0)
            : (aggregate.exactValues?.[source] ?? aggregate.values[source]);
          const expected = currency
            ? (aggregate.valuesByCurrency?.[entity.reference]?.[currency] ?? 0)
            : (aggregate.exactValues?.[entity.reference] ?? aggregate.values[entity.reference]);
          if (
            actual === undefined ||
            expected === undefined ||
            (sumDecimal(actual) === sumDecimal(expected) &&
              !parts.uncertain?.keys.length &&
              !parts.missingRows.count &&
              !parts.extraRows?.count)
          )
            continue;
          const amount = (value: bigint | string) => {
            const n = sumDecimal(value);
            return `${n !== '0' && !n.startsWith('-') ? '+' : ''}${currency ? formatMoneyMajor(BigInt(n), currency) : displayDecimal(n)}`;
          };
          const components = [
            `Missing rows (${parts.missingRows.count.toLocaleString('en-US')}): ${amount(parts.missingRows.amount)}`,
            `Extra rows (${(parts.extraRows?.count ?? 0).toLocaleString('en-US')}): ${amount(parts.extraRows?.amount ?? 0n)}`,
            `Value differences (${(parts.valueDifferences?.count ?? 0).toLocaleString('en-US')}): ${amount(parts.valueDifferences?.amount ?? 0n)}`,
            ...parts.patterns.map(
              (p) =>
                `${BigInt(report.groups?.[p.group]?.delta ?? 0) >= -3n && BigInt(report.groups?.[p.group]?.delta ?? 0) <= 3n ? 'Rounding' : 'Fixed differences'} (${p.count.toLocaleString('en-US')}): ${amount(p.amount)}`,
            ),
            ...(parts.uncertain?.keys.length
              ? [
                  `Uncertain lines: ${uncertainKeyText(parts.uncertain.keys)}; contribution ${amount(parts.uncertain.amount)}`,
                ]
              : []),
            `Unexplained remainder: ${amount(parts.remainder)}`,
          ];
          lines.push(
            `${labels.field(entity.entity, aggregate.name, true)} · ${labels.source(entity.entity, source)}${currency ? ' (' + currency + ')' : ''}: ${components.join('; ')}.`,
          );
        }
      }
  }
  return lines;
}
