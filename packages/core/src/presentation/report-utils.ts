import { isBlocking } from '../foundation/policy.js';
import type { Finding, NormalizedValue, Report } from '../foundation/types.js';

export const findingTypes = [
  'missing_in_source',
  'extra_in_source',
  'field_mismatch',
  'aggregate_mismatch',
  'duplicate_key',
  'source_error',
  'invalid_value',
  'duplicate_value',
] as const;
export const entityNames = (report: Report): string[] =>
  [...new Set([...report.entities.map((e) => e.entity), ...report.findings.map((f) => f.entity)])].sort();
export function escapeMarkup(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
export const displayValue = (value: NormalizedValue | undefined): string =>
  value === undefined ? '—' : value === null || value === '' ? '(blank)' : String(value);
export function findingDetail(f: Finding): string {
  return `${f.source} | key=${f.key || '—'} | field=${f.field || '—'} | ${isBlocking(f) ? 'blocking' : 'allowed'}\n${f.message}${f.expected !== undefined ? `\nExpected: ${displayValue(f.expected)}\nActual: ${displayValue(f.actual)}` : ''}${f.values ? `\nObserved: ${f.values.map((item) => `row ${item.row}: ${displayValue(item.value)}`).join('; ')}` : ''}`;
}
export function verdict(report: Report): string {
  if (report.findings.some((f) => f.type === 'source_error')) return 'Runtime error';
  if (report.findings.some(isBlocking)) return 'Failed';
  return report.findings.length ? 'Passed with observations' : 'Passed';
}
