import { reportLabels, humanize } from './labels.js';
import { findingKey } from './keys.js';
import {
  durationValue,
  formatMoneyMajor,
  presentationValue,
  presentationDifference,
  type ReportPresentation,
} from './money-display.js';
import type { Finding, FindingGroup, FindingType, Report } from './types.js';
import { isBlocking } from './policy.js';
export const typeLabels: Record<FindingType, string> = {
  missing_in_source: 'Missing',
  field_mismatch: 'Value differences',
  aggregate_mismatch: 'Total differences',
  extra_in_source: 'Extra',
  duplicate_key: 'Duplicate keys',
  duplicate_value: 'Repeated values',
  invalid_value: 'Invalid values',
  source_error: 'Source errors',
};
export const numberText = (value: number | bigint) => value.toLocaleString('en-US').replace(/^-/, '−');
export const quantity = (value: number, singular: string, plural = singular + 's') =>
  `${numberText(value)} ${value === 1 ? singular : plural}`;
export function reportCounts(report: Report) {
  const findings = report.findings.filter((finding) => finding.type !== 'source_error');
  return {
    findings: findings.length,
    blocking: findings.filter(isBlocking).length,
    errors: report.findings.length - findings.length,
    warnings: report.warnings?.length ?? 0,
  };
}
function findingDetails(finding: Finding, presentation: ReportPresentation): string {
  const labels = reportLabels(presentation);
  const entity = labels.entity(finding.entity);
  const field = labels.field(finding.entity, finding.field, finding.type === 'aggregate_mismatch');
  const reference = Object.keys(entity?.sources ?? {})[0] ?? 'reference';
  if (finding.accounting) return `Follows from: ${finding.accounting.causes.join(', ')}.`;
  if (finding.type === 'missing_in_source')
    return `Missing from ${labels.source(finding.entity, finding.source)}${finding.amounts?.length ? ': ' + finding.amounts.map((item) => (item.currency ? formatMoneyMajor(BigInt(item.amount), item.currency) : presentationValue(item.amount, finding.entity, item.field, false, presentation))).join(', ') : ''}.`;
  if (finding.type === 'extra_in_source') {
    const key =
      finding.keyParts?.length === 2 && Array.isArray(entity?.key) && entity.key[1] === 'charge'
        ? `${humanize(finding.keyParts[1] ?? '')} on ${finding.keyParts[0]}`
        : findingKey(finding);
    const money = finding.amounts
      ?.map((item) =>
        item.currency
          ? formatMoneyMajor(BigInt(item.amount), item.currency)
          : presentationValue(item.amount, finding.entity, item.field, false, presentation),
      )
      .join(', ');
    return `${key}: not on ${labels.source(finding.entity, reference)}${money ? ', ' + money : ''}.`;
  }
  if (finding.type === 'aggregate_mismatch')
    return `${field} differs from ${labels.source(finding.entity, reference)}.`;
  if (finding.type === 'duplicate_value') {
    const amounts = finding.amounts
      ?.map((item) =>
        item.currency
          ? formatMoneyMajor(BigInt(item.amount), item.currency)
          : presentationValue(item.amount, finding.entity, item.field, false, presentation),
      )
      .join(', ');
    return `${field} ${String(finding.actual)} appears on ${(finding.relatedKeys ?? []).join(' and ')}${amounts ? '; amounts on additional records: ' + amounts : ''}.`;
  }
  if (finding.type === 'field_mismatch' && !finding.reason) return '';
  let message = finding.message;
  for (const name of Object.keys(entity?.compare ?? {}))
    message = message.replaceAll(name, labels.field(finding.entity, name));
  return message;
}
export function humanFinding(finding: Finding, presentation: ReportPresentation = {}) {
  const labels = reportLabels(presentation),
    aggregate = finding.type === 'aggregate_mismatch';
  const shown = (value: Finding['actual']) =>
    finding.currency && (typeof value === 'bigint' || (typeof value === 'string' && /^-?\d+$/.test(value)))
      ? formatMoneyMajor(BigInt(value), finding.currency)
      : presentationValue(value, finding.entity, finding.field, aggregate, presentation);
  const reference =
    finding.type === 'missing_in_source'
      ? 'Present'
      : finding.type === 'extra_in_source'
        ? 'Absent'
        : shown(finding.expected);
  const sourceValue =
    finding.type === 'missing_in_source'
      ? 'Missing'
      : finding.type === 'extra_in_source'
        ? 'Present'
        : shown(finding.actual);
  return {
    key: finding.key
      ? finding.keyParts?.length
        ? finding.keyParts.map((part, index) => (index ? humanize(part) : part)).join(' · ')
        : findingKey(finding)
      : aggregate
        ? labels.all(finding.entity)
        : 'Source',
    source: labels.source(finding.entity, finding.source),
    field: finding.type === 'source_error' ? 'Connection' : labels.field(finding.entity, finding.field, aggregate),
    reference,
    sourceValue,
    difference:
      finding.currency && typeof finding.actual === 'bigint' && typeof finding.expected === 'bigint'
        ? `${finding.actual > finding.expected ? '+' : ''}${formatMoneyMajor(finding.actual - finding.expected, finding.currency)}`
        : presentationDifference(
            finding.expected,
            finding.actual,
            finding.entity,
            finding.field,
            aggregate,
            presentation,
          ),
    type: typeLabels[finding.type],
    details:
      finding.values
        ?.map(
          (item) =>
            `Row ${numberText(item.row)}: ${presentationValue(item.value, finding.entity, finding.field, false, presentation)}`,
        )
        .map((value, index) => (index === 0 ? `${findingDetails(finding, presentation)} ${value}` : value))
        .join('; ') ?? findingDetails(finding, presentation),
  };
}
export function patternWords(group: FindingGroup, presentation: ReportPresentation = {}) {
  const labels = reportLabels(presentation),
    source = labels.source(group.entity, group.source),
    field = labels.field(group.entity, group.field),
    delta = BigInt(group.delta ?? 0);
  if (group.kind.endsWith('_stride'))
    return group.cause !== 'pagination'
      ? {
          label: 'Repeated missing rows',
          sentence: `${quantity(group.count, group.kind === 'missing_stride' ? 'missing row' : 'extra row')} in ${source}: every ${group.stride}th row.`,
          nextStep: `Compare the export selection and missing keys in ${source}.`,
          hint: 'A regular sequence of rows is absent; check the source export.',
        }
      : {
          label: 'Page boundary',
          sentence: `${quantity(group.count, group.kind === 'missing_stride' ? 'missing row' : 'extra row')} in ${source} follow page boundaries.`,
          nextStep: `Check pagination in ${source}, including the last partial page.`,
          hint: 'Likely a pagination boundary defect.',
        };
  if (group.kind === 'datetime_offset')
    return group.cause !== 'timezone'
      ? {
          label: 'Datetime offset',
          sentence: `${numberText(group.count)} ${field.toLowerCase()} values in ${source} differ by ${durationValue(delta)}.`,
          nextStep: `Compare the original timestamps and clock settings in ${source}.`,
          hint: 'Repeated datetime offset; check the original timestamps.',
        }
      : {
          label: 'Timezone',
          sentence: `${numberText(group.count)} ${field.toLowerCase()} values in ${source} differ by ${durationValue(delta)}.`,
          nextStep: `Set sourceTimezones.${group.source} to the zone the export writes in.`,
          hint: 'Likely local time written without an offset.',
        };
  if (group.kind === 'money_delta') {
    const rule = labels.entity(group.entity)?.compare[group.field];
    const currency = group.currency ?? rule?.currency;
    const difference = currency ? formatMoneyMajor(delta, currency) : `${delta} minor units`;
    const small = delta >= -3n && delta <= 3n;
    return {
      label: small ? 'Rounding' : 'Fixed difference',
      sentence: `${numberText(group.count)} ${field.toLowerCase()} values in ${source} differ by ${difference}.`,
      nextStep: small
        ? `Compare the rounding rules for ${field.toLowerCase()} across the sources.`
        : `Review the charge rules and fixed adjustments for ${field.toLowerCase()}.`,
      hint: small
        ? 'Likely a different rounding rule than the reference.'
        : 'Likely a fixed adjustment. These repeated values have a consistent fixed difference.',
    };
  }
  return {
    label: 'Value mapping',
    sentence: `${numberText(group.count)} ${field.toLowerCase()} values in ${source} map ${humanize(String(group.expected))} to ${humanize(String(group.actual))}.`,
    nextStep: `Check the ${field.toLowerCase()} mapping for ${source}.`,
    hint: 'Likely a different vocabulary for the same field.',
  };
}
export function markdownCell(text: string): string {
  return text
    .replaceAll('@', '&#64;')
    .replace(/[\\`*_{}[\]<>|]/g, '\\$&')
    .replace(/\r\n|\r|\n/g, ' ');
}

export function mergedPatternWords(groups: readonly FindingGroup[], presentation: ReportPresentation = {}) {
  const buckets = new Map<string, FindingGroup[]>();
  for (const group of groups) {
    const key = JSON.stringify(
      [
        group.entity,
        group.kind,
        group.field,
        group.delta,
        group.stride,
        group.expected,
        group.actual,
        group.currency,
        group.cause,
      ],
      (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value),
    );
    const values = buckets.get(key) ?? [];
    values.push(group);
    buckets.set(key, values);
  }
  return [...buckets.values()].map((values) => {
    const first = values[0];
    if (!first) throw new Error('Empty pattern bucket');
    const words = patternWords(first, presentation);
    if (values.length === 1) return words;
    const labels = reportLabels(presentation);
    return {
      ...words,
      sentence:
        values
          .map(
            (group) =>
              `${numberText(group.count)} ${labels.field(group.entity, group.field || 'rows').toLowerCase()} values in ${labels.source(group.entity, group.source)}`,
          )
          .join(' and ') +
        `. ${words.label}: ${first.delta ? durationOrMoney(first, presentation) : `every ${first.stride}th row`}.`,
      nextStep:
        first.kind === 'datetime_offset'
          ? first.cause === 'timezone'
            ? `Set sourceTimezones for ${values.map((group) => labels.source(group.entity, group.source)).join(' and ')} to the zones each export writes in.`
            : `Compare original timestamps and clock settings in ${values.map((group) => labels.source(group.entity, group.source)).join(' and ')}.`
          : [...new Set(values.map((group) => patternWords(group, presentation).nextStep))].join(' '),
    };
  });
}
function durationOrMoney(group: FindingGroup, presentation: ReportPresentation): string {
  const rule = reportLabels(presentation).entity(group.entity)?.compare[group.field];
  return group.kind === 'money_delta'
    ? formatMoneyMajor(BigInt(group.delta ?? 0), group.currency ?? rule?.currency ?? 'USD')
    : durationValue(BigInt(group.delta ?? 0));
}
