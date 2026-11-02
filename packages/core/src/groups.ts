import type { EntityConfig } from './config.js';
import type { Finding, FindingGroup, NormalizedValue, Report } from './types.js';
import { formatMoneyMajor, moneyUnits, type ReportPresentation } from './money-display.js';

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
  for (const finding of findings) if (!finding.reason && ['field_mismatch', 'missing_in_source', 'extra_in_source'].includes(finding.type)) {
    const key = JSON.stringify([finding.entity, finding.source, finding.field, finding.type]);
    const bucket = buckets.get(key) ?? []; bucket.push(finding); buckets.set(key, bucket);
  }
  const groups: FindingGroup[] = [];
  for (const bucket of buckets.values()) {
    const first = bucket[0]!; const { entity, source, field } = first;
    if (first.type === 'missing_in_source' || first.type === 'extra_in_source') {
      const prefixes = new Map<string, { key: string; number: bigint }[]>();
      for (const finding of bucket) {
        const match = finding.key.match(/^(.*?)(\d+)$/); if (!match) continue;
        const keys = prefixes.get(match[1]!) ?? []; keys.push({ key: finding.key, number: BigInt(match[2]!) }); prefixes.set(match[1]!, keys);
      }
      for (const keys of prefixes.values()) {
        keys.sort((a, b) => a.number < b.number ? -1 : a.number > b.number ? 1 : 0);
        for (let start = 0; start + 2 < keys.length;) {
          const stride = keys[start + 1]!.number - keys[start]!.number;
          if (stride <= 1n) { start++; continue; }
          let end = start + 2;
          while (end < keys.length && keys[end]!.number - keys[end - 1]!.number === stride) end++;
          const count = end - start;
          if (count >= 3) {
            groups.push({ entity, source, field: '', count, kind: first.type === 'missing_in_source' ? 'missing_stride' : 'extra_stride', stride: String(stride), summary: `${count.toLocaleString('en-US')} ${first.type} keys in ${source} follow a stride of ${stride}, from ${keys[start]!.key} to ${keys[end - 1]!.key} (likely page boundary).` });
            start = end;
          } else start++;
        }
      }
      continue;
    }
    const rule = entities.find((e) => e.name === entity)?.compare[field];
    const count = bucket.length; const prefix = `${count.toLocaleString('en-US')} ${field} ${count === 1 ? 'value' : 'values'} in ${source}`;
    const verb = (plural: string, singular: string) => count === 1 ? singular : plural;
    if (rule?.type === 'money' || rule?.type === 'datetime') {
      const deltas = bucket.map((f) => { const expected = integer(f.expected); const actual = integer(f.actual); return expected === undefined || actual === undefined ? undefined : actual - expected; });
      const delta = deltas[0];
      if (delta !== undefined && delta !== 0n && deltas.every((value) => value === delta)) {
        const kind = rule.type === 'money' ? 'money_delta' : 'datetime_offset';
        const difference = kind === 'money_delta' ? `${delta > 0n ? '+' : ''}${formatMoneyMajor(delta, rule.currency!, rule.locale)} (${moneyUnits(delta, rule.currency!)})` : duration(delta);
        const hint = kind === 'money_delta' ? 'likely rounding or a fixed adjustment' : delta % 900000n === 0n ? 'likely timezone' : 'consistent datetime offset';
        groups.push({ entity, source, field, count, kind, delta: delta.toString(), summary: `${prefix} ${verb('differ', 'differs')} by exactly ${difference} (${hint}).` }); continue;
      }
    }
    if (first.expected !== undefined && first.actual !== undefined && bucket.every((f) => f.expected === first.expected && f.actual === first.actual)) groups.push({ entity, source, field, count, kind: 'value_mapping', expected: first.expected, actual: first.actual, summary: `${prefix} ${verb('map', 'maps')} ${label(first.expected)} -> ${label(first.actual)}.` });
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return groups.sort((a, b) => Number(!a.kind.endsWith('_stride')) - Number(!b.kind.endsWith('_stride')) || compare(a.entity, b.entity) || compare(a.source, b.source) || compare(a.field, b.field) || compare(a.kind, b.kind) || compare(a.summary, b.summary));
}
export function reportGroups(report: Report, presentation: ReportPresentation = {}): FindingGroup[] {
  return report.groups ?? groupFindings(report.findings, presentation.entities);
}
