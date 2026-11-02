import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Report } from './types.js';

export function reportExitCode(report: Report): 0 | 1 | 2 {
  return report.findings.some((f) => f.type === 'source_error') ? 2 : report.findings.length ? 1 : 0;
}

export function jsonReport(report: Report): string {
  return JSON.stringify(report, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
}

export function consoleReport(report: Report): string {
  const counts = new Map<string, number>();
  for (const f of report.findings) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  const lines = [`LogiParity: ${report.entities.length} entities, ${report.findings.length} findings`];
  for (const [type, count] of [...counts].sort(([a], [b]) => a < b ? -1 : 1)) lines.push(`  ${type}: ${count}`);
  for (const f of report.findings.slice(0, 10)) lines.push(`  [${f.type}] ${f.entity}/${f.source} key=${f.key || '-'} field=${f.field || '-'}: ${f.message}${f.expected !== undefined ? ` Expected=${String(f.expected)} Actual=${String(f.actual)}` : ''}`);
  if (report.findings.length > 10) lines.push(`  ... ${report.findings.length - 10} more; see the JSON report.`);
  return lines.join('\n') + '\n';
}

export async function writeJsonReport(report: Report, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'report.json'), jsonReport(report), 'utf8');
}
