import { expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  consoleReport,
  markdownReport,
  junitReport,
  htmlReport,
} from '@logiparity/core';
const file = {
  type: 'csv',
  file: 'unused',
  fields: { id: 'ID', amount: { path: 'Amount', label: 'Carrier pay' }, at: { path: 'At', label: 'Delivery time' } },
};
const entity = entitySchema.parse({
  name: 'load',
  key: 'id',
  sources: { api: { ...file, label: 'Rate confirmation' }, csv: { ...file, label: 'Settlement' } },
  compare: { amount: { type: 'money', currency: 'USD' }, at: { type: 'datetime' } },
  aggregates: [{ name: 'total', type: 'sum', field: 'amount', label: 'Carrier total' }],
});
it('uses labels, neutral accounting and a configurable display timezone in compact human reports', async () => {
  const report = await compareEntities([entity], async function* (source) {
    for (const id of ['A', 'B', 'C'])
      yield { id, amount: source === 'api' ? '100.00' : '99.99', at: '2026-11-02T13:01:00Z' };
  });
  const presentation = { entities: [entity], displayTimezone: 'America/New_York', generatedAt: '2026-11-03T10:00:00Z' };
  for (const text of [
    consoleReport(report, presentation),
    markdownReport(report, presentation),
    junitReport(report, new Date(), presentation),
    htmlReport(report, presentation),
  ]) {
    expect(text).toContain('Carrier pay');
    expect(text).toContain('Settlement');
    expect(text).not.toContain('Expected:');
  }
  const html = htmlReport(report, presentation);
  expect(html).toContain('Follows from:');
  expect(html).toContain('accounted for');
  expect(html).toContain('5:00 AM EST');
  expect(html).not.toContain('fully explained');
  expect(Buffer.byteLength(html)).toBeLessThan(300000);
  const markdown = markdownReport(report, presentation);
  expect(markdown).toContain('One example per cause');
  expect(markdown).not.toMatch(/&quot;|&gt;/);
});
it('keeps runtime error counts consistent and totals explicitly not read', async () => {
  const report = await compareEntities([entity], async function* () {
    yield* [];
    throw new Error('connection refused');
  });
  for (const text of [consoleReport(report, { entities: [entity] }), markdownReport(report, { entities: [entity] })]) {
    expect(text).toContain('0 findings');
    expect(text).toContain('1 source error');
  }
  expect(htmlReport(report, { entities: [entity] })).toContain('Not read');
  expect(markdownReport(report, { entities: [entity] })).toContain('Not read');
});
