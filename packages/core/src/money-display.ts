import type { EntityConfig } from './config.js';
import type { NormalizedValue, AggregateResult } from './types.js';
import { humanize, presentationRule } from './labels.js';
import { displayValue } from './report-utils.js';

// Presentation context stays outside Report, preserving the JSON wire format.
export interface ReportPresentation {
  fileMode?: number;
  reportFiles?: string[];
  reportRoot?: string;
  entities?: readonly EntityConfig[];
  patterns?: { minCount: number };
  environment?: string;
  configFile?: string;
  generatedAt?: string;
  displayTimezone?: string;
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
    .join('')
    .replace(/^-/, '−');
}

export function presentationValue(
  value: NormalizedValue | undefined,
  entityName: string,
  field: string,
  aggregate: boolean,
  presentation: ReportPresentation = {},
): string {
  const plain =
    typeof value === 'number' || typeof value === 'bigint'
      ? value.toLocaleString('en-US', { maximumFractionDigits: 12 }).replace(/^-/, '−')
      : displayValue(value);
  const entity = presentation.entities?.find((e) => e.name === entityName);
  const rule = presentationRule(entity, field, aggregate);
  if (!rule && !aggregate) return displayValue(value);
  if (rule?.type === 'datetime' && typeof value === 'number')
    return readableDatetime(value, presentation.displayTimezone) ?? plain;
  if (rule?.type === 'enum' && typeof value === 'string') return humanize(value);
  if (rule?.type !== 'money' || !rule.currency || integerValue(value) === undefined) return plain;
  return formatMoneyMajor(integerValue(value)!, rule.currency);
}

export function integerValue(value: NormalizedValue | undefined): bigint | undefined {
  if (typeof value === 'bigint' || (typeof value === 'string' && /^-?\d+$/.test(value))) return BigInt(value);
  return typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : undefined;
}

export function readableDatetime(epoch: number, timeZone = 'UTC'): string | undefined {
  if (!formatDatetimeUtc(epoch)) return undefined;
  const date = new Date(epoch);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  const zone =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  return `${day}, ${time} ${zone}`;
}

export function durationValue(delta: bigint): string {
  const absolute = delta < 0n ? -delta : delta;
  const sign = delta < 0n ? '−' : delta > 0n ? '+' : '';
  for (const [unit, factor] of [
    ['d', 86400000n],
    ['h', 3600000n],
    ['m', 60000n],
    ['s', 1000n],
    ['ms', 1n],
  ] as const) {
    if (absolute >= factor || unit === 'ms') {
      const value = Number((absolute * 100n) / factor) / 100;
      return `${sign}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`;
    }
  }
  return '0 ms';
}
export function aggregateDisplay(
  aggregate: AggregateResult,
  source: string,
  entity: string,
  presentation: ReportPresentation,
): string {
  const currencies = aggregate.valuesByCurrency?.[source];
  if (currencies && Object.keys(currencies).length)
    return Object.entries(currencies)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, value]) => formatMoneyMajor(BigInt(value), currency))
      .join('; ');
  return presentationValue(aggregate.values[source], entity, aggregate.name, true, presentation);
}
export function rawAggregateDisplay(
  aggregate: AggregateResult,
  source: string,
  entity: string,
  presentation: ReportPresentation,
): string {
  if (aggregate.type === 'count') return '';
  const values = aggregate.rawValuesByCurrency?.[source],
    certain = aggregate.valuesByCurrency?.[source];
  const changed =
    values &&
    Object.keys({ ...values, ...certain }).some(
      (currency) => BigInt(values[currency] ?? 0) !== BigInt(certain?.[currency] ?? 0),
    );
  if (changed)
    return Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, value]) => formatMoneyMajor(BigInt(value), currency))
      .join('; ');
  const raw = aggregate.rawValues?.[source];
  return raw !== undefined && raw !== aggregate.values[source]
    ? presentationValue(raw, entity, aggregate.name, true, presentation)
    : '';
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
  if (!rule && !aggregate) return '—';
  const left = integerValue(expected),
    right = integerValue(actual);
  if (left !== undefined && right !== undefined) {
    const delta = right - left;
    if (rule?.type === 'datetime') return durationValue(delta);
    if (rule?.type === 'money') return `${delta > 0n ? '+' : ''}${formatMoneyMajor(delta, rule.currency!)}`;
    return `${delta > 0n ? '+' : ''}${delta.toLocaleString('en-US')}`.replace(/^-/, '−');
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    const delta = actual - expected;
    return `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US', { maximumFractionDigits: 12 })}`.replace(/^-/, '−');
  }
  return '—';
}

