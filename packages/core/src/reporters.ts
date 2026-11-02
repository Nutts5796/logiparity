import { safeConsole } from './diagnostics.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorText, type Config } from './config.js';
import type { Report } from './types.js';
import { reportGroups } from './groups.js';
import { displayValue } from './report-utils.js';
import { formatDatetimeUtc } from './money-display.js';
import { isBlocking } from './policy.js';
import { htmlReport } from './html.js';
import { junitReport } from './junit.js';
import { markdownReport } from './markdown.js';
import type { ReportPresentation } from './money-display.js';

export function reportExitCode(report: Report): 0 | 1 | 2 {
  return report.findings.some((f) => f.type === 'source_error') ? 2 : report.findings.some(isBlocking) ? 1 : 0;
}

export function jsonReport(report: Report): string {
  return JSON.stringify({ ...report, groups: report.groups ?? [] }, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
}

export function consoleReport(report: Report, presentation: ReportPresentation = {}): string {
  const counts = new Map<string, number>();
  for (const f of report.findings) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  const lines = [`LogiParity: ${report.entities.length} entities, ${report.findings.length} findings (${report.findings.filter(isBlocking).length} blocking)`];
  for (const [type, count] of [...counts].sort(([a], [b]) => a < b ? -1 : 1)) lines.push(`  ${type}: ${count}`);
  for (const group of reportGroups(report, presentation)) lines.push(`  [pattern] ${group.entity}/${group.source}/${group.field}: ${group.summary}`);
  const value = (input: import('./types.js').NormalizedValue | undefined, entity: string, field: string): string => {
    const rule = presentation.entities?.find((e) => e.name === entity)?.compare[field];
    const iso = rule?.type === 'datetime' && typeof input === 'number' ? formatDatetimeUtc(input) : undefined;
    return iso ? `${displayValue(input)} (${iso})` : displayValue(input);
  };
  for (const f of report.findings.slice(0, 10)) lines.push(`  [${f.type}${isBlocking(f) ? '' : '; allowed'}] ${f.entity}/${f.source} key=${f.key || '-'} field=${f.field || '-'}: ${f.message}${f.expected !== undefined ? ` Expected=${value(f.expected, f.entity, f.field)} Actual=${value(f.actual, f.entity, f.field)}` : ''}`);
  if (report.findings.length > 10) lines.push(`  ... ${report.findings.length - 10} more findings.`);
  return safeConsole(lines.join('\n') + '\n');
}

export async function writeJsonReport(report: Report, directory: string): Promise<void> {
  await writeReports(report, directory, ['json']);
}

export async function writeReports(report: Report, directory: string, outputs: Config['report']['outputs'], presentation: ReportPresentation = {}): Promise<void> {
  const formats = { json: ['report.json', jsonReport], html: ['report.html', (r: Report) => htmlReport(r, presentation)], junit: ['junit.xml', junitReport], markdown: ['report.md', (r: Report) => markdownReport(r, presentation)] } as const;
  for (const output of new Set(outputs)) {
    if (output === 'console') continue;
    const [file, render] = formats[output];
    const destination = join(directory, file);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(destination, render(report), 'utf8');
    } catch (error) { throw new Error(`Cannot write ${output} report to ${destination}: ${errorText(error)} Check report.dir and write permissions.`); }
  }
}

export { htmlReport, junitReport, markdownReport };
