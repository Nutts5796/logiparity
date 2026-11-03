import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeConsole, reportGroups, type Report } from '@logiparity/core';
import type { InvariantResult } from './invariants.js';

export interface ScenarioReport {
  schemaVersion: 1;
  kind: 'scenario';
  name: string;
  target: string;
  environment: 'test' | 'staging';
  events: { step: number; type: string; completed: boolean }[];
  invariants: InvariantResult[];
  warnings?: string[];
  parity?: Report;
  error?: string;
  exitCode: 0 | 1 | 2;
}
const escape = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const xml = (value: string) =>
  escape(
    [...value]
      .map((c) => {
        const n = c.codePointAt(0) ?? 0;
        return n === 9 || n === 10 || n === 13 || (n >= 32 && n !== 0xfffe && n !== 0xffff) ? c : '\ufffd';
      })
      .join(''),
  );
const cell = (value: string) => escape(value).replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
export function scenarioMarkdown(report: ScenarioReport): string {
  return `# ${cell(report.name)}\n\nSynthetic test/staging scenario · Target: ${cell(report.target)} · Exit: ${report.exitCode}\n\n${report.warnings?.length ? `Warnings (${report.warnings.length}):\n${report.warnings.map((warning) => `- ${cell(warning)}`).join('\n')}\n\n` : ''}${report.error ? `Runtime error: ${cell(report.error)}\n\n` : ''}| Invariant | Result | Affected keys | Explanation |\n| --- | --- | --- | --- |\n${report.invariants.map((i) => `| ${cell(i.name)} | ${i.passed ? 'PASS' : 'FAIL'} | ${cell(i.affectedKeys.join(', '))} | ${cell(i.explanation)} |`).join('\n')}\n\n${report.parity ? '[Post-scenario Parity report](parity/report.md)\n' : ''}`;
}
export function scenarioHtml(report: ScenarioReport): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>${escape(report.name)}</title><style>body{font:16px/1.5 system-ui;background:#f5f7f3;color:#19392e;margin:0}main{max-width:1200px;margin:auto;padding:32px}h1{letter-spacing:-1px}table{border-collapse:collapse;background:white;width:100%}td,th{padding:14px;border-bottom:1px solid #dae3d5;text-align:left;vertical-align:top}td.keys{max-width:300px;overflow-wrap:anywhere;font-family:monospace}.scroll{overflow:auto}.fail{color:#a42d23}.pass,a{color:#126c4f}.badge{font-size:13px;text-transform:uppercase;letter-spacing:.06em}</style></head><body><main><p class="badge">LogiParity · Test/staging only</p><h1>${escape(report.name)}</h1><p>Target ${escape(report.target)} · ${escape(report.environment)} · ${report.events.filter((e) => e.completed).length}/${report.events.length} events completed · Exit ${report.exitCode}</p>${report.warnings?.length ? `<section><h2>Warnings (${report.warnings.length})</h2><ul>${report.warnings.map((warning) => `<li>${escape(warning)}</li>`).join('')}</ul></section>` : ''}${report.error ? `<p class="fail">Runtime error: ${escape(report.error)}</p>` : ''}<div class="scroll"><table><thead><tr><th>Invariant</th><th>Result</th><th>Affected keys</th><th>Explanation</th></tr></thead><tbody>${report.invariants.map((i) => `<tr><td>${escape(i.name)}</td><td class="${i.passed ? 'pass' : 'fail'}">${i.passed ? 'PASS' : 'FAIL'}</td><td class="keys">${escape(i.affectedKeys.join(', ') || '—')}</td><td>${escape(i.explanation)}</td></tr>`).join('')}</tbody></table></div>${
    report.parity && reportGroups(report.parity).length
      ? `<section><h2>Patterns to investigate</h2><ul>${reportGroups(report.parity)
          .map((g) => `<li>${escape(g.entity)}: ${escape(g.summary)}</li>`)
          .join('')}</ul></section>`
      : ''
  }${report.parity ? '<p><a href="parity/report.html">Open post-scenario Parity report</a></p>' : ''}<p>Events and replanning mutate only the explicitly configured test/staging target. Demo data is synthetic.</p></main></body></html>`;
}
export function scenarioJunit(report: ScenarioReport, timestamp = new Date()): string {
  const checks = [
    ...report.invariants.map((i) => ({
      name: i.name,
      failure: i.passed ? '' : `${i.explanation} Affected keys: ${i.affectedKeys.join(', ')}`,
      error: '',
    })),
    ...(report.parity
      ? [
          {
            name: 'post_scenario_parity',
            failure: report.parity.findings.some((f) => f.blocking !== false && f.type !== 'source_error')
              ? 'See parity/junit.xml for field-level failures.'
              : '',
            error: report.parity.findings.some((f) => f.type === 'source_error')
              ? 'Post-scenario Parity source error; see parity/junit.xml.'
              : '',
          },
        ]
      : []),
    ...(report.error ? [{ name: 'scenario_runtime', failure: '', error: report.error }] : []),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="${xml(report.name)}" package="logiparity.scenario" id="0" timestamp="${timestamp.toISOString().slice(0, 19)}" hostname="localhost" tests="${checks.length}" failures="${checks.filter((c) => c.failure).length}" errors="${checks.filter((c) => c.error).length}" skipped="0" time="0"><properties><property name="warnings" value="${report.warnings?.length ?? 0}"/><property name="timing" value="not measured; time=0 is a placeholder"/><property name="timestamp.timezone" value="UTC"/></properties>${checks.map((c) => `<testcase name="${xml(c.name)}" classname="logiparity.scenario" time="0">${c.error ? `<error type="runtime" message="Scenario runtime error">${xml(c.error)}</error>` : c.failure ? `<failure type="invariant" message="Scenario check failed">${xml(c.failure)}</failure>` : ''}</testcase>`).join('')}<system-out>${xml((report.warnings ?? []).map((warning) => `Warning: ${warning}`).join('\n'))}</system-out><system-err/></testsuite></testsuites>\n`;
}
export async function writeScenarioReport(report: ScenarioReport, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const [file, content] of [
    [
      'scenario.json',
      JSON.stringify(report, (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value), 2) + '\n',
    ],
    ['scenario.html', scenarioHtml(report)],
    ['scenario.md', scenarioMarkdown(report)],
    ['junit.xml', scenarioJunit(report)],
  ])
    await writeFile(join(directory, file!), content!, 'utf8');
}
export function scenarioConsole(report: ScenarioReport): string {
  return safeConsole(
    `Scenario: ${report.name} (${report.target}/${report.environment})\n${report.invariants.map((i) => `  ${i.passed ? 'PASS' : 'FAIL'} ${i.name}: ${i.explanation}${i.affectedKeys.length ? ` Keys: ${i.affectedKeys.join(', ')}` : ''}`).join('\n')}\n${report.warnings?.length ? `Warnings: ${report.warnings.length}\n${report.warnings.map((warning) => `  Warning: ${warning}`).join('\n')}\n` : ''}${report.error ? `  Runtime error: ${report.error}\n` : ''}Exit: ${report.exitCode}\n`,
  );
}
