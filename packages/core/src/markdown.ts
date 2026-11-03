import { redactTree, secretValues } from './diagnostics.js';
import { aggregateDisplay, rawAggregateDisplay } from './money-display.js';
import { reportGroups, groupMembership, accountedFindingIndexes } from './groups.js';
import { verdict } from './report-utils.js';
import { reportLabels } from './labels.js';
import { humanFinding, reportCounts, quantity, typeLabels, mergedPatternWords, markdownCell as cell } from './human.js';
import { presentationDifference, type ReportPresentation } from './money-display.js';
import type { Report, Finding } from './types.js';
const row = (finding: Finding, presentation: ReportPresentation) => {
  const item = humanFinding(finding, presentation);
  return `| ${[item.key, item.source, item.field, item.reference, item.sourceValue, item.difference, finding.accounting ? `Follows from: ${finding.accounting.causes.join(', ')}` : item.details || item.type].map(cell).join(' | ')} |`;
};
export function markdownReport(report: Report, presentation: ReportPresentation = {}): string {
  const secrets = secretValues(presentation.entities);
  report = redactTree(report, secrets);
  presentation = redactTree(presentation, secrets);
  const counts = reportCounts(report),
    labels = reportLabels(presentation);
  const lines = [
    '# LogiParity report',
    '',
    `**${verdict(report)}** · ${quantity(counts.findings, 'finding')} · ${quantity(counts.blocking, 'blocking finding')} · ${quantity(counts.errors, 'source error')} · ${quantity(counts.warnings, 'warning')}`,
    '',
    'Dates use ' +
      (presentation.displayTimezone ?? 'UTC') +
      '. Amounts use their configured currency. JSON retains normalized values.',
    '',
  ];
  if (report.findings.length) lines.push('| Finding | Count |', '| --- | ---: |');
  for (const [type, label] of Object.entries(typeLabels)) {
    const count = report.findings.filter((finding) => finding.type === type).length;
    if (count) lines.push(`| ${label} | ${count.toLocaleString('en-US')} |`);
  }
  if (report.warnings?.length) {
    lines.push('', '## Warnings', '');
    for (const warning of report.warnings) lines.push(`- ${cell(warning.message)}`);
  }
  const groups = reportGroups(report, presentation),
    members = groupMembership(report, presentation),
    accounted = accountedFindingIndexes(report, presentation);
  if (groups.length) {
    lines.push('', '## Causes to investigate', '');
    for (const words of mergedPatternWords(groups, presentation)) {
      lines.push(`- ${cell(words.sentence)} ${cell(words.hint)}`, `  Next step: ${cell(words.nextStep)}`);
    }
  }
  const totals = report.entities.flatMap((entity) =>
    (entity.aggregates ?? []).map((aggregate) => ({ entity, ...aggregate })),
  );
  if (totals.length) {
    lines.push(
      '',
      '## Totals',
      '',
      '| Total | Source | Value | Difference | Status |',
      '| --- | --- | ---: | ---: | --- |',
    );
    for (const { entity, ...aggregate } of totals) {
      const sources = Object.keys(labels.entity(entity.entity)?.sources ?? entity.counts);
      for (const source of sources) {
        const value = aggregate.values[source],
          status = aggregate.sourceStatus?.[source];
        const shown =
          status === 'not_mapped'
            ? 'Not mapped'
            : value === undefined
              ? 'Not read'
              : aggregateDisplay(aggregate, source, entity.entity, presentation);
        const baseline = aggregate.values[entity.reference];
        const difference =
          source !== entity.reference && baseline !== undefined && value !== undefined
            ? presentationDifference(baseline, value, entity.entity, aggregate.name, true, presentation)
            : '—';
        const accounted =
          aggregate.reconciliation?.[source]?.remainder === 0n || aggregate.reconciliation?.[source]?.remainder === '0';
        const uncertain = aggregate.uncertainKeys?.[source];
        const raw = rawAggregateDisplay(aggregate, source, entity.entity, presentation);
        const retained = raw
          ? ` Raw source: ${raw}; retained/certain lines above. Excluded rows: ${(aggregate.excludedRows?.[source] ?? []).join(', ') || 'none'}.`
          : '';
        lines.push(
          `| ${cell(labels.field(entity.entity, aggregate.name, true))} | ${cell(labels.source(entity.entity, source))} | ${cell(shown + retained)} | ${cell(difference)} | ${uncertain?.length ? cell('Uncertain lines: ' + uncertain.join(', ')) : source === entity.reference ? 'Reference' : accounted ? 'Accounted for' : value === baseline ? 'Matches' : status === 'not_mapped' ? 'Not mapped' : 'Needs review'} |`,
        );
      }
    }
  }
  const unexplained = report.findings.filter((_, index) => !accounted.has(index));
  if (unexplained.length) {
    lines.push(
      '',
      '## Needs review',
      '',
      '| Key | Source | Field | Reference | Source value | Difference | Details |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const finding of unexplained.slice(0, 50)) lines.push(row(finding, presentation));
    if (unexplained.length > 50)
      lines.push(
        '',
        `${quantity(unexplained.length - 50, 'additional finding')} require review in the complete HTML or JSON report.`,
      );
  }
  if (groups.length) {
    lines.push(
      '',
      '## One example per cause',
      '',
      '| Key | Source | Field | Reference | Source value | Difference | Details |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    const shownCauses = new Set<string>();
    for (const [index, indexes] of members.entries()) {
      const group = groups[index];
      const identity = JSON.stringify(
        group && [
          group.entity,
          group.kind,
          group.field,
          group.delta,
          group.stride,
          group.currency,
          group.expected,
          group.actual,
          group.cause,
        ],
        (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value),
      );
      if (shownCauses.has(identity)) continue;
      shownCauses.add(identity);
      const finding = report.findings[indexes[0] ?? -1];
      if (finding) lines.push(row(finding, presentation));
    }
  }
  const follows = report.findings.filter((finding) => finding.accounting);
  if (follows.length) {
    lines.push('', '## Accounted for totals', '');
    for (const finding of follows)
      lines.push(
        `- ${cell(labels.field(finding.entity, finding.field, true))}, ${cell(labels.source(finding.entity, finding.source))}: ${cell(humanFinding(finding, presentation).difference)}. Follows from: ${cell(finding.accounting?.causes.join(', ') ?? '')}.`,
      );
    lines.push('', 'Accounted for means each difference is traced to a cause above. Each cause still needs a fix.');
  }
  return lines.join('\n') + '\n';
}
