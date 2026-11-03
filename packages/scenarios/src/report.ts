import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  safeConsole,
  redactTree,
  atomicReportFile,
  studioStyle,
  brandMark,
  themeButton,
  themeScript,
  humanize,
  markdownCell,
  reportExitCode,
  type Report,
} from '@logiparity/core';
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
  affectedOrderCount?: number;
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
const xml = (value: string) => escape(value.replace(/[^\P{Cc}\t\n\r]|[\u2028\u2029\ufffe\uffff]/gu, '\ufffd'));
const cell = markdownCell;
function label(result: InvariantResult, report: ScenarioReport): string {
  const name = invariantLabels[result.name] ?? humanize(result.name);
  return result.name === 'no_order_lost' && report.events.some((event) => event.type === 'vehicle_breakdown')
    ? 'Orders lost after the breakdown'
    : name;
}
function assignmentText(result: InvariantResult): string {
  return (result.assignments ?? [])
    .map((item) => `${item.key}: ${item.before.join(', ') || 'none'} → ${item.after.join(', ') || 'none'}`)
    .join('; ');
}
function checks(report: ScenarioReport) {
  const items = report.invariants.map((result) => ({
    name: label(result, report),
    failure: result.passed
      ? ''
      : `${result.explanation} Affected keys: ${result.affectedKeys.join(', ')}${result.assignments?.length ? ` Drivers: ${assignmentText(result)}` : ''}`,
    error: '',
  }));
  if (report.parity) {
    const code = reportExitCode(report.parity);
    items.push({
      name: 'Post-scenario parity',
      failure: code === 1 ? 'See parity/junit.xml for field-level failures.' : '',
      error:
        code === 2
          ? report.parity.findings
              .filter((f) => f.type === 'source_error')
              .map((f) => f.message)
              .join('; ')
          : '',
    });
  }
  if (report.error) items.push({ name: 'Scenario runtime', failure: '', error: report.error });
  return items;
}
function summary(report: ScenarioReport): string {
  const failed = checks(report).filter((check) => check.failure || check.error).length;
  return failed
    ? `${failed.toLocaleString('en-US')} ${failed === 1 ? 'check needs' : 'checks need'} attention`
    : 'All scenario checks pass';
}
function affectedSummary(report: ScenarioReport): string {
  return report.affectedOrderCount === undefined
    ? 'Assignments checked against the baseline.'
    : `${report.affectedOrderCount.toLocaleString('en-US')} affected ${report.affectedOrderCount === 1 ? 'order' : 'orders'} checked against the baseline.`;
}
function parityStatus(report: ScenarioReport): string {
  if (!report.parity) return '';
  const code = reportExitCode(report.parity);
  return code === 2 ? 'Runtime error' : code === 1 ? 'Needs review' : 'Passed';
}
export function scenarioMarkdown(report: ScenarioReport): string {
  report = redactTree(report, []);
  const lines = [
    `# ${cell(report.name)}`,
    '',
    `Test or staging scenario · Target: ${cell(report.target)} · Exit: ${report.exitCode}`,
    '',
    summary(report),
    affectedSummary(report),
    '',
  ];
  if (report.warnings?.length)
    lines.push(`Warnings (${report.warnings.length}):`, ...report.warnings.map((warning) => `- ${cell(warning)}`), '');
  for (const check of checks(report)) if (check.error) lines.push(`Runtime error: ${cell(check.error)}`, '');
  lines.push('| Check | Result | Affected keys | Explanation |', '| --- | --- | --- | --- |');
  for (const result of report.invariants)
    lines.push(
      `| ${cell(label(result, report))} | ${result.passed ? 'Passed' : 'Needs review'} | ${cell(result.affectedKeys.join(', ') || (result.passed ? 'No violations' : 'Not available'))} | ${cell(result.explanation + (result.assignments?.length ? ` Drivers: ${assignmentText(result)}` : ''))} |`,
    );
  if (report.parity)
    lines.push(`| Post-scenario parity | ${parityStatus(report)} | — | [Reconciliation report](parity/report.md) |`);
  return lines.join('\n') + '\n';
}
function invariantRows(report: ScenarioReport): string {
  return report.invariants
    .map((check) => {
      const count =
        !invariantLabels[check.name] && !check.affectedKeys.length
          ? ''
          : `: ${check.affectedKeys.length.toLocaleString('en-US')}`;
      const affected = check.affectedKeys.join(', ') || (check.passed ? 'No violations' : 'Not available');
      return `<tr><td data-l="Check"><strong>${escape(label(check, report))}${count}</strong><span class="sub-l">${escape(check.explanation)}</span></td>
<td data-l="Result"><span class="tag ${check.passed ? 't-ok' : 't-rev'}">${check.passed ? 'Passed' : 'Needs review'}</span></td>
<td data-l="Affected orders"><code>${escape(affected)}</code>${check.assignments?.length ? `<span class="details">Drivers: ${escape(assignmentText(check))}</span>` : ''}</td></tr>`;
    })
    .join('');
}
function warningList(report: ScenarioReport): string {
  return (report.warnings ?? [])
    .map((warning) => {
      const url =
        warning.match(/https:\/\/github\.com\/Nutts5796\/logiparity\/blob\/main\/docs\/scenarios\.md#[a-z-]+/i)?.[0] ??
        'https://github.com/Nutts5796/logiparity/blob/main/docs/configuration.md#environment-guard-and-redaction';
      return `<li>${escape(warning.replace(/https:\/\/\S+/g, ''))} <a href="${escape(url)}">Read scenario checks</a></li>`;
    })
    .join('');
}
export function scenarioHtml(report: ScenarioReport): string {
  report = redactTree(report, []);
  const script = `(()=>{${themeScript}})();`,
    hash = createHash('sha256').update(script).digest('base64');
  const warnings = warningList(report);
  const chips = Object.entries(report.sourceLabels ?? {})
    .filter(([name]) => name !== 'meta')
    .map(([, value]) => `<span class="chip">${escape(value)}</span>`)
    .join('');
  const errors = checks(report)
    .filter((check) => check.error)
    .map((check) => `<section class="card"><h2>Runtime error</h2><p>${escape(check.error)}</p></section>`)
    .join('');
  const parity = report.parity
    ? `<tr><td>Post-scenario parity</td><td>${parityStatus(report)}</td><td><a href="parity/report.html">Open reconciliation report</a></td></tr>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'">
<title>${escape(report.name)} · LogiParity</title><style>${studioStyle}</style></head><body><main class="wrap">
<header class="top"><div class="brand">${brandMark}LogiParity <span class="sub">/ Scenario report</span></div><div class="top-r"><span class="chip">${escape(report.target)} · ${escape(report.environment)}</span>${themeButton}</div></header>
<section class="hero"><div class="card"><span class="status ${report.exitCode ? '' : 'passed'}" title="Exit code ${report.exitCode}">${report.exitCode ? 'Failed' : 'Passed'}</span>
<h1>${escape(report.name)}</h1><div class="big">${summary(report)}</div><p class="lead">${report.events.filter((event) => event.completed).length} of ${report.events.length} ${report.events.length === 1 ? 'event' : 'events'} completed.</p><div class="srcs">${chips}</div></div>
<div class="card"><h2>After the disruption</h2><p>${affectedSummary(report)}</p>${report.parity ? '<a class="btn btn-soft" href="parity/report.html">Open reconciliation report</a>' : ''}</div></section>
${warnings ? `<h3>Warnings</h3><section class="card"><ul>${warnings}</ul></section>` : ''}${errors}
<h3>Checks</h3><section class="card findings"><table><thead><tr><th>Check</th><th>Result</th><th>Affected orders and drivers</th></tr></thead><tbody>${invariantRows(report)}${parity}</tbody></table></section>
<footer>Events modify only the configured test or staging target.${report.synthetic ? ' Demo data is synthetic.' : ''}</footer></main><script>${script}</script></body></html>`;
}
function junitCase(check: ReturnType<typeof checks>[number]): string {
  const result = check.error
    ? `<error type="runtime" message="Scenario runtime error">${xml(check.error)}</error>`
    : check.failure
      ? `<failure type="invariant" message="Scenario check failed">${xml(check.failure)}</failure>`
      : '';
  return `<testcase name="${xml(check.name)}" classname="logiparity.scenario" time="0">${result}</testcase>`;
}
export function scenarioJunit(report: ScenarioReport, timestamp = new Date()): string {
  report = redactTree(report, []);
  const results = checks(report);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="${xml(report.name)}" package="logiparity.scenario" id="0" timestamp="${timestamp.toISOString().slice(0, 19)}" hostname="localhost" tests="${results.length}" failures="${results.filter((c) => c.failure).length}" errors="${results.filter((c) => c.error).length}" skipped="0" time="0">
<properties><property name="warnings" value="${report.warnings?.length ?? 0}"/><property name="timing" value="not measured; time=0 is a placeholder"/><property name="timestamp.timezone" value="UTC"/></properties>
${results.map(junitCase).join('')}<system-out>${xml((report.warnings ?? []).map((warning) => `Warning: ${warning}`).join('\n'))}</system-out><system-err/></testsuite></testsuites>\n`;
}
export async function writeScenarioReport(report: ScenarioReport, directory: string, fileMode = 0o600): Promise<void> {
  await mkdir(directory, { recursive: true });
  const formats: [string, string][] = [
    [
      'scenario.json',
      JSON.stringify(
        redactTree(report, []),
        (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
        2,
      ) + '\n',
    ],
    ['scenario.html', scenarioHtml(report)],
    ['scenario.md', scenarioMarkdown(report)],
    ['junit.xml', scenarioJunit(report)],
  ];
  for (const [file, content] of formats) await atomicReportFile(join(directory, file), content, { mode: fileMode });
}
export function scenarioConsole(report: ScenarioReport): string {
  report = redactTree(report, []);
  const lines = [
    `Scenario: ${report.name} (${report.target}/${report.environment})`,
    summary(report),
    affectedSummary(report),
  ];
  for (const result of report.invariants) {
    const count =
      !invariantLabels[result.name] && !result.affectedKeys.length
        ? ''
        : `: ${result.affectedKeys.length.toLocaleString('en-US')}`;
    lines.push(
      `  ${result.passed ? 'Passed' : 'Needs review'} ${label(result, report)}${count} — ${result.explanation}${result.assignments?.length ? ` Drivers: ${assignmentText(result)}` : ''}${result.affectedKeys.length ? ` · Keys: ${result.affectedKeys.join(', ')}` : ''}`,
    );
  }
  if (report.parity) lines.push(`  ${parityStatus(report)} Post-scenario parity: see parity/report.html`);
  for (const warning of report.warnings ?? []) lines.push(`  Warning: ${warning}`);
  for (const check of checks(report)) if (check.error) lines.push(`  Runtime error: ${check.error}`);
  lines.push(`Exit: ${report.exitCode}`);
  return safeConsole(lines.join('\n') + '\n');
}
