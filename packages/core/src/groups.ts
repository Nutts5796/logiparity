import type { EntityConfig } from './config.js';
import type { Finding, FindingGroup, NormalizedValue, Report } from './types.js';
import type { ReportPresentation } from './money-display.js';

function integer(value: NormalizedValue | undefined): bigint | undefined {
  if (typeof value === 'bigint' || typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : undefined;
}
function duration(value: bigint): string {
  for (const [unit, factor] of [['h', 3600000n], ['m', 60000n], ['s', 1000n], ['ms', 1n]] as const) if (value % factor === 0n) return `${value > 0n ? '+' : ''}${value / factor}${unit}`;
  return String(value);
}
const label = (value: NormalizedValue) => typeof value === 'string' ? JSON.stringify(value) : String(value);
export function groupFindings(findings: readonly Finding[], entities: readonly EntityConfig[] = []): FindingGroup[] {
  const buckets = new Map<string, Finding[]>();
  for (const finding of findings) if (finding.type === 'field_mismatch') {
    const key = JSON.stringify([finding.entity, finding.source, finding.field]);
    const bucket = buckets.get(key) ?? []; bucket.push(finding); buckets.set(key, bucket);
  }
  const groups: FindingGroup[] = [];
  for (const bucket of buckets.values()) {
    const first = bucket[0]!; const { entity, source, field } = first;
    const rule = entities.find((e) => e.name === entity)?.compare[field];
    const count = bucket.length; const prefix = `${count.toLocaleString('en-US')} ${field} ${count === 1 ? 'value' : 'values'} in ${source}`;
    if (rule?.type === 'money' || rule?.type === 'datetime') {
      const deltas = bucket.map((f) => { const expected = integer(f.expected); const actual = integer(f.actual); return expected === undefined || actual === undefined ? undefined : actual - expected; });
      const delta = deltas[0];
      if (delta !== undefined && delta !== 0n && deltas.every((value) => value === delta)) {
        const kind = rule.type === 'money' ? 'money_delta' : 'datetime_offset';
        const difference = kind === 'money_delta' ? `${delta > 0n ? '+' : ''}${delta} ${rule.currency} minor ${delta === 1n || delta === -1n ? 'unit' : 'units'}` : duration(delta);
        const hint = kind === 'money_delta' ? 'likely rounding or a fixed adjustment' : delta % 900000n === 0n ? 'likely timezone' : 'consistent datetime offset';
        groups.push({ entity, source, field, count, kind, delta: delta.toString(), summary: `${prefix} differ by exactly ${difference} (${hint}).` }); continue;
      }
    }
    if (first.expected !== undefined && first.actual !== undefined && bucket.every((f) => f.expected === first.expected && f.actual === first.actual)) groups.push({ entity, source, field, count, kind: 'value_mapping', expected: first.expected, actual: first.actual, summary: `${prefix} map ${label(first.expected)} -> ${label(first.actual)}.` });
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return groups.sort((a, b) => compare(a.entity, b.entity) || compare(a.source, b.source) || compare(a.field, b.field));
}
export function reportGroups(report: Report, presentation: ReportPresentation = {}): FindingGroup[] {
  return report.groups ?? groupFindings(report.findings, presentation.entities);
}
