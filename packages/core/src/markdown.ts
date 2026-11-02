import { isBlocking } from './policy.js';
import { displayValue, escapeMarkup, findingTypes, verdict } from './report-utils.js';
import type { Report } from './types.js';

function cell(text: string): string {
  return escapeMarkup(text).replace(/[\\`*_[\]{}()!~]/g, '\\$&').replaceAll('|', '&#124;').replace(/\r\n|\r|\n/g, '<br>');
}

export function markdownReport(report: Report): string {
  const lines = ['# LogiParity report', '', `**${verdict(report)}** · ${report.entities.length} entities · ${report.findings.length} findings · ${report.findings.filter(isBlocking).length} blocking`, '', 'Test and staging environments only. Money values are integer minor units; datetime values are UTC epoch milliseconds.', '', '| Finding type | Total | Blocking |', '| --- | ---: | ---: |'];
  for (const type of findingTypes) {
    const findings = report.findings.filter((f) => f.type === type);
    lines.push(`| ${type} | ${findings.length} | ${findings.filter(isBlocking).length} |`);
  }
  const aggregates = report.entities.flatMap((e) => (e.aggregates ?? []).map((a) => ({ entity: e.entity, ...a })));
  if (aggregates.length) {
    lines.push('', '## Aggregates', '', '| Entity | Aggregate | Values by source | Skipped sources |', '| --- | --- | --- | --- |');
    for (const a of aggregates) lines.push(`| ${cell(a.entity)} | ${cell(a.name)} | ${cell(Object.entries(a.values).map(([source, value]) => `${source}: ${value}`).join('; '))} | ${cell(a.skippedSources.join(', ') || '—')} |`);
  }
  if (report.findings.length) {
    lines.push('', '## Findings', '', '| Entity | Source | Key | Field | Type | Blocking | Expected | Actual | Explanation |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const f of report.findings.slice(0, 50)) lines.push(`| ${[f.entity, f.source, f.key || '—', f.field || '—', f.type, isBlocking(f) ? 'yes' : 'no', displayValue(f.expected), displayValue(f.actual), f.message].map(cell).join(' | ')} |`);
    if (report.findings.length > 50) lines.push('', `${report.findings.length - 50} further findings omitted from this summary. Select HTML or JSON output for the complete finding list.`);
  }
  return lines.join('\n') + '\n';
}
