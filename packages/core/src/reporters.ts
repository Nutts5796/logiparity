import { aggregateDisplay, rawAggregateDisplay } from './money-display.js';
import { safeConsole, redactTree, secretValues } from './diagnostics.js';
import { atomicReportFile } from './atomic-file.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { reportLabels } from './labels.js';
import { errorText, type Config } from './config.js';
import type { Report } from './types.js';
import { reportGroups, presentationFindings } from './groups.js';
import { humanFinding, reportCounts, quantity, mergedPatternWords, typeLabels } from './human.js';
import { isBlocking } from './policy.js';
import { htmlReport } from './html.js';
import { junitReport } from './junit.js';
import { markdownReport } from './markdown.js';
import type { ReportPresentation } from './money-display.js';

export function reportExitCode(report: Report): 0 | 1 | 2 {
  return report.findings.some((f) => f.type === 'source_error') ? 2 : report.findings.some(isBlocking) ? 1 : 0;
}

export function jsonReport(report: Report): string {
  report = redactTree(report, secretValues(report));
  return (
    JSON.stringify(
      { ...report, groups: report.groups ?? [] },
      (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ) + '\n'
  );
}

export function consoleReport(report: Report, presentation: ReportPresentation = {}): string {
  const secrets = secretValues(presentation.entities);
  report = redactTree(report, secrets);
  presentation = redactTree(presentation, secrets);
  const counts = reportCounts(report);
  const labels = reportLabels(presentation);
  const lines = [
    `LogiParity: ${quantity(counts.findings, 'finding')} (${quantity(counts.blocking, 'blocking finding')}), ${quantity(counts.errors, 'source error')}, ${quantity(counts.warnings, 'warning')}`,
  ];
  for (const warning of report.warnings ?? []) lines.push(`  Warning: ${warning.message}`);
  for (const [type, label] of Object.entries(typeLabels)) {
    const count = report.findings.filter((finding) => finding.type === type).length;
    if (count) lines.push(`  ${label}: ${count.toLocaleString('en-US')}`);
  }
  for (const words of mergedPatternWords(reportGroups(report, presentation), presentation)) {
    lines.push(`  ${words.sentence} ${words.hint}`, `  Next step: ${words.nextStep}`);
  }
  for (const entity of report.entities)
    for (const aggregate of entity.aggregates ?? [])
      for (const source of Object.keys(aggregate.values)) {
        const raw = rawAggregateDisplay(aggregate, source, entity.entity, presentation);
        if (raw)
          lines.push(
            `  ${labels.field(entity.entity, aggregate.name, true)} · ${labels.source(entity.entity, source)}: raw source ${raw}; retained/certain lines ${aggregateDisplay(aggregate, source, entity.entity, presentation)}; excluded rows ${(aggregate.excludedRows?.[source] ?? []).join(', ') || 'none'}.`,
          );
      }
  for (const finding of presentationFindings(report, presentation).slice(0, 10)) {
    const item = humanFinding(finding, presentation);
    const detail =
      finding.type === 'source_error'
        ? item.details
        : `Reference: ${item.reference}; Source value: ${item.sourceValue}; Difference: ${item.difference}${item.details ? `; ${item.details}` : ''}`;
    lines.push(
      (finding.type === 'source_error'
        ? `  ${item.source}: ${detail}`
        : `  ${item.key} · ${item.source} · ${item.field}: ${detail}`
      )
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n'),
    );
  }
  if (report.findings.length > 10)
    lines.push(
      `  ${quantity(report.findings.length - 10, 'additional result')} not shown. Write the complete report with report.outputs: [console, html, json].`,
    );
  return safeConsole(lines.join('\n') + '\n');
}

export async function writeJsonReport(report: Report, directory: string): Promise<void> {
  await writeReports(report, directory, ['json']);
}

export async function writeReports(
  report: Report,
  directory: string,
  outputs: Config['report']['outputs'],
  presentation: ReportPresentation = {},
): Promise<void> {
  const formats = {
    json: ['report.json', jsonReport],
    html: ['report.html', (r: Report) => htmlReport(r, presentation)],
    junit: ['junit.xml', (r: Report) => junitReport(r, new Date(), presentation)],
    markdown: ['report.md', (r: Report) => markdownReport(r, presentation)],
  } as const;
  for (const output of new Set(outputs)) {
    if (output === 'console') continue;
    const [file, render] = formats[output];
    const destination = join(directory, file);
    try {
      await mkdir(directory, { recursive: true });
      await atomicReportFile(destination, render(report), { mode: presentation.fileMode ?? 0o600 });
    } catch (error) {
      throw new Error(
        `Cannot write ${output} report to ${destination}: ${errorText(error)} Check report.dir and write permissions.`,
      );
    }
  }
}

export { htmlReport, junitReport, markdownReport };
