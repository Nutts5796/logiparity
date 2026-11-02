import { isBlocking } from './policy.js';
import { entityNames, escapeMarkup, findingDetail, findingTypes } from './report-utils.js';
import type { Report } from './types.js';

function xml(input: string): string {
  const valid = [...input].map((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || code >= 0x10000 ? char : '\ufffd';
  }).join('');
  return escapeMarkup(valid);
}

export function junitReport(report: Report, timestamp = new Date()): string {
  const suites = entityNames(report).map((entity, index) => {
    let failures = 0; let errors = 0; let skipped = 0;
    const cases = findingTypes.map((type) => {
      const findings = report.findings.filter((f) => f.entity === entity && f.type === type);
      let result = '';
      if (findings.length) {
        const blocking = findings.some(isBlocking);
        const tag = type === 'source_error' ? 'error' : blocking ? 'failure' : 'skipped';
        if (tag === 'error') errors++; else if (tag === 'failure') failures++; else skipped++;
        result = `<${tag}${tag === 'skipped' ? '' : ` type="${type}"`} message="${findings.length} findings${blocking ? '' : ' allowed by failOn'}">${xml(findings.map(findingDetail).join('\n\n'))}</${tag}>`;
      }
      return `    <testcase name="${type}" classname="${xml(`logiparity.${entity}`)}" time="0">${result}</testcase>`;
    });
    return `  <testsuite name="${xml(entity)}" package="logiparity" id="${index}" timestamp="${timestamp.toISOString().slice(0, 19)}" hostname="localhost" tests="${findingTypes.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="0">
    <properties><property name="timestamp.timezone" value="UTC"/><property name="timing" value="not measured; time=0 is the schema-required placeholder"/></properties>
${cases.join('\n')}
    <system-out/>
    <system-err/>
  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`;
}
