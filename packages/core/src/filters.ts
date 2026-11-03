import type { EntityConfig, RowFilter } from './config.js';
import type { NormalizedValue } from './types.js';
import { normalize, sourceRule } from './normalize.js';
export function matchesFilter(
  row: Record<string, NormalizedValue>,
  where: RowFilter,
  entity: EntityConfig,
  source: string,
): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const inverse = condition !== null && typeof condition === 'object' && !Array.isArray(condition);
    const choice = inverse ? condition.not : condition;
    const values = Array.isArray(choice) ? choice : [choice];
    const rule = sourceRule(entity.compare[field], entity.sources[source]);
    const canonical = (value: NormalizedValue): NormalizedValue => {
      const text = !rule && value !== null ? String(value) : value;
      return typeof text === 'string' && !entity.sources[source]?.caseSensitive ? text.toLowerCase() : text;
    };
    const match = values.some((value) => canonical(row[field] ?? null) === canonical(normalize(value, rule, source)));
    return inverse ? !match : match;
  });
}
