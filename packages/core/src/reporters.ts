import { safeConsole } from './diagnostics.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorText, type Config } from './config.js';
import type { Report } from './types.js';
import { reportGroups, presentationFindings } from './groups.js';
import { displayValue } from './report-utils.js';
import { formatDatetimeUtc, formatMoneyMajor, moneyUnits } from './money-display.js';
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
  const findings = report.findings.filter((f) => f.type !== 'source_error');
  const errors = report.findings.length - findings.length;
  const lines = [`LogiParity: ${report.entities.length} ${report.entities.length === 1 ? 'entity' : 'entities'}, ${findings.length} ${findings.length === 1 ? 'finding' : 'findings'} (${findings.filter(isBlocking).length} blocking)${report.warnings?.length ? `, ${report.warnings.length} ${report.warnings.length===1?'warning':'warnings'}` : ''}${errors ? `, ${errors} configuration/source ${errors === 1 ? 'error' : 'errors'}` : ''}`];
  for(const warning of report.warnings??[])lines.push(`  [warning] ${warning.message}`);
  for (const [type, count] of [...counts].sort(([a], [b]) => a < b ? -1 : 1)) lines.push(`  ${type}: ${count}`);
  for (const group of reportGroups(report, presentation)) lines.push(`  [pattern] ${[group.entity, group.source, group.field].filter(Boolean).join('/') }: ${group.summary}`);
  const value = (input: import('./types.js').NormalizedValue | undefined, entity: string, field: string, aggregate: boolean): string => {
    const definition = presentation.entities?.find((e) => e.name === entity);
    const sum = aggregate ? definition?.aggregates.find((a) => a.name === field) : undefined;
    const rule = definition?.compare[sum?.type === 'sum' ? sum.field : field];
    const iso = rule?.type === 'datetime' && typeof input === 'number' ? formatDatetimeUtc(input) : undefined;
    if (rule?.type === 'money' && rule.currency && (typeof input === 'bigint' || typeof input === 'string' && /^-?\d+$/.test(input))) return `${formatMoneyMajor(BigInt(input), rule.currency, rule.locale)} (${moneyUnits(BigInt(input), rule.currency)})`;
    return iso ? `${displayValue(input)} (${iso})` : displayValue(input);
  };
  for (const f of presentationFindings(report,presentation).slice(0, 10)) lines.push(`  [${f.type}${isBlocking(f) ? '' : '; allowed'}] ${[ [f.entity, f.source].filter(Boolean).join('/'), f.key ? `key=${f.key}` : '', f.field ? `field=${f.field}` : '' ].filter(Boolean).join(' ')}: ${f.message}${f.expected !== undefined ? ` Expected=${value(f.expected, f.entity, f.field, f.type === 'aggregate_mismatch')} Actual=${value(f.actual, f.entity, f.field, f.type === 'aggregate_mismatch')}` : ''}${f.values ? ` Observed=${f.values.map((item)=>`line ${item.line}: ${value(item.value,f.entity,f.field,false)}`).join('; ')}` : ''}`);
  if (report.findings.length > 10) lines.push(`  ... ${report.findings.length - 10} more ${report.findings.length === 11 ? 'finding' : 'findings'}.`);
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
