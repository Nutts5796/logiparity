import { equalValues, normalize } from './normalize.js';
import type { AggregateConfig, EntityConfig, SourceConfig } from './config.js';
import type { NormalizedValue } from './types.js';

// Exact decimal addition of canonical normalized numbers keeps sums independent
// of record order and avoids artifacts such as 0.1 + 0.2 !== 0.3.
class DecimalSum {
  private units = 0n;
  private scale = 0;
  add(value: number): void {
    const [mantissa = '', exponent = '0'] = String(value).toLowerCase().split('e');
    const fraction = mantissa.split('.')[1]?.length ?? 0;
    let scale = fraction - Number(exponent);
    let units = BigInt(mantissa.replace('.', ''));
    if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
    if (scale > this.scale) { this.units *= 10n ** BigInt(scale - this.scale); this.scale = scale; }
    this.units += units * 10n ** BigInt(this.scale - scale);
  }
  value(): number {
    const value = Number(`${this.units}e-${this.scale}`);
    if (!Number.isFinite(value)) throw new Error('Numeric sum exceeds finite number range; use smaller values or a money rule for exact monetary sums.');
    return value;
  }
  within(tolerance: number): boolean {
    const bound = new DecimalSum(); bound.add(tolerance);
    const scale = Math.max(this.scale, bound.scale);
    const absolute = this.units < 0n ? -this.units : this.units;
    return absolute * 10n ** BigInt(scale - this.scale) <= bound.units * 10n ** BigInt(scale - bound.scale);
  }
}

export function measureAggregate(aggregate: AggregateConfig, entity: EntityConfig, source: string, config: SourceConfig, rows: Map<string, Record<string, NormalizedValue>>): number | bigint | undefined {
  const required = [...Object.keys(aggregate.where), ...(aggregate.type === 'sum' ? [aggregate.field] : [])];
  if (required.some((field) => !Object.hasOwn(config.fields, field))) return undefined;
  const conditions = Object.entries(aggregate.where).map(([field, value]) => [field, normalize(value, entity.compare[field], source)] as const);
  let count = 0;
  let money = 0n;
  const decimal = new DecimalSum();
  for (const [key, row] of rows) {
    if (!conditions.every(([field, expected]) => equalValues(row[field] ?? null, expected))) continue;
    if (aggregate.type === 'count') { count++; continue; }
    const value = row[aggregate.field];
    if (value === null) continue; // Null values do not contribute to a sum.
    if (typeof value === 'bigint') money += value;
    else if (typeof value === 'number' && Number.isFinite(value)) decimal.add(value);
    else throw new Error(`Sum field ${aggregate.field}, key ${key} is not numeric; map the field and provide valid number/money values.`);
  }
  if (aggregate.type === 'count') return count;
  return entity.compare[aggregate.field]?.type === 'money' ? money : decimal.value();
}

export function aggregateEqual(expected: number | bigint, actual: number | bigint, config: AggregateConfig): boolean {
  if (typeof expected === 'bigint' && typeof actual === 'bigint') return (expected > actual ? expected - actual : actual - expected) <= BigInt(config.tolerance);
  if (typeof expected !== 'number' || typeof actual !== 'number') return false;
  const difference = new DecimalSum(); difference.add(expected); difference.add(-actual);
  return difference.within(config.tolerance);
}
