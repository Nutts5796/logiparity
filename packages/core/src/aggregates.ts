import { matchesFilter } from './filters.js';
import type { AggregateConfig, EntityConfig, SourceConfig } from './config.js';
import type { NormalizedValue } from './types.js';

// Exact decimal addition of canonical normalized numbers keeps sums independent
// of record order and avoids artifacts such as 0.1 + 0.2 !== 0.3.
export class DecimalSum {
  private units = 0n;
  private scale = 0;
  add(value: number | bigint | string): void {
    const [mantissa = '', exponent = '0'] = String(value).toLowerCase().split('e');
    const fraction = mantissa.split('.')[1]?.length ?? 0;
    let scale = fraction - Number(exponent);
    let units = BigInt(mantissa.replace('.', ''));
    if (scale < 0) {
      units *= 10n ** BigInt(-scale);
      scale = 0;
    }
    if (scale > this.scale) {
      this.units *= 10n ** BigInt(scale - this.scale);
      this.scale = scale;
    }
    this.units += units * 10n ** BigInt(this.scale - scale);
  }
  text(): string {
    const absolute = String(this.units < 0n ? -this.units : this.units).padStart(this.scale + 1, '0');
    const decimal = this.scale
      ? `${absolute.slice(0, -this.scale)}.${absolute.slice(-this.scale)}`.replace(/\.?0+$/, '')
      : absolute;
    return `${this.units < 0n ? '-' : ''}${decimal}`;
  }
  percentOf(other: DecimalSum): number {
    if (other.units === 0n) return 0;
    const scale = Math.max(this.scale, other.scale);
    return (
      Number(
        (this.units * 10n ** BigInt(scale - this.scale) * 10000n) / (other.units * 10n ** BigInt(scale - other.scale)),
      ) / 100
    );
  }
  value(): number {
    const value = Number(`${this.units}e-${this.scale}`);
    if (!Number.isFinite(value))
      throw new Error(
        'Numeric sum exceeds finite number range; use smaller values or a money rule for exact monetary sums.',
      );
    return value;
  }
  within(tolerance: number): boolean {
    const bound = new DecimalSum();
    bound.add(tolerance);
    const scale = Math.max(this.scale, bound.scale);
    const absolute = this.units < 0n ? -this.units : this.units;
    return absolute * 10n ** BigInt(scale - this.scale) <= bound.units * 10n ** BigInt(scale - bound.scale);
  }
}
export const negateDecimal = (value: bigint | string): bigint | string =>
  typeof value === 'bigint' ? -value : value.startsWith('-') ? value.slice(1) : '-' + value;
export function sumDecimal(...values: (bigint | string | number)[]): string {
  const sum = new DecimalSum();
  values.forEach((value) => sum.add(value));
  return sum.text();
}
export function displayDecimal(value: bigint | string): string {
  const text = sumDecimal(value),
    [integer = '0', fraction] = text.split('.');
  return (
    (text.startsWith('-') ? '−' : '') +
    BigInt(integer.replace(/^-/, '')).toLocaleString('en-US') +
    (fraction ? '.' + fraction : '')
  );
}

export function measureAggregate(
  aggregate: AggregateConfig,
  entity: EntityConfig,
  source: string,
  config: SourceConfig,
  rows: Map<string, Record<string, NormalizedValue>>,
  exactSums?: Map<string, string>,
): number | bigint | undefined {
  const required = [...Object.keys(aggregate.where), ...(aggregate.type === 'sum' ? [aggregate.field] : [])];
  if (required.some((field) => !Object.hasOwn(config.fields, field))) return undefined;
  let count = 0;
  let money = 0n;
  const decimal = new DecimalSum();
  for (const [key, row] of rows) {
    if (!matchesFilter(row, aggregate.where, entity, source)) continue;
    if (aggregate.type === 'count') {
      count++;
      continue;
    }
    const value = row[aggregate.field];
    if (value === null) continue; // Null values do not contribute to a sum.
    if (typeof value === 'bigint') money += value;
    else if (typeof value === 'number' && Number.isFinite(value)) decimal.add(value);
    else
      throw new Error(
        `Sum field ${aggregate.field}, key ${key} is not numeric; map the field and provide valid number/money values.`,
      );
  }
  if (aggregate.type === 'count') return count;
  if (entity.compare[aggregate.field]?.type === 'number') exactSums?.set(aggregate.name, decimal.text());
  return entity.compare[aggregate.field]?.type === 'money' ? money : decimal.value();
}

export function aggregateEqual(
  expected: number | bigint | string,
  actual: number | bigint | string,
  config: AggregateConfig,
): boolean {
  if (typeof expected === 'bigint' && typeof actual === 'bigint')
    return (expected > actual ? expected - actual : actual - expected) <= BigInt(config.tolerance);
  if (typeof expected === 'bigint' || typeof actual === 'bigint') return false;
  const difference = new DecimalSum();
  difference.add(expected);
  difference.add(negateDecimal(String(actual)));
  return difference.within(config.tolerance);
}
