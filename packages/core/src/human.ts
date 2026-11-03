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
  extra_in_source: 'Extra',
  field_mismatch: 'Value differences',
  aggregate_mismatch: 'Total differences',
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
export function humanFinding(finding: Finding, presentation: ReportPresentation = {}) {
  const labels = reportLabels(presentation),
    aggregate = finding.type === 'aggregate_mismatch';
  const reference =
    finding.type === 'missing_in_source'
      ? 'Present'
      : finding.type === 'extra_in_source'
        ? 'Absent'
        : presentationValue(finding.expected, finding.entity, finding.field, aggregate, presentation);
  const sourceValue =
    finding.type === 'missing_in_source'
      ? 'Missing'
      : finding.type === 'extra_in_source'
        ? 'Present'
        : presentationValue(finding.actual, finding.entity, finding.field, aggregate, presentation);
  return {
    key: finding.key ? findingKey(finding) : aggregate ? labels.all(finding.entity) : 'Source',
    source: labels.source(finding.entity, finding.source),
    field: finding.type === 'source_error' ? 'Source' : labels.field(finding.entity, finding.field, aggregate),
    reference,
    sourceValue,
    difference: presentationDifference(
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
            `Row ${numberText(item.line)}: ${presentationValue(item.value, finding.entity, finding.field, false, presentation)}`,
        )
        .join('; ') ?? (finding.type !== 'field_mismatch' || finding.reason ? finding.message : ''),
  };
}
export function patternWords(group: FindingGroup, presentation: ReportPresentation = {}) {
  const labels = reportLabels(presentation),
    source = labels.source(group.entity, group.source),
    field = labels.field(group.entity, group.field),
    delta = BigInt(group.delta ?? 0);
  if (group.kind.endsWith('_stride'))
    return {
      label: 'Page boundary',
      sentence: `${quantity(group.count, group.kind === 'missing_stride' ? 'missing row' : 'extra row')} in ${source} follow page boundaries.`,
      nextStep: `Check pagination in ${source}, including the last partial page.`,
      hint: 'Likely a pagination bug. Check page boundaries and the last page.',
    };
  if (group.kind === 'datetime_offset')
    return {
      label: 'Timezone',
      sentence: `${numberText(group.count)} ${field.toLowerCase()} values in ${source} differ by ${durationValue(delta)}.`,
      nextStep: `Set sourceTimezones.${group.source} to the zone the export writes in.`,
      hint: 'Likely local time written without an offset.',
    };
  if (group.kind === 'money_delta') {
    const rule = labels.entity(group.entity)?.compare[group.field];
    const difference = rule?.currency ? formatMoneyMajor(delta, rule.currency) : `${delta} minor units`;
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
  return text.replace(/[\\`*_{}[\]<>|]/g, '\\$&').replace(/\r\n|\r|\n/g, ' ');
}
