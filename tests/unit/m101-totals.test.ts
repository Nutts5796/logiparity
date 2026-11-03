import { expect, it } from 'vitest';
import { compareEntities, entitySchema, htmlReport, markdownReport } from '@logiparity/core';
const csv = { type: 'csv', file: 'unused', fields: { id: 'id', amount: 'amount', currency: 'currency' } };
const entity = (source: Record<string, unknown> = {}, rule: Record<string, unknown> = {}) =>
  entitySchema.parse({
    name: 'order',
    key: 'id',
    sources: { a: { ...csv, ...source }, b: { ...csv, ...source } },
    compare: { amount: { type: 'money', currency: 'USD', ...rule } },
    aggregates: [{ name: 'pay', type: 'sum', field: 'amount' }],
  });
it('counts the retained first duplicate once and exposes raw and certain totals (tom)', async () => {
  const config = entity();
  const report = await compareEntities([config], async function* (source) {
    yield { id: 'O1', amount: '10.00' };
    if (source === 'b') yield { id: 'O1', amount: '20.00' };
  });
  const total = report.entities[0]?.aggregates?.[0];
  expect(total?.values).toEqual({ a: 1000n, b: 1000n });
  expect(total?.rawValues?.b).toBe(3000n);
  expect(total?.excludedRows?.b).toEqual([2]);
  expect(report.findings[0]?.message).toMatch(/rows 1 and 2/);
});
it('partitions totals by currency and flags cross-currency row comparisons (tom)', async () => {
  const config = entity({ currencyField: 'currency' });
  const report = await compareEntities([config], async function* (source) {
    yield { id: 'O1', amount: '10.00', currency: 'USD' };
    yield { id: 'O2', amount: '20.00', currency: source === 'a' ? 'USD' : 'CAD' };
  });
  const total = report.entities[0]?.aggregates?.[0];
  expect(total?.valuesByCurrency?.b).toEqual({ USD: 1000n, CAD: 2000n });
  expect(report.findings.some((f) => f.message.includes('Currency'))).toBe(true);
  expect(htmlReport(report, { entities: [config] })).toContain('CA$20.00');
  expect(markdownReport(report, { entities: [config] })).toContain('CA$20.00');
  expect(report.findings.filter((f) => f.accounting)).toEqual([]);
});
it('shows the reference amount beside an invalid over-precise money cell (tom)', async () => {
  const config = entity();
  const report = await compareEntities([config], async function* (source) {
    yield { id: 'O1', amount: source === 'a' ? '501.73' : '501.7266' };
  });
  expect(report.findings.find((f) => f.type === 'invalid_value')?.expected).toBe(50173n);
});
it('keeps a valid first duplicate certain even if a later duplicate has invalid money', async () => {
  const config = entity();
  const report = await compareEntities([config], async function* (source) {
    yield { id: 'O1', amount: '10.00' };
    if (source === 'b') yield { id: 'O1', amount: 'bad' };
  });
  expect(report.entities[0]?.aggregates?.[0]?.values.b).toBe(1000n);
  expect(report.entities[0]?.aggregates?.[0]?.uncertainKeys?.b).toEqual([]);
});
