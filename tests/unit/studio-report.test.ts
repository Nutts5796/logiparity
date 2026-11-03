import { expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  htmlReport,
  jsonReport,
  junitReport,
  fieldPaths,
  reportLabels,
  groupMembership,
  markdownReport,
  consoleReport,
  presentationDifference,
  presentationValue,
} from '@logiparity/core';

const file = {
  type: 'csv',
  file: 'unused.csv',
  fields: {
    id: 'ID',
    payout: { path: 'Pay', label: 'Driver payout' },
    delivered_at: { path: 'At', label: 'Delivery time' },
  },
};
const entity = entitySchema.parse({
  name: 'order',
  pluralLabel: 'orders',
  key: 'id',
  sources: {
    api: { ...file, label: 'API' },
    export: { ...file, label: 'Excel export' },
    csv: { ...file, label: 'CSV export' },
  },
  compare: { payout: { type: 'money', currency: 'USD' }, delivered_at: { type: 'datetime' } },
  aggregates: [{ name: 'payout_total', label: 'Total driver payout', type: 'sum', field: 'payout' }],
});
const presentation = { entities: [entity] };

it('accepts optional labels and resolves string and object mappings without changing raw names', () => {
  expect(fieldPaths(entity.sources.api!.fields)).toEqual({ id: 'ID', payout: 'Pay', delivered_at: 'At' });
  const labels = reportLabels(presentation);
  expect(labels.source('order', 'export')).toBe('Excel export');
  expect(labels.field('order', 'payout')).toBe('Driver payout');
  expect(labels.field('order', 'payout_total', true)).toBe('Total driver payout');
  expect(labels.field('order', 'delivered_count')).toBe('Delivered count');
  expect(labels.field('order', '')).toBe('Whole row');
  expect(labels.all('order')).toBe('All orders');
  expect(labels.all('unknown')).toBe('All records');
  expect(
    entitySchema.safeParse({
      ...entity,
      sources: { ...entity.sources, api: { ...file, fields: { id: { path: '' } } } },
    }).success,
  ).toBe(false);
});

it('uses readable fixed en-US values with differences in all human reports, preserving JSON and JUnit', async () => {
  const report = await compareEntities([entity], async function* (source) {
    yield {
      id: 'S1',
      payout: source === 'api' ? '18.19' : '18.18',
      delivered_at: source === 'api' ? '2026-11-02T13:01:00Z' : '2026-11-02T07:01:00Z',
    };
  });
  const json = jsonReport(report);
  for (const render of [markdownReport, consoleReport]) {
    const result = render(report, presentation);
    expect(result).toContain('$18.19');
    expect(result).toContain('Nov 2, 2026, 1:01 PM UTC');
    expect(result).toContain('−6 h');
    expect(result).not.toContain('1793624460000 (');
    expect(result).not.toContain('1819 ($');
  }
  expect(htmlReport(report, presentation)).toContain('Total driver payout');
  expect(json).toContain('"expected": "1819"');
  expect(json).toContain('"field": "delivered_at"');
  expect(json).not.toContain('Delivery time');
  expect(junitReport(report, new Date(), presentation)).toContain('$18.19');
  expect(jsonReport(report)).toBe(json);
  expect(presentationDifference(1819n, 1818n, 'order', 'payout', false, presentation)).toBe('−$0.01');
  expect(
    presentationValue(123456n, 'order', 'payout', false, {
      entities: [
        entitySchema.parse({ ...entity, compare: { payout: { type: 'money', currency: 'EUR', locale: 'de-DE' } } }),
      ],
    }),
  ).toBe('€1,234.56');
});

