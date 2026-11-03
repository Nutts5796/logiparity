import { expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  consoleReport,
  markdownReport,
  htmlReport,
  junitReport,
  jsonReport,
  type EntityConfig,
  type DataRow,
} from '@logiparity/core';
import { aggregateStatus } from '../../packages/core/src/money-display.js';
import { patternCards } from '../../packages/core/src/html-patterns.js';
import { checkedReport } from '../../scripts/validate-report.mjs';
const fields = {
  id: 'id',
  status: { path: 'status', label: 'Status' },
  amount: { path: 'amount', label: 'Carrier pay' },
};
const file = { type: 'csv', file: 'unused', fields };
const config = (options: Record<string, unknown> = {}) =>
  entitySchema.parse({
    name: 'order',
    pluralLabel: 'orders',
    key: 'id',
    sources: { api: { ...file, label: 'API' }, csv: { ...file, label: 'CSV export' } },
    compare: { status: { type: 'enum' } },
    ...options,
  });
const run = (entity: EntityConfig, a: DataRow[], b: DataRow[]) =>
  checkedReport(
    compareEntities([entity], async function* (name) {
      yield* name === 'api' ? a : b;
    }),
  );
const formats = (report: Awaited<ReturnType<typeof run>>, entity: EntityConfig) => [
  consoleReport(report, { entities: [entity] }),
  markdownReport(report, { entities: [entity] }),
  htmlReport(report, { entities: [entity] }),
  junitReport(report, new Date(), { entities: [entity] }),
  jsonReport(report),
];
it('distinguishes lagging statuses from a vocabulary map using matched rows (Crowd9 Karen/Maria)', async () => {
  const entity = config();
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: 'O' + i, status: 'delivered' }));
  const report = await run(
    entity,
    rows,
    rows.map((row, i) => ({ ...row, status: i < 3 ? 'in_transit' : row.status })),
  );
  expect(report.groups?.[0]).toMatchObject({
    kind: 'value_mapping',
    cause: 'stale_value',
    count: 3,
    referenceCount: 10,
    matchingCount: 7,
  });
  for (const text of formats(report, entity)) {
    expect(text).toContain('stale or lagging');
    expect(text).not.toContain('different vocabulary');
    expect(text).toContain('In transit');
  }
  expect(patternCards(report, { entities: [entity] })[0]?.chart).toContain('Delivered → In transit');
  expect(patternCards(report, { entities: [entity] })[0]?.chart).not.toContain('in_transit');
  const mapped = await run(
    entity,
    rows,
    rows.map((row) => ({ ...row, status: 'done' })),
  );
  expect(mapped.groups?.[0]?.cause).not.toBe('stale_value');
  expect(consoleReport(mapped, { entities: [entity] })).toContain('different vocabulary');
  const canonical = await run(
    config({ compare: {} }),
    rows.map((row) => ({ ...row, status: '5' })),
    rows.map((row, i) => ({ ...row, status: i < 3 ? 6 : 5 })),
  );
  expect(canonical.groups?.[0]).toMatchObject({ cause: 'stale_value', referenceCount: 10, matchingCount: 7 });
});
it('merges mapping sentences with display values and reference labels, never a duration (Crowd9 David merge0ms)', async () => {
  const entity = config({
    sources: {
      api: { ...file, label: 'API' },
      csv: { ...file, label: 'CSV export' },
      excel: { ...file, label: 'Excel export' },
    },
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      for (let i = 0; i < 3; i++) yield { id: 'O' + i, status: name === 'api' ? 'in_transit' : 'delivered' };
    }),
  );
  for (const text of formats(report, entity).slice(0, 4)) {
    expect(text).toContain(
      '3 status values in CSV export and 3 in Excel export show Delivered where API shows In transit',
    );
    expect(text).not.toContain('differ by 0 ms');
  }
});
it('retains invalid keys in uncertainty even without a recorded currency (Crowd9 Raj u4)', async () => {
  const entity = config({
    compare: { amount: { type: 'money', currency: 'USD' } },
    aggregates: [{ name: 'total', type: 'sum', field: 'amount' }],
  });
  const report = await run(
    entity,
    [
      { id: 'O1', amount: 'bad' },
      { id: 'O2', amount: '10.00' },
    ],
    [
      { id: 'O1', amount: 'bad' },
      { id: 'O2', amount: '11.00' },
    ],
  );
  const total = report.entities[0]!.aggregates![0]!;
  expect(total.sourceStatus).toEqual({ api: 'uncertain', csv: 'uncertain' });
  expect(total.reconciliationByCurrency?.csv?.USD?.uncertain?.keys).toEqual([['O1']]);
  expect(aggregateStatus(total, 'api', 'api')).toBe('Reference');
  expect(report.findings.find((f) => f.type === 'aggregate_mismatch')?.accounting).toBeUndefined();
  for (const text of formats(report, entity).slice(0, 4)) expect(text).not.toContain('Follows from:');
});
it('does not treat every third row as a page boundary when the page size is ten (Crowd9 Raj pg2)', async () => {
  const entity = config({
    sources: {
      api: file,
      csv: {
        type: 'rest',
        baseUrl: 'http://fixture.test',
        path: '/',
        fields,
        pagination: { type: 'page', size: 10, totalPath: '$.total' },
      },
    },
  });
  const rows = Array.from({ length: 95 }, (_, i) => ({ id: 'O' + (i + 1) }));
  const report = await run(
    entity,
    rows,
    rows.filter((_, i) => (i + 1) % 3),
  );
  expect(report.groups?.some((g) => g.cause === 'pagination')).toBe(false);
});
it.each([1, 13, 19, 25, 87, 95])(
  'groups page positions independently of an extra lost key O%s (Crowd9 Raj server3)',
  async (lost) => {
    const entity = config({
      sources: {
        api: file,
        csv: {
          type: 'rest',
          baseUrl: 'http://fixture.test',
          path: '/',
          fields,
          pagination: { type: 'page', size: 10, totalPath: '$.total' },
        },
      },
    });
    const rows = Array.from({ length: 95 }, (_, i) => ({ id: 'O' + (i + 1) }));
    const report = await run(
      entity,
      rows,
      rows.filter((_, i) => (i + 1) % 10 && i + 1 !== lost),
    );
    const group = report.groups?.find((g) => g.cause === 'pagination');
    expect(group?.keys).toEqual([
      ...Array.from({ length: 9 }, (_, i) => 'O' + (i + 1) * 10),
      ...(lost === 95 ? ['O95'] : []),
    ]);
    expect(group?.stride).toBe('10');
    expect(report.groups?.some((g) => g.cause === 'pagination' && g.stride === '5')).toBe(false);
  },
);
it('shows uncertainty contributions and remainders in every human format (Crowd9 Tom freight)', async () => {
  const entity = config({
    compare: { amount: { type: 'money', currency: 'USD' } },
    aggregates: [{ name: 'total', label: 'Total carrier pay', type: 'sum', field: 'amount' }],
  });
  const report = await run(
    entity,
    [
      { id: 'O1', amount: '10.00' },
      { id: 'O2', amount: '2.00' },
    ],
    [
      { id: 'O1', amount: 'bad' },
      { id: 'O2', amount: '3.00' },
    ],
  );
  for (const text of formats(report, entity).slice(0, 4)) {
    expect(text).toContain('Unexplained remainder');
    expect(text).toContain('Value differences (1)');
    expect(text).toContain('Uncertain lines');
    expect(text).toContain('−$10.00');
  }
});
