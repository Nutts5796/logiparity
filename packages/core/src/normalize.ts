import { DateTime } from 'luxon';
import type { ComparisonRule } from './config.js';
import type { NormalizedValue } from './types.js';

const localeFormats = new Map<string, { group: string | undefined; decimal: string; primary: number; secondary: number }>();
const currencyDigits = new Map<string, number>();

function decimalText(input: string, locale: string): string {
  let format = localeFormats.get(locale);
  if (!format) {
    const parts = new Intl.NumberFormat(locale).formatToParts(123456789.5);
    const integers = parts.filter((p) => p.type === 'integer');
    format = { group: parts.find((p) => p.type === 'group')?.value, decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.', primary: integers.at(-1)?.value.length ?? 3, secondary: integers.at(-2)?.value.length ?? 3 };
    localeFormats.set(locale, format);
  }
  const { group, decimal, primary, secondary } = format;
  // Validate grouping instead of silently accepting a misplaced separator.
  let text = input.replace(/[\u00a0\u202f]/g, ' ');
  const separator = group?.replace(/[\u00a0\u202f]/g, ' ');
  if (separator && text.includes(separator)) {
    const integer = text.split(decimal)[0]?.replace(/^[+-]/, '') ?? '';
    const groups = integer.split(separator);
    if (!/^\d+$/.test(groups[0] ?? '') || (groups[0]?.length ?? 0) > secondary || groups.slice(1).some((g, i) => !/^\d+$/.test(g) || g.length !== (i === groups.length - 2 ? primary : secondary))) throw new Error(`Invalid grouping for locale ${locale}; use the locale's digit grouping or no grouping.`);
    text = text.split(separator).join('');
  }
  text = text.replace(decimal, '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal for locale ${locale}; use a plain decimal without currency symbols.`);
  return text;
}

export function moneyMinor(input: string, currency: string, locale = 'en-US'): bigint {
  let digits = currencyDigits.get(currency);
  if (digits === undefined) {
    digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    if (digits !== undefined) currencyDigits.set(currency, digits);
  }
  if (digits === undefined) throw new Error(`Cannot determine minor units for ${currency}.`);
  const text = decimalText(input.trim(), locale);
  const negative = text.startsWith('-');
  const [whole = '', fraction = ''] = text.replace(/^[+-]/, '').split('.');
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) throw new Error(`Money has more than ${digits} decimal places for ${currency}; provide rounded major-unit decimals as strings.`);
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.slice(0, digits).padEnd(digits, '0') || '0');
  return negative ? -minor : minor;
}

export function normalize(value: unknown, rule: ComparisonRule | undefined, source: string): NormalizedValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) value = value.toISOString();
  if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value)) throw new Error('Expected a scalar field; map a scalar JSONPath or file column.');
  const text = String(value).trim();
  if (text === '' && (rule?.emptyAsNull ?? true)) return null;
  if (!rule) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Expected a finite number.');
    return typeof value === 'string' ? text : value as NormalizedValue;
  }
  switch (rule.type) {
    case 'string': return rule.caseFold ? text.toLocaleLowerCase(rule.locale) : text;
    case 'enum': {
      const mapped = Object.hasOwn(rule.map, text) ? rule.map[text] ?? text : text;
      return rule.caseFold ? mapped.toLocaleLowerCase(rule.locale) : mapped;
    }
    case 'money': {
      if (typeof value === 'number') throw new Error('Money must be a decimal string; return strings from the API or export text cells to avoid floating-point precision loss.');
      return moneyMinor(text, rule.currency ?? 'USD', rule.locale);
    }
    case 'number': {
      const number = Number(decimalText(text, rule.locale));
      if (!Number.isFinite(number)) throw new Error('Expected a finite decimal number.');
      return number;
    }
    case 'datetime': {
      const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
      const zone = rule.sourceTimezones[source];
      if (!explicitZone && !zone) throw new Error(`Datetime has no offset; set sourceTimezones.${source} or supply an ISO 8601 offset.`);
      const date = DateTime.fromISO(text.replace(' ', 'T'), { zone: zone ?? 'UTC', setZone: true });
      if (!date.isValid) throw new Error(`Invalid ISO datetime or timezone for source ${source}; check the date and sourceTimezones.`);
      if (!explicitZone && date.getPossibleOffsets().length > 1) throw new Error('Datetime is ambiguous during a daylight-saving transition; include an explicit UTC offset.');
      if (!explicitZone && date.toFormat("yyyy-MM-dd'T'HH:mm") !== text.replace(' ', 'T').slice(0, 16)) throw new Error('Datetime falls in a daylight-saving gap; include a valid UTC offset.');
      return date.toUTC().toMillis();
    }
  }
}

export function equalValues(a: NormalizedValue, b: NormalizedValue, rule?: ComparisonRule): boolean {
  if (typeof a === 'bigint' && typeof b === 'bigint') return (a > b ? a - b : b - a) <= BigInt(rule?.tolerance ?? 0);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (rule?.type === 'datetime' ? rule.toleranceSeconds * 1000 : rule?.tolerance ?? 0);
  return a === b;
}
