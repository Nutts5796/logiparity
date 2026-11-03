import { checkedReport } from '../../scripts/validate-report.mjs';
import { expect, it } from 'vitest';
import { compareEntities, entitySchema, markdownReport, type DataRow, type EntityConfig } from '@logiparity/core';
import { humanFinding, patternWords } from '../../packages/core/src/human.js';
const source = { type: 'csv', file: 'unused', fields: { id: 'id', pay: 'pay', status: 'status', cur: 'cur' } };
function definition(options: Record<string, unknown> = {}): EntityConfig {
  return entitySchema.parse({
    name: 'load',
    key: 'id',
    sources: { a: source, b: source },
    compare: { pay: { type: 'money', currency: 'USD' } },
    aggregates: [{ name: 'total', type: 'sum', field: 'pay' }],
    ...options,
  });
}
async function run(entity: EntityConfig, a: DataRow[], b: DataRow[]) {
  return checkedReport(
    compareEntities([entity], async function* (name) {
      yield* name === 'a' ? a : b;
    }),
  );
}
it('never substitutes short field names inside diagnostics, paths, values or existing labels (raj n1, maria)', () => {
  const entity = definition({
    aggregates: [],
    compare: { at: { type: 'datetime' }, payout: { type: 'money', currency: 'USD' } },
    sources: {
      b: source,
      a: {
        ...source,
        fields: {
          id: 'id',
          at: { path: 'at', label: 'Delivery time' },
          payout: { path: 'payout', label: 'Driver payout' },
        },
      },
    },
  });
  const message = 'Datetime format at /private/tmp/data: expected Driver payout; raw value payout.';
  expect(
    humanFinding(
      { type: 'source_error', entity: 'load', source: 'a', field: '', key: '', message },
      { entities: [entity] },
    ).details,
  ).toBe(message);
});
it('compares untyped CSV strings with native JSON/XLSX scalars canonically (raj k2)', async () => {
  const entity = definition({ compare: {}, aggregates: [] });
  const report = await run(entity, [{ id: 'O1', pay: '5', status: 'true' }], [{ id: 'O1', pay: 5, status: true }]);
  expect(report.findings).toEqual([]);
});
it('reconciles USD and CAD independently and retains both differences in Markdown (tom t1, raj c1)', async () => {
  const entity = definition({
    sources: { a: { ...source, currencyField: 'cur' }, b: { ...source, currencyField: 'cur' } },
  });
  const a = [
    { id: 'U1', pay: '1.00', cur: 'USD' },
    { id: 'U2', pay: '1.00', cur: 'USD' },
    { id: 'U3', pay: '1.00', cur: 'USD' },
    { id: 'C1', pay: '5.00', cur: 'CAD' },
  ];
  const report = await run(
    entity,
    a,
    a.map((row) => ({ ...row, pay: row.cur === 'USD' ? '1.01' : '7.00' })),
  );
  expect(
    report.findings.filter((f) => f.type === 'aggregate_mismatch').every((f) => f.accounting?.remainder === '0'),
  ).toBe(true);
  const md = markdownReport(report, { entities: [entity] });
  expect(md).toContain('+CA$2.00');
  expect(md).toContain('+$0.03');
});
it('emits one currency finding with key parts and no vocabulary mapping (raj c1)', async () => {
  const entity = definition({
    key: ['id', 'status'],
    sources: { a: { ...source, currencyField: 'cur' }, b: { ...source, currencyField: 'cur' } },
  });
  const a = Array.from({ length: 3 }, (_, i) => ({ id: `L${i}`, status: 'fuel', pay: '1.00', cur: 'USD' }));
  const report = await run(
    entity,
    a,
    a.map((r) => ({ ...r, cur: 'CAD' })),
  );
  const rows = report.findings.filter((f) => f.type === 'field_mismatch');
  expect(rows).toHaveLength(3);
  expect(rows[0]?.keyParts).toEqual(['L0', 'fuel']);
  expect(report.groups?.some((g) => g.kind === 'value_mapping')).toBe(false);
  expect(markdownReport(report, { entities: [entity] })).toContain('Currency differs');
  expect(
    (
      await run(
        entity,
        a,
        a.map((r) => ({ ...r, cur: 'usd' })),
      )
    ).findings,
  ).toEqual([]);
});
it('attributes a filter membership change even when the amount change is tolerated (raj r4)', async () => {
  const entity = definition({
    compare: { pay: { type: 'money', currency: 'USD', tolerance: 2 } },
    aggregates: [{ name: 'delivered', type: 'sum', field: 'pay', where: { status: 'delivered' } }],
  });
  const report = await run(
    entity,
    [{ id: 'O1', status: 'delivered', pay: '16.00' }],
    [{ id: 'O1', status: 'in_transit', pay: '15.99' }],
  );
  expect(report.entities[0]?.aggregates?.[0]?.reconciliation?.b).toMatchObject({
    valueDifferences: { count: 1, amount: -1600n },
    remainder: 0n,
  });
});
it('lists only rows excluded from each total, and never presents raw charge rows as load counts (tom)', async () => {
  const entity = definition({
    aggregates: [
      { name: 'count', type: 'count' },
      { name: 'pay', type: 'sum', field: 'pay' },
    ],
  });
  const report = await run(
    entity,
    [{ id: 'L1', pay: '1.00' }],
    [
      { id: 'L1', pay: '1.00' },
      { id: 'L1', pay: '2.00' },
    ],
  );
  expect(report.entities[0]?.aggregates?.[0]?.excludedRows?.b).toEqual([]);
  expect(report.entities[0]?.aggregates?.[1]?.excludedRows?.b).toEqual([2]);
  expect(markdownReport(report, { entities: [entity] })).not.toContain('Raw source: 2;');
});
it('keeps composite key parts as data and does not invent capitalization (raj k1, k3)', () => {
  const finding = {
    type: 'missing_in_source' as const,
    entity: 'load',
    source: 'b',
    field: '',
    key: '["L9","x"]',
    keyParts: ['L9', 'x'],
    message: 'missing',
  };
  expect(humanFinding(finding).key).toBe('L9 · x');
});
it('does not call a whole-day datetime offset a timezone cause and uses correct ordinals (raj g1, s2)', async () => {
  const entity = definition({
    compare: { pay: { type: 'datetime', sourceTimezones: { a: 'UTC', b: 'UTC' } } },
    aggregates: [],
  });
  const a = Array.from({ length: 3 }, (_, i) => ({ id: String(i), pay: '2026-11-02T12:00:00' }));
  const report = await run(
    entity,
    a,
    a.map((r) => ({ ...r, pay: '2026-11-03T12:00:00' })),
  );
  expect(report.groups?.[0]?.cause).toBeUndefined();
  expect(
    patternWords({ entity: 'load', source: 'b', field: '', kind: 'missing_stride', count: 3, stride: '3', summary: '' })
      .sentence,
  ).toContain('3rd');
});
