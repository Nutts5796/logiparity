import { ordinal } from './labels.js';
import type { EntityConfig } from './config.js';
import type { Finding, FindingGroup, Report } from './types.js';
import { durationValue, formatMoneyMajor, integerValue, type ReportPresentation } from './money-display.js';

export interface PatternOptions {
  minCount?: number;
}
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const identity = (finding: Finding) => ({
  entity: finding.entity,
  source: finding.source,
  field: finding.field,
  ...(finding.currency ? { currency: finding.currency } : {}),
});
const quoted = (value: unknown) => (typeof value === 'string' ? JSON.stringify(value) : String(value));

function strideSummary(
  source: string,
  count: number,
  stride: bigint,
  start: string,
  end: string,
  final?: string,
): string {
  const tail = final ? `; final reference key ${final} is also missing from the last page` : '';
  return `${count.toLocaleString('en-US')} missing rows in ${source} follow a stride of ${stride}, from ${start} to ${end}${tail} (likely page boundary).`;
}
export function strideGroups(bucket: readonly Finding[], minCount: number, finalKey?: string): FindingGroup[] {
  const first = bucket[0];
  if (!first) return [];
  const prefixes = new Map<string, { key: string; number: bigint }[]>();
  for (const finding of bucket) {
    const match = finding.key.match(/^(.*?)(\d+)$/);
    if (!match?.[2]) continue;
    const prefix = match[1] ?? '';
    const number = match[2];
    if (!number) continue;
    const entries = prefixes.get(prefix) ?? [];
    entries.push({ key: finding.key, number: BigInt(number) });
    prefixes.set(prefix, entries);
  }
  const groups: FindingGroup[] = [];
  for (const [prefix, entries] of prefixes) {
    entries.sort((left, right) => (left.number < right.number ? -1 : left.number > right.number ? 1 : 0));
    for (let start = 0; start + 2 < entries.length;) {
      const begin = entries[start],
        next = entries[start + 1];
      if (!begin || !next) break;
      const stride = next.number - begin.number;
      if (stride <= 1n) {
        start++;
        continue;
      }
      let end = start + 2;
      while (end < entries.length) {
        const current = entries[end],
          previous = entries[end - 1];
        if (!current || !previous || current.number - previous.number !== stride) break;
        end++;
      }
      const last = entries[end - 1];
      if (!last || end - start < minCount) {
        start++;
        continue;
      }
      const keys = entries.slice(start, end).map((item) => item.key);
      const finalMatch = finalKey?.match(/^(.*?)(\d+)$/);
      const finalNumber = finalMatch?.[2] ? BigInt(finalMatch[2]) : undefined;
      const includeFinal =
        first.type === 'missing_in_source' &&
        finalKey &&
        finalMatch?.[1] === prefix &&
        finalNumber !== undefined &&
        finalNumber > last.number &&
        finalNumber < last.number + stride &&
        bucket.some((item) => item.key === finalKey);
      if (includeFinal) keys.push(finalKey);
      const summary = strideSummary(
        first.source,
        keys.length,
        stride,
        begin.key,
        last.key,
        includeFinal ? finalKey : undefined,
      );
      groups.push({
        ...identity(first),
        field: '',
        count: keys.length,
        keys,
        kind: first.type === 'missing_in_source' ? 'missing_stride' : 'extra_stride',
        stride: String(stride),
        ...(bucket.every((item) => item.evidence?.paginated || item.evidence?.pageSizes?.includes(Number(stride)))
          ? { cause: 'pagination' as const }
          : {}),
        summary: (bucket.every((item) => item.evidence?.paginated || item.evidence?.pageSizes?.includes(Number(stride)))
          ? summary
          : `${keys.length} rows in ${first.source}: every ${ordinal(stride)} row is missing (stride of ${stride}), from ${begin.key} to ${last.key}${includeFinal ? `; final reference key ${finalKey} is also missing` : ''}.`
        ).replace('missing', first.type === 'extra_in_source' ? 'extra' : 'missing'),
      });
      start = end;
    }
  }
  const merged = new Map<string, FindingGroup>();
  for (const group of groups) {
    const id = JSON.stringify([group.source, group.kind, group.stride, group.cause]);
    const previous = merged.get(id);
    if (previous) {
      previous.keys = [...new Set([...(previous.keys ?? []), ...(group.keys ?? [])])];
      previous.count = previous.keys.length;
    } else merged.set(id, group);
  }
  return [...merged.values()];
}
function deltaSummary(first: Finding, count: number, delta: bigint, rule: EntityConfig['compare'][string]): string {
  const difference =
    rule.type === 'money' && (first.currency ?? rule.currency)
      ? formatMoneyMajor(delta, first.currency ?? rule.currency ?? 'USD')
      : durationValue(delta);
  const hint =
    rule.type === 'money'
      ? delta >= -3n && delta <= 3n
        ? 'likely rounding'
        : 'consistent fixed difference'
      : first.evidence?.offsetFree && delta % 900000n === 0n && delta >= -50400000n && delta <= 50400000n
        ? 'possible timezone difference'
        : 'repeated datetime offset';
  return `${count.toLocaleString('en-US')} ${first.field} values in ${first.source} differ by exactly ${difference} (${hint}).`;
}
export function deltaGroups(
  bucket: readonly Finding[],
  entities: readonly EntityConfig[],
  minCount: number,
): FindingGroup[] {
  const first = bucket[0];
  if (!first) return [];
  const rule = entities.find((entity) => entity.name === first.entity)?.compare[first.field];
  if (rule?.type !== 'money' && rule?.type !== 'datetime') return [];
  const deltas = new Map<string, Finding[]>();
  for (const finding of bucket) {
    const expected = integerValue(finding.expected),
      actual = integerValue(finding.actual);
    if (expected === undefined || actual === undefined || expected === actual) continue;
    const delta = String(actual - expected),
      values = deltas.get(delta) ?? [];
    values.push(finding);
    deltas.set(delta, values);
  }
  return [...deltas].flatMap(([delta, values]) =>
    values.length >= minCount
      ? [
          {
            ...identity(first),
            count: values.length,
            kind: rule.type === 'money' ? ('money_delta' as const) : ('datetime_offset' as const),
            delta,
            ...(rule.type === 'datetime' &&
            BigInt(delta) % 900000n === 0n &&
            BigInt(delta) >= -50400000n &&
            BigInt(delta) <= 50400000n &&
            values.every((value) => value.evidence?.offsetFree)
              ? { cause: 'timezone' as const }
              : {}),
            summary: deltaSummary(
              { ...first, evidence: { offsetFree: values.every((value) => value.evidence?.offsetFree) } },
              values.length,
              BigInt(delta),
              rule,
            ),
          },
        ]
      : [],
  );
}
export function mappingGroups(bucket: readonly Finding[], minCount: number): FindingGroup[] {
  const pairs = new Map<string, Finding[]>();
  for (const finding of bucket) {
    if (finding.reason === 'currency_mismatch') continue;
    if (finding.expected == null || finding.actual == null || finding.expected === '' || finding.actual === '')
      continue;
    const key = JSON.stringify([finding.expected, finding.actual], (_, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value,
    );
    const entries = pairs.get(key) ?? [];
    entries.push(finding);
    pairs.set(key, entries);
  }
  return [...pairs.values()].flatMap((entries) => {
    const first = entries[0];
    if (!first || entries.length < minCount || first.expected === undefined || first.actual === undefined) return [];
    const summary = `${entries.length.toLocaleString('en-US')} ${first.field} values in ${first.source} map ${quoted(first.expected)} to ${quoted(first.actual)}.`;
    return [
      {
        ...identity(first),
        count: entries.length,
        kind: 'value_mapping' as const,
        expected: first.expected,
        actual: first.actual,
        summary,
      },
    ];
  });
}
export function groupFindings(
  findings: readonly Finding[],
  entities: readonly EntityConfig[] = [],
  finalReferenceKeys: Readonly<Record<string, string>> = {},
  options: PatternOptions = {},
): FindingGroup[] {
  const minCount = Math.max(3, options.minCount ?? 3);
  const buckets = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (finding.reason || !['field_mismatch', 'missing_in_source', 'extra_in_source'].includes(finding.type)) continue;
    const key = JSON.stringify([finding.entity, finding.source, finding.field, finding.type, finding.currency]);
    const entries = buckets.get(key) ?? [];
    entries.push(finding);
    buckets.set(key, entries);
  }
  const groups: FindingGroup[] = [];
  for (const bucket of buckets.values()) {
    const first = bucket[0];
    if (!first || bucket.length < minCount) continue;
    if (first.type !== 'field_mismatch') {
      groups.push(...strideGroups(bucket, minCount, finalReferenceKeys[first.entity]));
      continue;
    }
    const rule = entities.find((entity) => entity.name === first.entity)?.compare[first.field];
    groups.push(
      ...(rule?.type === 'money' || rule?.type === 'datetime'
        ? deltaGroups(bucket, entities, minCount)
        : mappingGroups(bucket, minCount)),
    );
  }
  return groups.sort(
    (a, b) =>
      Number(!a.kind.endsWith('_stride')) - Number(!b.kind.endsWith('_stride')) ||
      compare(a.entity, b.entity) ||
      compare(a.source, b.source) ||
      compare(a.field, b.field) ||
      compare(a.kind, b.kind) ||
      compare(a.delta ?? '', b.delta ?? '') ||
      compare(a.summary, b.summary),
  );
}
export function reportGroups(report: Report, presentation: ReportPresentation = {}): FindingGroup[] {
  const options = report.patterns ?? presentation.patterns;
  return (report.groups ?? groupFindings(report.findings, presentation.entities, {}, options)).filter(
    (group) => group.count >= Math.max(3, options?.minCount ?? 3),
  );
}
export function groupMembership(report: Report, presentation: ReportPresentation = {}): number[][] {
  return reportGroups(report, presentation).map((group) => {
    const keys = new Set(group.keys ?? []);
    return report.findings.flatMap((finding, index) => {
      if (
        finding.reason ||
        finding.entity !== group.entity ||
        finding.source !== group.source ||
        finding.currency !== group.currency
      )
        return [];
      if (group.kind.endsWith('_stride'))
        return keys.has(finding.key) &&
          finding.type === (group.kind === 'missing_stride' ? 'missing_in_source' : 'extra_in_source')
          ? [index]
          : [];
      if (finding.type !== 'field_mismatch' || finding.field !== group.field) return [];
      if (group.kind === 'value_mapping')
        return finding.expected === group.expected && finding.actual === group.actual ? [index] : [];
      const expected = integerValue(finding.expected),
        actual = integerValue(finding.actual);
      return expected !== undefined && actual !== undefined && String(actual - expected) === group.delta ? [index] : [];
    });
  });
}
export function accountedFindingIndexes(report: Report, presentation: ReportPresentation = {}): Set<number> {
  return new Set([
    ...groupMembership(report, presentation).flat(),
    ...report.findings.flatMap((finding, index) => (finding.accounting?.remainder === '0' ? [index] : [])),
  ]);
}
export function presentationFindings(report: Report, presentation: ReportPresentation = {}): Finding[] {
  const covered = accountedFindingIndexes(report, presentation);
  return [
    ...report.findings.filter((_, index) => !covered.has(index)),
    ...report.findings.filter((_, index) => covered.has(index)),
  ];
}
export function attachGroupMembership(report: Report): void {
  const memberships = groupMembership(report);
  report.groups?.forEach((group, index) => {
    group.findingIndexes = memberships[index] ?? [];
  });
  const explained = accountedFindingIndexes(report).size;
  report.coverage = { explained, needsReview: report.findings.length - explained };
}
