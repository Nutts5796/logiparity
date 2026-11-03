import { reportLabels, ordinal, sentenceLabel } from './labels.js';
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
  if (finding.type === 'extra_in_source')
    return `Extra on ${labels.source(finding.entity, finding.source)}${finding.amounts?.length ? ': ' + finding.amounts.map((item) => (item.currency ? formatMoneyMajor(BigInt(item.amount), item.currency) : presentationValue(item.amount, finding.entity, item.field, false, presentation))).join(', ') : ''}.`;
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
  if (finding.type === 'field_mismatch' && !finding.reason)
    return `${field} differs from ${labels.source(finding.entity, reference)}.`;
  return finding.message;
}
export function humanFinding(finding: Finding, presentation: ReportPresentation = {}) {
  if (finding.evidence?.timezone) presentation = { ...presentation, displayTimezone: finding.evidence.timezone };
  const labels = reportLabels(presentation),
    aggregate = finding.type === 'aggregate_mismatch';
  const shown = (value: Finding['actual']) =>
    finding.currency && (typeof value === 'bigint' || (typeof value === 'string' && /^-?\d+$/.test(value)))
      ? formatMoneyMajor(BigInt(value), finding.currency)
      : presentationValue(value, finding.entity, finding.field, aggregate, presentation);
  const invalidReference = finding.evidence?.referenceInvalid;
  const reference = invalidReference
    ? finding.evidence?.referenceValue === undefined
      ? 'Invalid reference'
      : `Invalid: ${shown(finding.evidence.referenceValue)}`
    : finding.evidence?.referenceUncertain
      ? 'Uncertain reference'
      : finding.type === 'missing_in_source'
        ? 'Present'
        : finding.type === 'extra_in_source'
          ? 'Absent'
          : shown(finding.expected);
  const sourceValue =
    invalidReference && finding.source === Object.keys(labels.entity(finding.entity)?.sources ?? {})[0]
      ? 'Not compared'
      : finding.type === 'missing_in_source'
        ? 'Missing'
        : finding.type === 'extra_in_source'
          ? 'Present'
          : shown(finding.actual);
  return {
    key: finding.key
      ? finding.keyParts?.length
        ? finding.keyParts.join(' · ')
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
    type: finding.reason === 'currency_mismatch' ? 'Currency difference' : typeLabels[finding.type],
    details:
      (finding.values
        ?.map(
          (item) =>
            `Row ${numberText(item.row)}: ${presentationValue(item.value, finding.entity, finding.field, false, presentation)}`,
        )
        .map((value, index) => (index === 0 ? `${findingDetails(finding, presentation)} ${value}` : value))
        .join('; ') ?? findingDetails(finding, presentation)) + (finding.hint ? ` ${finding.hint}` : ''),
  };
}
export function patternWords(group: FindingGroup, presentation: ReportPresentation = {}) {
  const labels = reportLabels(presentation),
    source = labels.source(group.entity, group.source),
    field = sentenceLabel(labels.field(group.entity, group.field)),
    delta = BigInt(group.delta ?? 0);
  if (group.kind.endsWith('_stride'))
    return group.cause !== 'pagination'
      ? {
          label: 'Repeated missing rows',
          sentence: `${quantity(group.count, group.kind === 'missing_stride' ? 'missing row' : 'extra row')} in ${source}: every ${ordinal(group.stride ?? 0)} row.`,
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
          sentence: `${numberText(group.count)} ${field} values in ${source} differ by ${durationValue(delta)}.`,
          nextStep: `Compare the original timestamps and clock settings in ${source}.`,
          hint: 'Repeated datetime offset.',
        }
      : {
          label: 'Timezone',
          sentence: `${numberText(group.count)} ${field} values in ${source} differ by ${durationValue(delta)}.`,
          nextStep: labels.entity(group.entity)?.compare[group.field]?.sourceTimezones[group.source]
            ? `Check facility-local timestamps or supply a per-row time zone in ${source}.`
            : `Set sourceTimezones.${group.source} to the zone the export writes in.`,
          hint: 'Likely local time written without an offset.',
        };
  if (group.kind === 'money_delta') {
    const rule = labels.entity(group.entity)?.compare[group.field];
    const currency = group.currency ?? rule?.currency;
    const difference = currency ? formatMoneyMajor(delta, currency) : `${delta} minor units`;
    const small = delta >= -3n && delta <= 3n;
    return {
      label: small ? 'Rounding' : 'Fixed difference',
      sentence: `${numberText(group.count)} ${field} values in ${source} differ by ${difference}.`,
      nextStep: small
        ? `Compare the rounding rules for ${field} across the sources.`
        : `Review the charge rules and fixed adjustments for ${field}.`,
      hint: small
        ? 'Likely a different rounding rule than the reference.'
        : 'These repeated values have a consistent fixed difference.',
    };
  }
  const value = (input: Finding['actual']) => presentationValue(input, group.entity, group.field, false, presentation);
  if (group.cause === 'stale_value')
    return {
      label: 'Stale or lagging values',
      sentence: `${numberText(group.count)} of ${numberText(group.referenceCount ?? group.count)} ${value(group.expected)} ${labels.entity(group.entity)?.pluralLabel ?? 'records'} show ${value(group.actual)} in ${source}; ${numberText(group.matchingCount ?? 0)} match.`,
      nextStep: `Check refresh timing and synchronization in ${source}; preserve the distinct ${field} values.`,
      hint: `Likely a stale or lagging ${field}.`,
    };
  return {
    label: 'Value mapping',
    sentence: `${numberText(group.count)} ${field} values in ${source} map ${value(group.expected)} to ${value(group.actual)}.`,
    nextStep: `Check the ${field} mapping for ${source}.`,
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
            (group, index) =>
              `${numberText(group.count)} ${first.kind === 'value_mapping' && index > 0 ? '' : (group.kind.endsWith('_stride') ? (group.kind === 'missing_stride' ? 'missing rows' : 'extra rows') : sentenceLabel(labels.field(group.entity, group.field)) + ' values') + ' '}in ${labels.source(group.entity, group.source)}`,
          )
          .join(' and ') +
        ` ${
          first.kind.endsWith('_stride')
            ? `follow ${first.cause === 'pagination' ? 'page boundaries' : `every ${ordinal(first.stride ?? 0)} row`}`
            : first.kind === 'value_mapping'
              ? `show ${presentationValue(first.actual, first.entity, first.field, false, presentation)} where ${labels.source(first.entity, Object.keys(labels.entity(first.entity)?.sources ?? {})[0] ?? 'reference')} shows ${presentationValue(first.expected, first.entity, first.field, false, presentation)}`
              : `differ by ${durationOrMoney(first, presentation)}`
        }.`,
      nextStep:
        first.kind === 'datetime_offset'
          ? first.cause === 'timezone'
            ? `Check facility-local timestamps and the configured source time zones in ${values.map((group) => labels.source(group.entity, group.source)).join(' and ')}.`
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

export function matchingHeadline(report: Report): string {
  const parts = report.entities.map((entity) => ({
    count: entity.uniqueCounts?.[entity.reference] ?? entity.counts[entity.reference] ?? 0,
    label: entity.pluralLabel ?? 'records',
  }));
  if (!parts.length) return 'All configured comparisons match';
  if (parts.every((part) => part.count === 0)) return 'No records were compared';
  return `All ${parts.map((part) => `${numberText(part.count)} ${part.label}`).join(' and ')} match`;
}
