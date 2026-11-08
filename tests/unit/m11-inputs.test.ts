import { expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  ruleSchema,
  normalize,
  sourceRule,
  consoleReport,
  markdownReport,
  htmlReport,
  junitReport,
  jsonReport,
} from '@logiparity/core';
import { adapters } from '@logiparity/adapters';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { checkedReport } from '../../scripts/validate-report.mjs';

it('compares the offline FMCSA date-only repro with per-source calendar formats', async () => {
  const original = parse(await readFile('tests/fixtures/m11/2-date-only/parity.yaml', 'utf8'));
  const invalid = entitySchema.safeParse(original.entities[0]);
  expect(invalid.success).toBe(false);
  if (!invalid.success)
    expect(invalid.error.issues.map((issue) => issue.path)).toEqual([
      ['compare', 'd', 'format', 'a'],
      ['compare', 'd', 'format', 'b'],
    ]);
  const raw = { ...original.entities[0], compare: { d: { type: 'date', format: { a: 'yyyyMMdd', b: 'dd-MMM-yy' } } } };
  const entity = entitySchema.parse(raw);
  const report = await checkedReport(
    compareEntities([entity], (_, source) =>
      adapters.read(source, { baseDir: resolve('tests/fixtures/m11/2-date-only'), env: {} }),
    ),
  );
  expect(report.findings).toEqual([]);
});
it.each([
  ['yyyyMMdd', '20250107'],
  ['dd-MMM-yy', '07-JAN-25'],
  ['yyyy-MM-dd', '2025-01-07'],
])('normalizes calendar format %s to an ISO calendar day', (format, input) => {
  const rule = ruleSchema.parse({ type: 'date', format });
  expect(normalize(input, rule, 'a')).toBe('2025-01-07');
});
it('uses a fixed two-digit pivot, validates leap dates and rejects times/zones on calendar dates', () => {
  const rule = ruleSchema.parse({ type: 'date', format: 'dd-MMM-yy' });
  expect(normalize('01-JAN-68', rule, 'a')).toBe('2068-01-01');
  expect(normalize('01-JAN-69', rule, 'a')).toBe('1969-01-01');
  const iso = ruleSchema.parse({ type: 'date' });
  expect(normalize('2024-02-29', iso, 'a')).toBe('2024-02-29');
  for (const value of ['2025-02-29', '2025-01', '2025', '2025-01-07T00:00:00Z', '20250107', '2025-01-07+03:00'])
    expect(() => normalize(value, iso, 'a')).toThrow();
  expect(() => ruleSchema.parse({ type: 'date', format: 'yyyy-MM-dd HH:mm' })).toThrow(/calendar|time/i);
});
it.each(['yyyyMMdd', 'dd-MMM-yy', "yyyy-MM-dd 'time'", 'DD'])(
  'rejects a datetime format with no time during validation: %s',
  (format) => {
    expect(() => ruleSchema.parse({ type: 'datetime', format })).toThrow(/type: date/);
    expect(() => ruleSchema.parse({ type: 'datetime', format: { a: format, b: 'yyyy-MM-dd HH:mm' } })).toThrow(
      /type: date/,
    );
  },
);
it('validates a source datetimeFormat against the fields using it and keeps date formats separate', () => {
  const fields = { id: 'id', d: 'd' };
  const file = { type: 'csv', file: 'x', fields, datetimeFormat: 'yyyyMMdd' };
  expect(() =>
    entitySchema.parse({ name: 'row', key: 'id', sources: { a: file, b: file }, compare: { d: { type: 'datetime' } } }),
  ).toThrow(/type: date/);
  const dateSource = { type: 'csv', file: 'x', fields, dateFormat: 'yyyyMMdd' };
  const entity = entitySchema.parse({
    name: 'row',
    key: 'id',
    sources: { a: dateSource, b: dateSource },
    compare: { d: { type: 'date' } },
  });
  expect(normalize('20250107', sourceRule(entity.compare.d, entity.sources.a, 'a'), 'a')).toBe('2025-01-07');
});
it('can explicitly normalize repeated whitespace without changing case or the default', () => {
  expect(normalize('In  transit', ruleSchema.parse({ type: 'enum' }), 'a')).toBe('In  transit');
  expect(normalize(' In  transit ', ruleSchema.parse({ type: 'enum', whitespaceFold: true }), 'a')).toBe('In transit');
});
it('reconciles decimal number sums with missing, extra and changed rows in all formats', async () => {
  const source = { type: 'csv', file: 'x', fields: { id: 'id', n: 'n' } };
  const entity = entitySchema.parse({
    name: 'carrier',
    key: 'id',
    sources: { a: source, b: source },
    compare: { n: { type: 'number' } },
    aggregates: [{ name: 'units', type: 'sum', field: 'n' }],
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield* name === 'a'
        ? [
            { id: '1', n: 0.1 },
            { id: '2', n: 0.2 },
            { id: 'missing', n: 0.4 },
          ]
        : [
            { id: '1', n: 0.2 },
            { id: '2', n: 0.4 },
            { id: 'extra', n: 0.5 },
          ];
    }),
  );
  expect(report.entities[0]?.aggregates?.[0]?.reconciliation?.b).toMatchObject({
    missingRows: { count: 1, amount: '-0.4' },
    extraRows: { count: 1, amount: '0.5' },
    valueDifferences: { count: 2, amount: '0.3' },
    remainder: '0',
  });
  expect(report.findings.find((f) => f.type === 'aggregate_mismatch')?.accounting?.remainder).toBe('0');
  for (const text of [
    consoleReport(report, { entities: [entity] }),
    markdownReport(report, { entities: [entity] }),
    htmlReport(report, { entities: [entity] }),
    junitReport(report, new Date(), { entities: [entity] }),
  ]) {
    expect(text).toContain('Unexplained remainder');
    expect(text).toContain('−0.4');
    expect(text).toContain('+0.3');
    expect(text).not.toContain('0000000000000');
  }
  expect(jsonReport(report)).toContain('"reconciliation"');
});
it('keeps invalid numeric rows uncertain and tolerated differences unexplained', async () => {
  const source = { type: 'csv', file: 'x', fields: { id: 'id', n: 'n' } };
  const entity = entitySchema.parse({
    name: 'row',
    key: 'id',
    sources: { a: source, b: source },
    compare: { n: { type: 'number', tolerance: 0.2 } },
    aggregates: [{ name: 'sum', type: 'sum', field: 'n' }],
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield { id: '1', n: name === 'a' ? 0.1 : 0.2 };
      yield { id: '2', n: name === 'a' ? 1 : 'bad' };
    }),
  );
  const parts = report.entities[0]?.aggregates?.[0]?.reconciliation?.b;
  expect(parts).toMatchObject({ remainder: '0.1', uncertain: { keys: [['2']], amount: '-1' } });
  expect(report.findings.find((f) => f.type === 'aggregate_mismatch')?.accounting).toBeUndefined();
});
it('retains exact numeric totals beyond the precision of a combined JavaScript number', async () => {
  const source = { type: 'csv', file: 'x', fields: { id: 'id', n: 'n' } };
  const entity = entitySchema.parse({
    name: 'row',
    key: 'id',
    sources: { a: source, b: source },
    compare: { n: { type: 'number' } },
    aggregates: [{ name: 'sum', type: 'sum', field: 'n' }],
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield { id: '1', n: 1e16 };
      if (name === 'a') yield { id: '2', n: 0.1 };
    }),
  );
  const total = report.entities[0]!.aggregates![0]!;
  expect(total.exactValues).toEqual({ a: '10000000000000000.1', b: '10000000000000000' });
  expect(total.reconciliation?.b).toMatchObject({ missingRows: { amount: '-0.1' }, remainder: '0' });
  expect(report.findings.find((f) => f.type === 'aggregate_mismatch')?.accounting?.remainder).toBe('0');
  for (const text of [
    consoleReport(report, { entities: [entity] }),
    markdownReport(report, { entities: [entity] }),
    htmlReport(report, { entities: [entity] }),
    junitReport(report, new Date(), { entities: [entity] }),
  ]) {
    expect(text).toContain('−0.1');
    expect(text).toContain('Unexplained remainder');
  }
});
