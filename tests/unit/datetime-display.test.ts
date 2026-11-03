import { expect, it } from 'vitest';
import {
  entitySchema,
  formatDatetimeUtc,
  htmlReport,
  markdownReport,
  jsonReport,
  presentationValue,
  readableDatetime,
  type Report,
} from '@logiparity/core';
const source = { type: 'csv', file: 'unused.csv', fields: { id: 'ID', at: 'At' } };
const entity = entitySchema.parse({
  name: 'order',
  key: 'id',
  sources: { api: source, export: source },
  compare: { at: { type: 'datetime' }, count: { type: 'number' } },
});
const presentation = { entities: [entity] };
it.each([
  [0, '1970-01-01T00:00:00Z'],
  [-1, '1969-12-31T23:59:59.999Z'],
  [1793624460000, '2026-11-02T13:01:00Z'],
  [1793624460123, '2026-11-02T13:01:00.123Z'],
])('formats epoch %s as UTC without losing milliseconds', (epoch, iso) => {
  expect(formatDatetimeUtc(epoch as number)).toBe(iso);
  expect(presentationValue(epoch as number, 'order', 'at', false, presentation)).toBe(
    readableDatetime(epoch as number),
  );
});
it.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])('does not format invalid epoch %s', (epoch) =>
  expect(formatDatetimeUtc(epoch)).toBeUndefined(),
);
it('shows readable UTC only for configured datetime fields and preserves raw JSON', () => {
  const report: Report = {
    schemaVersion: 1,
    entities: [],
    findings: [
      {
        type: 'field_mismatch',
        entity: 'order',
        source: 'export',
        key: 'S1',
        field: 'at',
        expected: 1793624460000,
        actual: 1793624460123,
        message: 'datetime differs',
      },
    ],
  };
  const json = jsonReport(report);
  for (const render of [htmlReport, markdownReport])
    expect(render(report, presentation).replaceAll('\\(', '(').replaceAll('\\)', ')')).toContain(
      'Nov 2, 2026, 1:01 PM UTC',
    );
  expect(jsonReport(report)).toBe(json);
  expect(json).not.toContain('2026-11-02');
  expect(presentationValue(1793624460000, 'order', 'count', false, presentation)).toBe('1793624460000');
  expect(presentationValue(null, 'order', 'at', false, presentation)).toBe('null');
  expect(presentationValue(0, 'order', 'at', true, presentation)).toBe('0');
  expect(presentationValue(0, 'order', 'at', false)).toBe('0');
});
