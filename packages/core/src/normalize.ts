import { DateTime } from 'luxon';
import type { ExplainedFormat } from 'luxon';
import type { ComparisonRule, SourceConfig } from './config.js';
import { wallClock, type NormalizedValue } from './types.js';

export function sourceRule(
  rule: ComparisonRule | undefined,
  config: SourceConfig | undefined,
  source = '',
): ComparisonRule | undefined {
  return (
    rule && {
      ...rule,
      locale: rule.locale ?? config?.locale ?? 'en-US',
      numberFormat: rule.numberFormat ?? config?.numberFormat,
      format: typeof rule.format === 'string' ? rule.format : (rule.format?.[source] ?? config?.datetimeFormat),
    }
  );
}

const localeFormats = new Map<
  string,
  { group: string | undefined; decimal: string; primary: number; secondary: number }
>();
const currencyDigits = new Map<string, number>();
const currencySymbols = new Map<string, string[]>();

function decimalText(input: string, locale: string, explicit?: ComparisonRule['numberFormat']): string {
  let format = localeFormats.get(locale);
  if (!format) {
    const parts = new Intl.NumberFormat(locale).formatToParts(123456789.5);
    const integers = parts.filter((p) => p.type === 'integer');
    format = {
      group: parts.find((p) => p.type === 'group')?.value,
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
      primary: integers.at(-1)?.value.length ?? 3,
      secondary: integers.at(-2)?.value.length ?? 3,
    };
    localeFormats.set(locale, format);
  }
  const { group, decimal, primary, secondary } = explicit ? { ...format, ...explicit, group: explicit.group } : format;
  // Validate grouping instead of silently accepting a misplaced separator.
  let text = input.replace(/[\u00a0\u202f]/g, ' ');
  const separator = group?.replace(/[\u00a0\u202f]/g, ' ');
  if (separator && text.includes(separator)) {
    const integer = text.split(decimal)[0]?.replace(/^[+-]/, '') ?? '';
    const groups = integer.split(separator);
    if (
      !/^\d+$/.test(groups[0] ?? '') ||
      (groups[0]?.length ?? 0) > secondary ||
      groups.slice(1).some((g, i) => !/^\d+$/.test(g) || g.length !== (i === groups.length - 2 ? primary : secondary))
    )
      throw new Error(`Invalid grouping for locale ${locale}; use the locale's digit grouping or no grouping.`);
    text = text.split(separator).join('');
  }
  text = text.replace(decimal, '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(text))
    throw new Error(`Invalid decimal for locale ${locale}; use a plain decimal without currency symbols.`);
  return text;
}

export interface MoneyInputOptions {
  allowCurrencySymbol?: boolean;
  negativeParentheses?: boolean;
  round?: 'half-up' | 'half-even' | undefined;
  numberFormat?: ComparisonRule['numberFormat'];
}
function moneyText(input: string, currency: string, locale: string, options: MoneyInputOptions): string {
  let text = input.trim();
  let parentheses = false;
  if (/[()]/.test(text)) {
    if (!options.negativeParentheses)
      throw new Error(
        'Money uses negative parentheses; set negativeParentheses: true or provide a signed plain decimal.',
      );
    if (!/^\([^()]+\)$/.test(text)) throw new Error('Money has invalid negative parentheses.');
    parentheses = true;
    text = text.slice(1, -1).trim();
  }
  const signed = text.match(/^[+-]/)?.[0] ?? '';
  if (signed) text = text.slice(1).trim();
  if (!/[\p{Sc}\p{L}]/u.test(text)) {
    if (parentheses && signed) throw new Error('Money has conflicting signs; use one sign or negative parentheses.');
    return (parentheses ? '-' : signed) + text;
  }
  text = stripCurrencySymbol(text, currency, locale, options);
  if ((signed && /^[+-]/.test(text)) || (parentheses && (signed || /^[+-]/.test(text))))
    throw new Error('Money has conflicting signs; use one sign or negative parentheses.');
  return (parentheses ? '-' : signed) + text;
}

// Accept at most one symbol for the configured currency, retaining strict grouping and precision checks.
function stripCurrencySymbol(text: string, currency: string, locale: string, options: MoneyInputOptions): string {
  const cacheKey = `${locale}|${currency}`;
  let tokens = currencySymbols.get(cacheKey);
  if (!tokens) {
    tokens = [
      ...new Set(
        ['symbol', 'narrowSymbol', 'code'].flatMap((display) =>
          new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            currencyDisplay: display as 'symbol' | 'narrowSymbol' | 'code',
          })
            .formatToParts(1)
            .filter((part) => part.type === 'currency')
            .map((part) => part.value),
        ),
      ),
    ].sort((a, b) => b.length - a.length);
    currencySymbols.set(cacheKey, tokens);
  }
  const token = tokens.find((item) => text.startsWith(item) || text.endsWith(item));
  if (/\p{Sc}/u.test(text) || token) {
    if (!options.allowCurrencySymbol)
      throw new Error('Money contains a currency symbol; set allowCurrencySymbol: true or provide a plain decimal.');
    if (!token) throw new Error(`Currency symbol does not match configured ${currency}.`);
    text = (text.startsWith(token) ? text.slice(token.length) : text.slice(0, -token.length)).trim();
    if (/\p{Sc}/u.test(text) || tokens.some((item) => text.includes(item)))
      throw new Error(`Use one currency symbol matching configured ${currency}.`);
  }
  return text;
}

