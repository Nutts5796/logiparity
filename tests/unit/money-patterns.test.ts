import { expect, it } from 'vitest';
import {
  compareEntities,
  configSchema,
  consoleReport,
  entitySchema,
  groupFindings,
  htmlReport,
  jsonReport,
  markdownReport,
  normalize,
  ruleSchema,
  type Finding,
  type Report,
} from '@logiparity/core';
const file = { type: 'csv', file: 'unused.csv', fields: { id: 'ID', at: 'At', payout: 'Payout', status: 'Status' } };
const entity = entitySchema.parse({
  name: 'shipment',
  key: 'id',
  sources: { api: file, csv: file },
  compare: { at: { type: 'datetime' }, payout: { type: 'money', currency: 'USD' }, status: { type: 'enum' } },
});
const finding = (
  field: string,
  key: string,
  expected: Finding['expected'],
  actual: Finding['actual'],
  source = 'csv',
): Finding => ({
  type: 'field_mismatch',
  entity: 'shipment',
  source,
  key,
  field,
  expected: expected!,
  actual: actual!,
  message: 'Synthetic mismatch',
});
it.each([
  [12.34, 1234n],
  [-0.01, -1n],
  [0, 0n],
  [1e21, 100000000000000000000000n],
] as const)('accepts opted-in numeric money %s using its locale-independent decimal string', (number, expected) => {
  const rule = ruleSchema.parse({ type: 'money', currency: 'USD', allowNumber: true, locale: 'de-DE' });
  expect(normalize(number, rule, 'api')).toBe(expected);
});
it.each([12.345, 0.1 + 0.2, 1e-7, NaN, Infinity, -Infinity])('rejects numeric money %s without rounding', (number) =>
  expect(() =>
    normalize(number, ruleSchema.parse({ type: 'money', currency: 'USD', allowNumber: true }), 'api'),
  ).toThrow(),
);
it('retains strict money defaults, decimal string grouping and non-USD minor units', () => {
  expect(() => normalize(12.34, ruleSchema.parse({ type: 'money', currency: 'USD' }), 'api')).toThrow('decimal string');
  expect(
    normalize(
      '1.234,50',
      ruleSchema.parse({ type: 'money', currency: 'EUR', locale: 'de-DE', allowNumber: true }),
      'csv',
    ),
  ).toBe(123450n);
  expect(normalize(12, ruleSchema.parse({ type: 'money', currency: 'JPY', allowNumber: true }), 'api')).toBe(12n);
  expect(normalize(1.234, ruleSchema.parse({ type: 'money', currency: 'KWD', allowNumber: true }), 'api')).toBe(1234n);
});
it('groups constant UTC offsets, exact large money deltas and one status mapping without dropping rows', () => {
  const findings = ['A', 'B', 'C'].flatMap((key, i) => [
    finding('at', key, 1793624460000 + i * 1000, 1793602860000 + i * 1000),
    finding('payout', key, 900719925474099301n + BigInt(i), 900719925474099300n + BigInt(i)),
    finding('status', key, 'delivered', 'in_transit'),
  ]);
  const groups = groupFindings(findings, [entity]);
  expect(groups.map((g) => g.kind)).toEqual(['datetime_offset', 'money_delta', 'value_mapping']);
  expect(groups[0]).toMatchObject({ count: 3, delta: '-21600000' });
  expect(groups[0]?.summary).toContain('−6h (likely timezone)');
  expect(groups[1]?.delta).toBe('-1');
  const report: Report = { schemaVersion: 1, entities: [], findings, groups };
  for (const text of [markdownReport(report), consoleReport(report)]) {
    expect(text).toContain('Likely local time');
    expect(text.replaceAll('\\_', '_')).toContain('In transit');
  }
  expect(htmlReport(report).includes('9 findings')).toBe(true);
  expect(markdownReport(report)).toContain('## One example per cause');
  const json = JSON.parse(jsonReport(report)) as Report;
  expect(json.schemaVersion).toBe(1);
  expect(json.groups).toHaveLength(3);
  expect(json.findings).toHaveLength(9);
  expect(groupFindings([...findings].reverse(), [entity])).toEqual(groups);
});
it('keeps distinct entities/sources separate and refuses mixed deltas/mappings and unknown datetime guesses', () => {
  expect(groupFindings([finding('at', 'A', 1000, 0), finding('at', 'B', 2000, 0)], [entity])).toEqual([]);
  expect(
    groupFindings(
      [finding('status', 'A', 'delivered', 'in_transit'), finding('status', 'B', 'cancelled', 'in_transit')],
      [entity],
    ),
  ).toEqual([]);
  expect(groupFindings([finding('at', 'A', 1000, 0), finding('at', 'B', 2000, 1000)])).toEqual([]);
  const f = finding('status', 'A', 'delivered', 'in_transit');
  expect(groupFindings([f, { ...f, source: 'ui' }, { ...f, entity: 'freight' }], [entity])).toHaveLength(0);
});
it('escapes summaries, adds HTML counts, and shows ISO UTC alongside console epochs', () => {
  const report: Report = {
    schemaVersion: 1,
    entities: [],
    findings: [finding('at', 'A', 1793624460000, 1793624460123), finding('status', 'B', '<script>', 'in_transit')],
  };
  const presentation = { entities: [entity] };
  expect(consoleReport(report, presentation)).toContain('Nov 2, 2026, 1:01 PM UTC');
  const html = htmlReport(report, presentation);
  expect(html.includes('class="card donut"')).toBe(true);
  expect(html.includes('data-mode="review"')).toBe(true);
  expect(html).not.toContain('<script> ->');
  expect(html.includes('<script> ->')).toBe(false);
  expect(html).toContain('+123ms');
  expect(consoleReport({ ...report, findings: [finding('at', 'A', 0, 1000)] }, presentation)).toContain('+1s');
  expect(
    groupFindings(
      ['A', 'B', 'C'].map((key) => finding('at', key, 0, 120000)),
      [entity],
    )[0]?.summary,
  ).toContain('+2m');
});
it('emits groups through the comparison engine and never reports false extras after a source fails', async () => {
  const report = await compareEntities([entity], async function* (name) {
    if (name === 'api') throw new Error('REST page 1: requested size 200, received 20; cap detected.');
    yield { id: 'A' };
  });
  expect(report.findings.map((f) => f.type)).toEqual(['source_error']);
  expect(report.groups).toEqual([]);
  expect(report.findings[0]?.message).not.toContain("Check this source's configuration");
  const compared = await compareEntities([entity], async function* (name) {
    for (const id of ['A', 'B', 'C']) yield { id, payout: name === 'api' ? '6.25' : '6.24' };
  });
  expect(compared.groups?.[0]?.kind).toBe('money_delta');
});
it('keeps rules optional and validates the new pagination and numeric-money properties', () => {
  expect(configSchema.parse({ version: 1, entities: [entity] }).version).toBe(1);
  expect(ruleSchema.parse({ type: 'money', currency: 'USD' }).allowNumber).toBe(false);
});
