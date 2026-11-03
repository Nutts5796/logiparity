import type { EntityConfig, RowFilter } from './config.js';
import type { NormalizedValue } from './types.js';
import { normalize, equalValues } from './normalize.js';
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
    const match = values.some((value) =>
      equalValues(row[field] ?? null, normalize(value, entity.compare[field], source)),
    );
    return inverse ? !match : match;
  });
}
