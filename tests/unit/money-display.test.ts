import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  entitySchema,
  formatMoneyMajor,
  htmlReport,
  jsonReport,
  markdownReport,
  presentationValue,
  SourceError,
  compareEntities,
  writeReports,
  type Report,
} from '@logiparity/core';

const source = { type: 'csv', file: 'unused.csv', fields: { id: 'ID', payout: 'Payout' } };
const entity = entitySchema.parse({
  name: 'shipment',
  key: 'id',
  sources: { api: source, export: source },
  compare: { payout: { type: 'money', currency: 'USD' } },
  aggregates: [
    { name: 'payout_total', type: 'sum', field: 'payout' },
    { name: 'payout', type: 'count' },
  ],
});

it.each([
  [682625n, 'USD', 'en-US', '$6,826.25'],
  [-1n, 'USD', 'en-US', '-$0.01'],
  [0n, 'USD', 'en-US', '$0.00'],
  [900719925474099301n, 'USD', 'en-US', '$9,007,199,254,740,993.01'],
  [123n, 'JPY', 'en-US', '¥123'],
  [1234n, 'KWD', 'en-US', 'KWD\u00a01.234'],
  [682625n, 'EUR', 'de-DE', '6.826,25\u00a0€'],
])('formats %s minor units exactly as configured currency', (minor, currency, locale, expected) => {
  expect(formatMoneyMajor(minor, currency, locale)).toBe(expected);
});

it('shows both currency and minor units for monetary fields and sum aggregates only', async () => {
  const report: Report = {
    schemaVersion: 1,
    entities: [
      {
        entity: 'shipment',
        reference: 'api',
        counts: { api: 1, export: 1 },
        aggregates: [
          { name: 'payout_total', type: 'sum', values: { api: 682625n, export: 682624n }, skippedSources: [] },
        ],
      },
    ],
    findings: [
      {
        type: 'field_mismatch',
        entity: 'shipment',
        source: 'export',
        key: 'S1',
        field: 'payout',
        expected: 682625n,
        actual: 682624n,
        message: 'one cent differs',
      },
      {
        type: 'aggregate_mismatch',
        entity: 'shipment',
        source: 'export',
        key: '',
        field: 'payout_total',
        expected: 682625n,
        actual: 682624n,
        message: 'total differs',
      },
    ],
  };
  const presentation = { entities: [entity] };
  const original = jsonReport(report);
  for (const render of [htmlReport, markdownReport]) {
    const text = render(report, presentation);
    expect(text).toContain('$6,826.25');
    expect(text).toContain('682625');
    expect(text).toContain('$6,826.24');
  }
  expect(presentationValue(3, 'shipment', 'payout', true, presentation)).toBe('3');
  expect(presentationValue(101n, 'shipment', 'unknown', true, presentation)).toBe('101');
  expect(presentationValue(null, 'shipment', 'payout', false, presentation)).toBe('null');
  expect(presentationValue('101', 'shipment', 'payout', false, presentation)).toBe('101 ($1.01)');
  expect(htmlReport(report)).not.toContain('$'); // Never guess a currency without config.
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-money-'));
  try {
    await writeReports(report, directory, ['html', 'markdown', 'json'], presentation);
    expect(await readFile(join(directory, 'report.json'), 'utf8')).toBe(original);
    expect(await readFile(join(directory, 'report.html'), 'utf8')).toContain('682625 ($6,826.25)');
    expect(jsonReport(report)).toBe(original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains UI failure screenshot evidence without inventing metadata for other errors', async () => {
  const report = await compareEntities([entity], async function* (name) {
    if (name === 'export') throw new SourceError('UI table missing', 'screenshots/failed.png');
    yield { id: '1', payout: '1.00' };
  });
  expect(report.findings[0]?.screenshot).toBe('screenshots/failed.png');
  expect(new SourceError('launch failed').screenshot).toBeUndefined();
});