export function moneyMinor(input: string, currency: string, locale = 'en-US', options: MoneyInputOptions = {}): bigint {
  let digits = currencyDigits.get(currency);
  if (digits === undefined) {
    digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    if (digits !== undefined) currencyDigits.set(currency, digits);
  }
  if (digits === undefined) throw new Error(`Cannot determine minor units for ${currency}.`);
  const text = decimalText(moneyText(input, currency, locale, options), locale, options.numberFormat);
  const negative = text.startsWith('-');
  const [whole = '', fraction = ''] = text.replace(/^[+-]/, '').split('.');
  if (!options.round && fraction.length > digits && /[1-9]/.test(fraction.slice(digits)))
    throw new Error(
      `Money has more than ${digits} decimal places for ${currency}; round the amount first or set round: half-up or half-even.`,
    );
  let minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.slice(0, digits).padEnd(digits, '0') || '0');
  const discarded = fraction.slice(digits);
  if (options.round && discarded) {
    const first = Number(discarded[0]);
    if (
      first > 5 ||
      (first === 5 && (/[1-9]/.test(discarded.slice(1)) || options.round === 'half-up' || minor % 2n !== 0n))
    )
      minor++;
  }
  return negative ? -minor : minor;
}

// String(number) uses a dot regardless of configured locale and may use exponent notation.
function expandNumber(text: string): string {
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
  if (!match) return text;
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  return (
    sign +
    (point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`)
  );
}

// Match the chosen source format before diagnosing offsets, so an ISO API and formatted export can coexist.
function normalizeDatetime(text: string, rule: ComparisonRule, source: string): number {
  const format = typeof rule.format === 'string' ? rule.format : rule.format?.[source];
  const zone = rule.sourceTimezones[source];
  const iso = text.replace(' ', 'T');
  const explanation = format ? DateTime.fromFormatExplain(text, format, { locale: rule.locale ?? 'en-US' }) : undefined;
  if (format && (!explanation?.rawMatches || explanation.invalidReason))
    throw new Error(`Datetime value does not match configured format "${format}" for source ${source}.`);
  const hasTime = format
    ? explanation?.tokens.some((token) => !token.literal && /^[HhmsSatTfF]/.test(token.val))
    : /[T:]/.test(iso);
  if (!hasTime && (format || DateTime.fromISO(iso, { zone: 'UTC' }).isValid))
    throw new Error('Datetime date has no time; supply a date and time, or a format that includes time.');
  const explicitZone = format
    ? typeof explanation?.matches?.Z === 'number'
    : /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text);
  const date = format
    ? DateTime.fromFormat(text, format, { zone: zone ?? 'UTC', setZone: true, locale: rule.locale ?? 'en-US' })
    : DateTime.fromISO(iso, { zone: zone ?? 'UTC', setZone: true });
  if (!date.isValid)
    throw new Error(
      `Invalid ${format ? 'formatted' : 'ISO'} datetime for ${source}; check the value, format and sourceTimezones.`,
    );
  if (!explicitZone && !zone && !explanation?.zone)
    throw new Error(`Datetime has no offset; set sourceTimezones.${source} or supply an ISO 8601 offset.`);
  validateLocalTime(date, explicitZone, explanation, iso);
  return date.toUTC().toMillis();
}
// Luxon shifts nonexistent local times; reject that shift and require explicit offsets for overlaps.
function validateLocalTime(
  date: DateTime,
  explicitZone: boolean,
  explanation: ExplainedFormat | undefined,
  iso: string,
): void {
  if (explicitZone) return;
  if (date.getPossibleOffsets().length > 1)
    throw new Error('Datetime is ambiguous during a daylight-saving transition; include an explicit UTC offset.');
  const parsed: Record<string, unknown> = explanation?.result ?? {};
  const changed = explanation
    ? (['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'] as const).some(
        (part) => typeof parsed[part] === 'number' && parsed[part] !== date[part],
      )
    : date.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS").slice(0, iso.length) !== iso;
  if (changed) throw new Error('Datetime falls in a daylight-saving gap; include a valid UTC offset.');
}

export function normalize(value: unknown, rule: ComparisonRule | undefined, source: string): NormalizedValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    const local: unknown = Reflect.get(value, wallClock);
    if (typeof local === 'string' && rule?.type === 'datetime') {
      const isoRule = { ...rule, format: undefined };
      try {
        return normalizeDatetime(local, isoRule, source);
      } catch (error) {
        if (error instanceof Error && /ambiguous/.test(error.message))
          throw new Error(
            'Excel date serial is ambiguous during daylight saving; use a time zone column or export text with an offset.',
          );
        throw error;
      }
    }
    value = value.toISOString();
  }
  if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value))
    throw new Error('Expected a scalar field; map a scalar JSONPath or file column.');
  const text = String(value).trim();
  if (text === '' && (rule?.emptyAsNull ?? true)) return null;
  if (!rule) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Expected a finite number.');
    return typeof value === 'string' ? text : (value as NormalizedValue);
  }
  switch (rule.type) {
    case 'string':
      return rule.caseFold ? text.toLocaleLowerCase(rule.locale ?? 'en-US') : text;
    case 'enum': {
      const mapped = Object.hasOwn(rule.map, text) ? (rule.map[text] ?? text) : text;
      return rule.caseFold ? mapped.toLocaleLowerCase(rule.locale ?? 'en-US') : mapped;
    }
    case 'money': {
      if (typeof value === 'number') {
        if (!rule.allowNumber)
          throw new Error(
            'Money must be a decimal string; return strings from the API or set allowNumber: true after reviewing numeric precision.',
          );
        if (!Number.isFinite(value)) throw new Error('Money number must be finite.');
        return moneyMinor(expandNumber(String(value)), rule.currency ?? 'USD', 'en-US', {
          ...rule,
          numberFormat: undefined,
        });
      }
      return moneyMinor(text, rule.currency ?? 'USD', rule.locale, rule);
    }
    case 'number': {
      const number =
        typeof value === 'number' ? value : Number(decimalText(text, rule.locale ?? 'en-US', rule.numberFormat));
      if (!Number.isFinite(number)) throw new Error('Expected a finite decimal number.');
      return number;
    }
    case 'datetime':
      return normalizeDatetime(text, rule, source);
  }
}

export function equalValues(a: NormalizedValue, b: NormalizedValue, rule?: ComparisonRule): boolean {
  if (!rule) return a == null || b == null ? a === b : String(a).trim() === String(b).trim();
  if (typeof a === 'bigint' && typeof b === 'bigint') return (a > b ? a - b : b - a) <= BigInt(rule?.tolerance ?? 0);
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) <= (rule?.type === 'datetime' ? rule.toleranceSeconds * 1000 : (rule?.tolerance ?? 0));
  return a === b;
}
