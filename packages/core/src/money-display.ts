import type { EntityConfig } from './config.js';
import type { NormalizedValue } from './types.js';
import { presentationRule } from './labels.js';
import { displayValue } from './report-utils.js';

// Presentation context stays outside Report, preserving the JSON wire format.
export interface ReportPresentation {
  entities?: readonly EntityConfig[];
  environment?: string;
  configFile?: string;
  generatedAt?: string;
}

export function formatDatetimeUtc(epoch: number): string | undefined {
  if (!Number.isSafeInteger(epoch)) return undefined;
  const date = new Date(epoch);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace(/\.000Z$/, 'Z');
}

export function formatMoneyMajor(minor: bigint, currency: string, locale = 'en-US'): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  const factor = 10n ** BigInt(digits);
  const absolute = minor < 0n ? -minor : minor;
  const whole = absolute / factor;
  // Use a negative integer template even for -0.xx, preserving the minus sign.
  const template = minor < 0n ? -(whole || 1n) : whole;
  const fraction = digits
    ? new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: digits }).format(absolute % factor)
    : '';
  return formatter
    .formatToParts(template)
    .map((part) => {
      if (part.type === 'fraction') return fraction;
      if (part.type === 'integer' && minor < 0n && whole === 0n)
        return new Intl.NumberFormat(locale, { useGrouping: false }).format(0n);
      return part.value;
    })
    .join('');
}

export function presentationValue(
  value: NormalizedValue | undefined,
  entityName: string,
  field: string,
  aggregate: boolean,
  presentation: ReportPresentation = {},
): string {
  const plain = displayValue(value);
  const entity = presentation.entities?.find((e) => e.name === entityName);
  const rule = presentationRule(entity, field, aggregate);
  if (rule?.type === 'datetime' && typeof value === 'number') return readableDatetime(value) ?? plain;
  if (rule?.type !== 'money' || !rule.currency || integerValue(value) === undefined) return plain;
  return formatMoneyMajor(integerValue(value)!, rule.currency);
}

export function integerValue(value: NormalizedValue | undefined): bigint | undefined {
  if (typeof value === 'bigint' || (typeof value === 'string' && /^-?\d+$/.test(value))) return BigInt(value);
  return typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : undefined;
}

export function readableDatetime(epoch: number): string | undefined {
  if (!formatDatetimeUtc(epoch)) return undefined;
  const date = new Date(epoch);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return `${day}, ${time} UTC`;
}

export function durationValue(delta: bigint): string {
  for (const [unit, factor] of [
    ['h', 3600000n],
    ['m', 60000n],
    ['s', 1000n],
    ['ms', 1n],
  ] as const)
    if (delta % factor === 0n) return `${delta > 0n ? '+' : ''}${delta / factor}${unit}`;
  return String(delta);
}

export function presentationDifference(
  expected: NormalizedValue | undefined,
  actual: NormalizedValue | undefined,
  entityName: string,
  field: string,
  aggregate: boolean,
  presentation: ReportPresentation = {},
): string {
  const rule = presentationRule(
    presentation.entities?.find((item) => item.name === entityName),
    field,
    aggregate,
  );
  const left = integerValue(expected),
    right = integerValue(actual);
  if (left !== undefined && right !== undefined) {
    const delta = right - left;
    if (rule?.type === 'datetime') return durationValue(delta);
    if (rule?.type === 'money') return `${delta > 0n ? '+' : ''}${formatMoneyMajor(delta, rule.currency!)}`;
    return `${delta > 0n ? '+' : ''}${delta.toLocaleString('en-US')}`;
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    const delta = actual - expected;
    return `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US', { maximumFractionDigits: 12 })}`;
  }
  return '—';
}

export function moneyUnits(minor: bigint, currency: string): string {
  const absolute = minor < 0n ? -minor : minor;
  const cents = ['USD', 'EUR', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD'].includes(currency);
  return `${absolute} ${cents ? (absolute === 1n ? 'cent' : 'cents') : `${currency} minor ${absolute === 1n ? 'unit' : 'units'}`}`;
}
