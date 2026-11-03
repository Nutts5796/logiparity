import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  safeConsole,
  studioStyle,
  brandMark,
  themeButton,
  themeScript,
  humanize,
  markdownCell,
  type Report,
} from '@logiparity/core';
import { createHash } from 'node:crypto';
import { invariantLabels, type InvariantResult } from './invariants.js';

export interface ScenarioReport {
  schemaVersion: 1;
  kind: 'scenario';
  name: string;
  target: string;
  environment: 'test' | 'staging';
  events: { step: number; type: string; completed: boolean }[];
  invariants: InvariantResult[];
  warnings?: string[];
  synthetic?: boolean;
  sourceLabels?: Record<string, string>;
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
const cell = markdownCell;
export function scenarioMarkdown(report: ScenarioReport): string {
  return `# ${cell(report.name)}\n\nTest or staging scenario · Target: ${cell(report.target)} · Exit: ${report.exitCode}\n\n${report.warnings?.length ? `Warnings (${report.warnings.length}):\n${report.warnings.map((warning) => `- ${cell(warning)}`).join('\n')}\n\n` : ''}${report.error ? `Runtime error: ${cell(report.error)}\n\n` : ''}| Invariant | Result | Affected keys | Explanation |\n| --- | --- | --- | --- |\n${report.invariants.map((i) => `| ${cell(label(i, report))} | ${i.passed ? 'PASS' : 'FAIL'} | ${cell(i.affectedKeys.join(', '))} | ${cell(i.explanation + (i.assignments?.length ? ` Drivers: ${assignmentText(i)}` : ''))} |`).join('\n')}\n\n${report.parity ? '[Post-scenario Parity report](parity/report.md)\n' : ''}`;
}
function label(result: InvariantResult, report: ScenarioReport): string {
  const name = invariantLabels[result.name] ?? humanize(result.name);
  return result.name === 'no_order_lost' && report.events.some((event) => event.type === 'vehicle_breakdown')
    ? 'Orders lost after the breakdown'
    : name;
}
function assignmentText(result: InvariantResult): string {
  return (result.assignments ?? [])
    .map(
      (item) =>
        `${item.key}: ${item.before.length ? item.before.join(', ') : 'none'} → ${item.after.length ? item.after.join(', ') : 'none'}`,
    )
    .join('; ');
}
export function scenarioHtml(report: ScenarioReport): string {
  const script = `(()=>{${themeScript}})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  const failed = report.invariants.filter((check) => !check.passed).length;
  const warnings = (report.warnings ?? [])
    .map(
      (warning) =>
        `<li>${escape(warning.replace(/https:\/\/\S+/g, ''))} <a href="https://github.com/Nutts5796/logiparity/blob/main/docs/scenarios.md#affected_reassigned">Read scenario checks</a></li>`,
    )
    .join('');
  const rows = report.invariants
    .map(
      (check) =>
        `<tr><td data-l="Check"><strong>${escape(label(check, report))}: ${check.affectedKeys.length.toLocaleString('en-US')}</strong><span class="sub-l">${escape(check.explanation)}</span></td><td data-l="Result"><span class="tag ${check.passed ? 't-ok' : 't-rev'}">${check.passed ? 'Passed' : 'Needs review'}</span></td><td data-l="Affected orders"><code>${escape(check.affectedKeys.join(', ') || 'None')}</code>${check.assignments?.length ? `<span class="details">Drivers: ${escape(assignmentText(check))}</span>` : ''}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'"><title>${escape(report.name)} · LogiParity</title><style>${studioStyle}</style></head><body><main class="wrap"><header class="top"><div class="brand">${brandMark}LogiParity <span class="sub">/ Scenario report</span></div><div class="top-r"><span class="chip">${escape(report.target)} · ${escape(report.environment)}</span>${themeButton}</div></header><section class="hero"><div class="card"><span class="status ${report.exitCode ? '' : 'passed'}" title="Exit code ${report.exitCode}">${report.exitCode ? 'Failed' : 'Passed'}</span><h1>${escape(report.name)}</h1><div class="big">${failed.toLocaleString('en-US')} checks need attention</div><p class="lead">${report.events.filter((event) => event.completed).length} of ${report.events.length} events completed.</p><div class="srcs">${Object.values(
    report.sourceLabels ?? {},
  )
    .map((source) => `<span class="chip">${escape(source)}</span>`)
    .join(
      '',
    )}</div></div><div class="card"><h2>After the disruption</h2><p>Review affected orders and their assignments against the baseline.</p>${report.parity ? '<a class="btn btn-soft" href="parity/report.html">Open reconciliation report</a>' : ''}</div></section>${warnings ? `<h3>Warnings</h3><section class="card"><ul>${warnings}</ul></section>` : ''}${report.error ? `<section class="card"><h2>Runtime error</h2><p>${escape(report.error)}</p></section>` : ''}<h3>Checks</h3><section class="card findings"><table><thead><tr><th>Check</th><th>Result</th><th>Affected orders and drivers</th></tr></thead><tbody>${rows}</tbody></table></section><footer>Events modify only the configured test or staging target.${report.synthetic ? ' Demo data is synthetic.' : ''}</footer></main><script>${script}</script></body></html>`;
}
export function scenarioJunit(report: ScenarioReport, timestamp = new Date()): string {
  const checks = [
    ...report.invariants.map((i) => ({
      name: label(i, report),
      failure: i.passed
        ? ''
        : `${i.explanation}${i.assignments?.length ? ` Drivers: ${assignmentText(i)}` : ''} Affected keys: ${i.affectedKeys.join(', ')}`,
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
    `Scenario: ${report.name} (${report.target}/${report.environment})\n${report.invariants.map((i) => `  ${i.passed ? 'PASS' : 'FAIL'} ${label(i, report)}: ${i.affectedKeys.length.toLocaleString('en-US')} — ${i.explanation}${i.assignments?.length ? ` Drivers: ${assignmentText(i)}` : ''}${i.affectedKeys.length ? ` Keys: ${i.affectedKeys.join(', ')}` : ''}`).join('\n')}\n${report.warnings?.length ? `Warnings: ${report.warnings.length}\n${report.warnings.map((warning) => `  Warning: ${warning}`).join('\n')}\n` : ''}${report.error ? `  Runtime error: ${report.error}\n` : ''}Exit: ${report.exitCode}\n`,
  );
}
