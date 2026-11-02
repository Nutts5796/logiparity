import type { EntityConfig } from './config.js';
import type { NormalizedValue } from './types.js';
import { displayValue } from './report-utils.js';

// Presentation context stays outside Report, preserving the JSON wire format.
export interface ReportPresentation { entities?: readonly EntityConfig[] }

export function formatMoneyMajor(minor: bigint, currency: string, locale = 'en-US'): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  const factor = 10n ** BigInt(digits);
  const absolute = minor < 0n ? -minor : minor;
  const whole = absolute / factor;
  // Use a negative integer template even for -0.xx, preserving the minus sign.
  const template = minor < 0n ? -(whole || 1n) : whole;
  const fraction = digits ? new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: digits }).format(absolute % factor) : '';
  return formatter.formatToParts(template).map((part) => {
    if (part.type === 'fraction') return fraction;
    if (part.type === 'integer' && minor < 0n && whole === 0n) return new Intl.NumberFormat(locale, { useGrouping: false }).format(0n);
    return part.value;
  }).join('');
}

export function presentationValue(value: NormalizedValue | undefined, entityName: string, field: string, aggregate: boolean, presentation: ReportPresentation = {}): string {
  const plain = displayValue(value);
  const entity = presentation.entities?.find((e) => e.name === entityName);
  let moneyField = field;
  if (aggregate) {
    const definition = entity?.aggregates.find((a) => a.name === field);
    if (definition?.type !== 'sum') return plain;
    moneyField = definition.field;
  }
  const rule = entity?.compare[moneyField];
  if (rule?.type !== 'money' || !rule.currency || (typeof value !== 'bigint' && !(typeof value === 'string' && /^-?\d+$/.test(value)))) return plain;
  return `${plain} (${formatMoneyMajor(BigInt(value), rule.currency, rule.locale)})`;
}
