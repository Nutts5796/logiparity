import { reconciliationDetails } from '../presentation/reconciliation-display.js';
import { redactTree, secretValues } from '../foundation/diagnostics.js';
import { reportGroups } from '../causes/groups.js';
import { mergedPatternWords } from '../presentation/human.js';
import { isBlocking } from '../foundation/policy.js';
import { entityNames, escapeMarkup, findingTypes } from '../presentation/report-utils.js';
import { humanFinding, quantity, typeLabels } from '../presentation/human.js';
import type { ReportPresentation } from '../presentation/money-display.js';
import { reportLabels } from '../presentation/labels.js';
import type { Report } from '../foundation/types.js';

function xml(input: string): string {
  const valid = [...input]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        code >= 0x10000
        ? char
        : '\ufffd';
    })
    .join('');
  return escapeMarkup(valid);
}

export function junitReport(report: Report, timestamp = new Date(), presentation: ReportPresentation = {}): string {
  const secrets = secretValues(presentation.entities);
  report = redactTree(report, secrets);
  presentation = redactTree(presentation, secrets);
  const suites = entityNames(report).map((entity, index) => {
    let failures = 0;
    let errors = 0;
    let skipped = 0;
    const cases = findingTypes.map((type) => {
      const findings = report.findings.filter((f) => f.entity === entity && f.type === type);
      const reference = report.entities.find((item) => item.entity === entity)?.reference;
      const referenceFailed = report.findings.some(
        (item) => item.entity === entity && item.source === reference && item.type === 'source_error',
      );
      let result = '';
      if (!findings.length && referenceFailed && type !== 'source_error') {
        result = '<skipped message="Reference source failed; comparison was not performed"/>';
        skipped++;
      }
      if (findings.length) {
        const blocking = findings.some(isBlocking);
        const tag = type === 'source_error' ? 'error' : blocking ? 'failure' : 'skipped';
        if (tag === 'error') errors++;
        else if (tag === 'failure') failures++;
        else skipped++;
        result = `<${tag}${tag === 'skipped' ? '' : ` type="${type}"`} message="${quantity(findings.length, type === 'source_error' ? 'source error' : 'finding')}${blocking ? '' : ' allowed by failOn'}">${xml(
          findings
            .slice(0, 10)
            .map((finding) => {
              const item = humanFinding(finding, presentation);
              return `${item.key} | ${item.source} | ${item.field} | Reference: ${item.reference} | Source value: ${item.sourceValue} | Difference: ${item.difference}${item.details ? ` | ${item.details}` : ''}`;
            })
            .join('\n') +
            (findings.length > 10
              ? `\n+${(findings.length - 10).toLocaleString('en-US')} more; see report.html or report.json (enable those report outputs for all details).`
              : ''),
        )}</${tag}>`;
      }
      return `    <testcase name="${xml(typeLabels[type])}" classname="${xml(`logiparity.${entity}`)}" time="0">${result}</testcase>`;
    });
    return `  <testsuite name="${xml(reportLabels(presentation).entity(entity)?.label ?? entity)}" package="logiparity" id="${index}" timestamp="${timestamp.toISOString().slice(0, 19)}" hostname="localhost" tests="${findingTypes.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="0">
    <properties><property name="warnings" value="${report.warnings?.length ?? 0}"/><property name="timestamp.timezone" value="UTC"/><property name="timing" value="not measured; time=0 is the schema-required placeholder"/></properties>
${cases.join('\n')}
    <system-out>${xml(
      [
        ...mergedPatternWords(
          reportGroups(report, presentation).filter((group) => group.entity === entity),
          presentation,
        ).map((words) => `${words.label}: ${words.sentence} ${words.hint} Next step: ${words.nextStep}`),
        ...reconciliationDetails(report, presentation, entity),
        ...(report.warnings ?? []).map((warning) => `Warning: ${warning.message}`),
      ].join('\n'),
    )}</system-out>
    <system-err/>
  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`;
}
