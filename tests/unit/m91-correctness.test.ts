import { expect, it } from 'vitest';
import {
  compareEntities,
  consoleReport,
  entitySchema,
  groupFindings,
  htmlReport,
  jsonReport,
  junitReport,
  markdownReport,
  normalize,
  ruleSchema,
  type Finding,
} from '@logiparity/core';
import {
  scenarioConsole,
  scenarioHtml,
  scenarioJunit,
  scenarioMarkdown,
  type ScenarioReport,
} from '@logiparity/scenarios';
const source = { type: 'csv', file: 'unused.csv', fields: { id: 'ID', pay: 'Pay', at: 'At', status: 'Status' } };
const entity = entitySchema.parse({
  name: 'load',
  key: 'id',
  sources: { api: source, export: source },
  compare: {
    pay: { type: 'money', currency: 'USD' },
    at: { type: 'datetime', format: { export: 'MM/dd/yyyy HH:mm' }, sourceTimezones: { export: 'America/New_York' } },
  },
});
it('parses formats by source while keeping ISO offsets for unspecified sources', () => {
  const rule = entity.compare.at!;
  expect(normalize('2026-11-02T13:01:00Z', rule, 'api')).toBe(1793624460000);
  expect(normalize('11/02/2026 08:01', rule, 'export')).toBe(1793624460000);
  expect(() => normalize('2026-11-02T13:01:00Z', rule, 'export')).toThrow(
    'does not match configured format "MM/dd/yyyy HH:mm" for source export',
  );
  expect(() => normalize('11/02/2026 08:01', ruleSchema.parse({ ...rule, format: 'MM/dd/yyyy HH:mm' }), 'api')).toThrow(
    'no offset',
  );
});
it.each([
  [-1n, 'likely rounding'],
  [3n, 'likely rounding'],
  [4n, 'consistent fixed difference'],
  [1500n, 'consistent fixed difference'],
  [2500n, 'consistent fixed difference'],
])('uses a bounded rounding hint for %s minor units', (delta, hint) => {
  const findings: Finding[] = [
    {
      type: 'field_mismatch',
      entity: 'load',
      source: 'export',
      key: 'L1',
      field: 'pay',
      expected: 10000n,
      actual: 10000n + delta,
      message: 'Different',
    },
  ];
  expect(groupFindings(findings, [entity])[0]?.summary).toContain(hint);
});
it('includes a missing final reference key after a periodic page-boundary run', async () => {
  const report = await compareEntities([entity], async function* (name) {
    for (let i = 1; i <= 750; i++)
      if (name === 'api' || ![200, 400, 600, 750].includes(i)) yield { id: `L${String(i).padStart(4, '0')}` };
  });
  expect(report.findings).toHaveLength(4);
  expect(report.groups?.[0]?.count).toBe(4);
  expect(report.groups?.[0]?.keys).toContain('L0750');
  expect(report.groups?.[0]?.summary).toContain('final reference key L0750');
});
it('keeps unexplained findings before grouped rows when console and Markdown truncate', () => {
  const findings: Finding[] = Array.from({ length: 60 }, (_, i) => ({
    type: 'field_mismatch',
    entity: 'load',
    source: 'export',
    key: `L${i}`,
    field: 'pay',
    expected: 100n,
    actual: 99n,
    message: 'Different',
  }));
  findings.push({
    type: 'missing_in_source',
    entity: 'load',
    source: 'export',
    key: 'unexplained-tail',
    field: '',
    message: 'No matching key',
  });
  const report = { schemaVersion: 1 as const, entities: [], findings };
  expect(consoleReport(report, { entities: [entity] })).toContain('key=unexplained-tail');
  const markdown = markdownReport(report, { entities: [entity] });
  expect(markdown).toContain('unexplained-tail');
  expect(markdown.indexOf('| load | export | unexplained-tail')).toBeLessThan(markdown.indexOf('| load | export | L0'));
  expect(report.findings[0]?.key).toBe('L0');
});
it('reports source warnings in every format without counting them as findings', async () => {
  const report = await compareEntities([entity], async function* (name, _config, context) {
    if (name === 'export') context.warn('Only an unverified short first page was read.');
    yield { id: 'L1' };
  });
  expect(report.findings).toEqual([]);
  expect(report.warnings).toHaveLength(1);
  const presentation = { entities: [entity] };
  for (const text of [
    consoleReport(report, presentation),
    htmlReport(report, presentation),
    markdownReport(report, presentation),
    jsonReport(report),
    junitReport(report),
  ])
    expect(text).toContain('unverified short first page');
  expect(consoleReport(report)).toContain('0 findings (0 blocking), 1 warning');
});
it('represents source-local conflicts as observed values with lines and reports duplicate exclusions', async () => {
  const rolled = entitySchema.parse({
    name: 'load',
    key: 'id',
    sources: {
      api: { ...source, fields: { id: 'ID', pay: 'Pay', status: 'Status' } },
      export: {
        ...source,
        fields: { id: 'ID', pay: 'Pay', status: 'Status', charge: 'Charge' },
        rollup: { by: 'id', sum: ['pay'], first: ['status'], duplicates: { by: ['id', 'charge'] } },
      },
    },
    compare: { pay: { type: 'money', currency: 'USD' } },
  });
  const report = await compareEntities([rolled], async function* (name) {
    yield { id: 'L103', pay: '200.00', status: 'delivered', ...(name === 'export' ? { charge: 'fuel' } : {}) };
    if (name === 'export') {
      yield { id: 'L103', pay: '200.00', status: 'cancelled', charge: 'other' };
      yield { id: 'L103', pay: '200.00', status: 'delivered', charge: 'fuel' };
    }
  });
  const conflict = report.findings.find((finding) => finding.reason === 'rollup_conflict')!;
  expect(conflict.expected).toBeUndefined();
  expect(conflict.actual).toBeUndefined();
  expect(conflict.values).toEqual([
    { line: 1, value: 'delivered' },
    { line: 2, value: 'cancelled' },
  ]);
  expect(report.findings.find((finding) => finding.reason === 'rollup_duplicate')?.message).toContain(
    'excluded $200.00 from load L103',
  );
});
it('renders the scenario replan warning in every report format', () => {
  const warning = 'These invariants cannot detect a replan that never ran.';
  const report: ScenarioReport = {
    schemaVersion: 1,
    kind: 'scenario',
    name: 'No show',
    target: 'test',
    environment: 'test',
    events: [],
    invariants: [],
    warnings: [warning],
    exitCode: 0,
  };
  for (const text of [
    scenarioConsole(report),
    scenarioHtml(report),
    scenarioMarkdown(report),
    scenarioJunit(report),
    JSON.stringify(report),
  ])
    expect(text).toContain(warning);
});
