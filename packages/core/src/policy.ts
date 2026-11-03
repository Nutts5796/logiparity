import type { EntityConfig } from './config.js';
import type { Finding, FindingType, Report } from './types.js';

export const findingCategories = ['missing', 'extra', 'mismatch', 'aggregate', 'duplicate'] as const;
export type FindingCategory = (typeof findingCategories)[number];
export type FailurePolicy = Partial<Record<FindingCategory, number>>;
const categories: Record<Exclude<FindingType, 'source_error'>, FindingCategory> = {
  missing_in_source: 'missing',
  extra_in_source: 'extra',
  field_mismatch: 'mismatch',
  aggregate_mismatch: 'aggregate',
  duplicate_key: 'duplicate',
  duplicate_value: 'duplicate',
  invalid_value: 'mismatch',
};

export function isBlocking(finding: Finding): boolean {
  return finding.type === 'source_error' || finding.blocking !== false;
}

export function applyFailurePolicies(report: Report, entities: EntityConfig[]): void {
  for (const entity of entities) {
    const policy: FailurePolicy = Array.isArray(entity.failOn)
      ? Object.fromEntries(entity.failOn.map((category) => [category, 0]))
      : entity.failOn;
    const findings = report.findings.filter((f) => f.entity === entity.name);
    const counts: Partial<Record<FindingCategory, number>> = {};
    for (const f of findings)
      if (f.type !== 'source_error') {
        const category = categories[f.type];
        counts[category] = (counts[category] ?? 0) + 1;
      }
    for (const f of findings) {
      if (f.type === 'source_error') {
        f.blocking = true;
        continue;
      }
      const category = categories[f.type];
      const threshold = policy[category];
      f.blocking = threshold !== undefined && (counts[category] ?? 0) > threshold;
    }
  }
}
