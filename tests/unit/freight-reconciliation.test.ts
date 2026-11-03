import { checkedReport } from '../../scripts/validate-report.mjs';
import { expect, it } from 'vitest';
import { compareEntities, entitySchema, sourceRow, reportExitCode } from '@logiparity/core';
const source = {
  type: 'csv',
  file: 'unused',
  fields: { load_id: 'Load', charge: 'Charge', amount: 'Amount', tender: 'Tender', status: 'Status' },
};
it('compares composite keys without delimiter collisions and reports accessorial amounts', async () => {
  const entity = entitySchema.parse({
    name: 'line',
    key: ['load_id', 'charge'],
    sources: { rate: source, settlement: source },
    compare: { amount: { type: 'money', currency: 'USD' } },
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield { load_id: 'L101', charge: 'fuel', amount: '200.00' };
      if (name === 'settlement') yield { load_id: 'L102', charge: 'detention', amount: '15.00' };
    }),
  );
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0]?.keyParts).toEqual(['L102', 'detention']);
  expect(report.findings[0]?.message).toContain('$15.00');
});
it('applies equality, allowlists and not filters before rollup', async () => {
  const entity = entitySchema.parse({
    name: 'load',
    key: 'load_id',
    sources: {
      rate: { ...source, fields: { load_id: 'Load', amount: 'Amount' } },
      settlement: {
        ...source,
        fields: { load_id: 'Load', charge: 'Charge', amount: 'Amount' },
        where: { load_id: ['L1', 'L2'] },
        rollup: { by: 'load_id', sum: ['amount'], first: ['charge'], where: { charge: { not: ['void'] } } },
      },
    },
    compare: { amount: { type: 'money', currency: 'USD' } },
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      if (name === 'rate') yield { load_id: 'L1', amount: '10.00' };
      else {
        yield { load_id: 'L1', charge: 'fuel', amount: '10.00' };
        yield { load_id: 'L1', charge: 'void', amount: 'not a number' };
        yield { load_id: 'L3', charge: 'fuel', amount: '100.00' };
      }
    }),
  );
  expect(report.findings).toEqual([]);
  expect(report.entities[0]?.uniqueCounts).toEqual({ rate: 1, settlement: 1 });
});
it('finds a tender shared by different keys and sums the extra payments', async () => {
  const entity = entitySchema.parse({
    name: 'load',
    key: 'load_id',
    sources: { rate: { ...source, unique: ['tender'] }, settlement: source },
    compare: { amount: { type: 'money', currency: 'USD' } },
  });
  const report = await checkedReport(
    compareEntities([entity], async function* () {
      yield { load_id: 'L106', tender: 'T9006', amount: '200.00' };
      yield { load_id: 'L107', tender: 'T9006', amount: '200.00' };
    }),
  );
  expect(report.findings).toMatchObject([
    { type: 'duplicate_value', relatedKeys: ['L106', 'L107'], amounts: [{ field: 'amount', amount: 20000n }] },
  ]);
});
it('keeps comparing valid cells after a bad amount and reports spreadsheet rows', async () => {
  const entity = entitySchema.parse({
    name: 'load',
    key: 'load_id',
    sources: { rate: source, settlement: source },
    compare: { amount: { type: 'money', currency: 'USD' } },
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield { load_id: 'L1', amount: name === 'rate' ? '200.00' : '(200.00)', [sourceRow]: 10 };
      yield { load_id: 'L2', amount: name === 'rate' ? '100.00' : '115.00', [sourceRow]: 11 };
    }),
  );
  expect(report.findings).toMatchObject([
    { type: 'invalid_value', key: 'L1', row: 10, field: 'amount' },
    { type: 'field_mismatch', key: 'L2' },
  ]);
  expect(reportExitCode(report)).toBe(1);
  const limited = await checkedReport(
    compareEntities(
      [entity],
      async function* () {
        yield { load_id: 'L1', amount: 'bad' };
      },
      {},
      { maxInvalidRows: 0 },
    ),
  );
  expect(reportExitCode(limited)).toBe(2);
});
it('reconciles certain totals and records uncertain keys instead of dropping an entire sum', async () => {
  const entity = entitySchema.parse({
    name: 'load',
    key: 'load_id',
    sources: {
      rate: { type: 'csv', file: 'unused', fields: { load_id: 'ID', amount: 'Pay' } },
      settlement: {
        type: 'csv',
        file: 'unused',
        fields: { load_id: 'ID', amount: 'Pay' },
        rollup: { by: 'load_id', sum: ['amount'] },
      },
    },
    compare: { amount: { type: 'money', currency: 'USD' } },
    aggregates: [{ name: 'total', type: 'sum', field: 'amount' }],
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield { load_id: 'L1', amount: '200.00' };
      yield { load_id: 'L2', amount: name === 'rate' ? '100.00' : '' };
    }),
  );
  const aggregate = report.entities[0]?.aggregates?.[0];
  expect(aggregate?.values).toEqual({ rate: 30000n, settlement: 20000n });
  expect(aggregate?.reconciliation?.settlement?.uncertain).toEqual({ keys: [['L2']], amount: -10000n });
  expect(aggregate?.reconciliation?.settlement?.remainder).toBe(0n);
  expect(report.findings.find((f) => f.type === 'aggregate_mismatch')?.accounting).toBeUndefined();
});
it('accounts for money and filtered count aggregates that follow from missing rows', async () => {
  const entity = entitySchema.parse({
    name: 'load',
    key: 'load_id',
    sources: { rate: source, settlement: source },
    compare: { amount: { type: 'money', currency: 'USD' } },
    aggregates: [
      { name: 'total', type: 'sum', field: 'amount' },
      { name: 'delivered_count', type: 'count', where: { status: 'delivered' } },
    ],
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield { load_id: 'L1', amount: '200.00', status: 'delivered' };
      if (name === 'rate') yield { load_id: 'L2', amount: '100.00', status: 'delivered' };
    }),
  );
  expect(
    report.findings.filter((f) => f.type === 'aggregate_mismatch').every((f) => f.accounting?.remainder === '0'),
  ).toBe(true);
  expect(report.coverage).toEqual({ explained: 2, needsReview: 1 });
});