export function moneyUnits(minor: bigint, currency: string): string {
  const absolute = minor < 0n ? -minor : minor;
  const cents = ['USD', 'EUR', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD'].includes(currency);
  return `${absolute} ${cents ? (absolute === 1n ? 'cent' : 'cents') : `${currency} minor ${absolute === 1n ? 'unit' : 'units'}`}`;
}

export function aggregateDifference(
  aggregate: AggregateResult,
  source: string,
  reference: string,
  entity: string,
  presentation: ReportPresentation,
): string {
  if (source === reference || aggregate.values[source] === undefined || aggregate.values[reference] === undefined)
    return '—';
  const currencies = Object.keys({
    ...aggregate.valuesByCurrency?.[source],
    ...aggregate.valuesByCurrency?.[reference],
  }).sort();
  if (currencies.length)
    return currencies
      .map((currency) => {
        const delta =
          BigInt(aggregate.valuesByCurrency?.[source]?.[currency] ?? 0) -
          BigInt(aggregate.valuesByCurrency?.[reference]?.[currency] ?? 0);
        return `${delta > 0n ? '+' : ''}${formatMoneyMajor(delta, currency)}`;
      })
      .join('; ');
  return presentationDifference(
    aggregate.values[reference],
    aggregate.values[source],
    entity,
    aggregate.name,
    true,
    presentation,
  );
}
export function aggregateStatus(aggregate: AggregateResult, source: string, reference: string): string {
  if (aggregate.sourceStatus?.[source] === 'not_mapped') return 'Not mapped';
  if (aggregate.values[source] === undefined) return 'Not read';
  if (source === reference) return 'Reference';
  if (aggregate.uncertainKeys?.[source]?.length || aggregate.sourceStatus?.[source] === 'uncertain')
    return 'Uncertain lines';
  const currencies = Object.keys({
    ...aggregate.valuesByCurrency?.[source],
    ...aggregate.valuesByCurrency?.[reference],
  });
  const matches = currencies.length
    ? currencies.every(
        (currency) =>
          BigInt(aggregate.valuesByCurrency?.[source]?.[currency] ?? 0) ===
          BigInt(aggregate.valuesByCurrency?.[reference]?.[currency] ?? 0),
      )
    : aggregate.values[source] === aggregate.values[reference];
  if (matches) return 'Matches';
  const buckets = aggregate.reconciliationByCurrency?.[source];
  const parts = buckets
    ? Object.values(buckets)
    : aggregate.reconciliation?.[source]
      ? [aggregate.reconciliation[source]]
      : [];
  return parts.length && parts.every((part) => BigInt(part.remainder) === 0n && !part.uncertain?.keys.length)
    ? 'Accounted for'
    : 'Needs review';
}

export function durationPhrase(delta: bigint): string {
  const value = durationValue(delta < 0n ? -delta : delta).replace(/^\+/, '');
  const match = value.match(/^(.*?) (ms|s|m|h|d)$/);
  if (!match) return value;
  const count = Number((match[1] ?? '').replaceAll(',', ''));
  const unit =
    ({ ms: 'millisecond', s: 'second', m: 'minute', h: 'hour', d: 'day' } as Record<string, string>)[match[2] ?? ''] ??
    '';
  return `${match[1]} ${unit}${count === 1 ? '' : 's'} ${delta < 0n ? 'earlier' : 'later'}`;
}

export function displayTimezoneLabel(presentation: ReportPresentation): string {
  return presentation.entities?.some((entity) =>
    Object.values(entity.compare).some((rule) => rule.displayTimezoneField),
  )
    ? 'each facility’s time zone (shown beside each value)'
    : (presentation.displayTimezone ?? 'UTC');
}
