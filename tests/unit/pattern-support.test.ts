import { expect, it } from 'vitest';
import { compareEntities, entitySchema, configSchema, groupFindings, type Finding } from '@logiparity/core';
const csv = { type: 'csv', file: 'unused.csv', fields: { id: 'ID', amount: 'Amount', status: 'Status' } };
const entity = entitySchema.parse({
  name: 'order',
  key: 'id',
  sources: { api: csv, export: csv },
  compare: { amount: { type: 'money', currency: 'USD' }, status: { type: 'enum' } },
});
const finding = (key: string, field: string, expected: Finding['expected'], actual: Finding['actual']): Finding => ({
  type: 'field_mismatch',
  entity: 'order',
  source: 'export',
  key,
  field,
  expected: expected ?? null,
  actual: actual ?? null,
  message: 'Difference',
});
it('keeps one-off money and status defects in individual review', async () => {
  const report = await compareEntities([entity], async function* (source) {
    yield {
      id: 'L1',
      amount: source === 'api' ? '200.00' : '215.00',
      status: source === 'api' ? 'delivered' : 'cancelled',
    };
  });
  expect(report.groups).toEqual([]);
  expect(report.coverage).toEqual({ explained: 0, needsReview: 2 });
});
it('groups supported deltas without hiding a noisy outlier', () => {
  const findings = [
    ...['A', 'B', 'C'].map((key) => finding(key, 'amount', 100n, 99n)),
    finding('D', 'amount', 100n, 1600n),
  ];
  expect(groupFindings(findings, [entity])).toMatchObject([{ kind: 'money_delta', count: 3, delta: '-1' }]);
  expect(groupFindings(findings, [entity], {}, { minCount: 4 })).toEqual([]);
});
it('requires configurable support of at least three', () => {
  expect(configSchema.parse({ version: 1, entities: [entity] }).patterns.minCount).toBe(3);
  expect(configSchema.safeParse({ version: 1, entities: [entity], patterns: { minCount: 2 } }).success).toBe(false);
  expect(
    groupFindings([finding('A', 'status', 'open', 'closed'), finding('B', 'status', 'open', 'closed')], [entity]),
  ).toEqual([]);
});