it('computes exact pattern coverage, merges cards, and reconciles missing rows and pattern deltas in minor units', async () => {
  const report = await compareEntities([entity], async function* (source) {
    for (let index = 1; index <= 750; index++) {
      if (source === 'export' && [200, 400, 600, 750].includes(index)) continue;
      yield {
        id: `S${String(index).padStart(6, '0')}`,
        payout: source === 'api' ? '18.19' : '18.18',
        delivered_at: source === 'api' ? '2026-11-02T13:01:00Z' : '2026-11-02T07:01:00Z',
      };
    }
  });
  expect(report.coverage).toEqual({ explained: 2998, needsReview: 0 });
  expect(report.groups?.find((group) => group.kind === 'missing_stride')?.findingIndexes).toHaveLength(4);
  const aggregate = report.entities[0]!.aggregates![0]!;
  expect(aggregate.reconciliation?.export).toMatchObject({ missingRows: { count: 4, amount: -7276n }, remainder: 0n });
  expect(aggregate.reconciliation?.csv?.remainder).toBe(0n);
  const html = htmlReport(report, presentation);
  expect(html.match(/class="card pat"/g)).toHaveLength(3);
  expect(html).toContain('149/150');
  expect(html).toContain('24-hour UTC dial');
  expect(html).toContain('$0.00 · accounted for');
  expect(html).not.toContain('class="where"');
  expect(html.includes('CSV export and Excel export')).toBe(true);
});

it('attributes extra rows and respects aggregate filters', async () => {
  const filtered = entitySchema.parse({
    ...entity,
    aggregates: [{ name: 'payout_total', type: 'sum', field: 'payout', where: { id: 'S1' } }],
  });
  const report = await compareEntities([filtered], async function* (source) {
    yield { id: 'S1', payout: '18.19' };
    if (source === 'api') yield { id: 'S2', payout: '25.00' };
    else yield { id: 'extra', payout: '12.00' };
  });
  expect(report.entities[0]!.aggregates![0]!.reconciliation?.export?.remainder).toBe(0n);
  const extra = await compareEntities([entity], async function* (source) {
    yield { id: 'S1', payout: '18.19' };
    if (source !== 'api') yield { id: 'extra', payout: '12.00' };
  });
  expect(extra.entities[0]!.aggregates![0]!.reconciliation?.export?.remainder).toBe(0n);
  expect(extra.entities[0]!.aggregates![0]!.reconciliation?.export?.extraRows?.amount).toBe(1200n);
  expect(htmlReport(extra, presentation)).toContain('$0.00 · accounted for');
});

it('matches group membership by exact delta and excludes source-local issues', () => {
  const report = {
    schemaVersion: 1 as const,
    entities: [],
    findings: [
      {
        type: 'field_mismatch' as const,
        entity: 'order',
        source: 'export',
        key: 'S1',
        field: 'payout',
        message: '',
        expected: 100n,
        actual: 99n,
      },
      {
        type: 'field_mismatch' as const,
        entity: 'order',
        source: 'export',
        key: 'S2',
        field: 'payout',
        message: '',
        expected: 100n,
        actual: 98n,
      },
      {
        type: 'field_mismatch' as const,
        entity: 'order',
        source: 'export',
        key: 'S3',
        field: 'payout',
        message: '',
        reason: 'rollup_conflict' as const,
        expected: 100n,
        actual: 99n,
      },
    ],
    groups: [
      {
        entity: 'order',
        source: 'export',
        field: 'payout',
        count: 1,
        kind: 'money_delta' as const,
        delta: '-1',
        summary: 'One cent',
      },
    ],
  };
  expect(groupMembership(report)).toEqual([]);
});

it('embeds only Latin font data, escapes labels, and adds under 300 KB to an empty report', () => {
  const hostile = entitySchema.parse({
    ...entity,
    pluralLabel: '</script><img src=x>',
    sources: { ...entity.sources, export: { ...file, label: '<img src=x onerror=alert(1)>' } },
  });
  const html = htmlReport(
    {
      schemaVersion: 1,
      entities: [{ entity: 'order', reference: 'api', counts: { api: 0, export: 0 } }],
      findings: [],
    },
    { entities: [hostile] },
  );
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<img src=');
  expect(html).toContain('data:font/woff2;base64,');
  expect(html).toContain('font-src data:');
  expect(html).not.toContain('fonts.googleapis.com');
  expect(Buffer.byteLength(html)).toBeLessThan(300000);
});

it('does not call a large fixed money difference rounding in cards or legends', async () => {
  const report = await compareEntities([entity], async function* (source) {
    for (const id of ['S1', 'S2', 'S3']) yield { id, payout: source === 'api' ? '45.00' : '20.00' };
  });
  const html = htmlReport(report, presentation);
  expect(html.includes('Fixed difference')).toBe(true);
  expect(html.includes('>Rounding<')).toBe(false);
  expect(html.includes('consistent fixed difference')).toBe(true);
});
