import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { configSchema } from '@logiparity/core';
import { readSample } from '@logiparity/adapters';
import { resolve } from 'node:path';
import { suggestDraft } from '../../packages/cli/src/suggest/draft.js';
import { columnName, guess } from '../../packages/cli/src/suggest/infer.js';
const fixture = (name: string) => resolve('tests/fixtures/suggest', name);
it('aligns name/alias variants, retains unmatched fields and blocks automatic acceptance', async () => {
  const a = await readSample(fixture('reference.csv')),
    b = await readSample(fixture('candidate.json'));
  const text = suggestDraft(
      [
        { name: 'reference', sample: a },
        { name: 'candidate', sample: b },
      ],
      process.cwd(),
    ),
    draft = parse(text);
  expect(text).toContain('Candidate key "id"');
  expect(text).toContain('reference_only');
  expect(text).toContain('candidate_only');
  expect(text).toContain('Reference only');
  expect(text).toContain('no type evidence');
  expect(text).toContain('case variants');
  expect(text).toContain('comma groups/dot decimal');
  expect(draft.entities[0].key).toBe('TODO_REVIEW_KEY');
  expect(configSchema.safeParse(draft).success).toBe(false);
  const columns = draft.entities[0].sources.reference.fields;
  expect(columns.id).toBe('Record ID');
  expect(columns.amount).toBe('Total Amount');
  expect(columns.candidate_only).toContain('TODO_MAP');
  expect(Object.values(columns)).toEqual(expect.arrayContaining(a.headers));
  expect(Object.values(draft.entities[0].sources.candidate.fields)).toEqual(expect.arrayContaining(b.headers));
  expect(draft.entities[0].compare.amount).toEqual({ type: 'money', currency: 'TODO_REVIEW_CURRENCY' });
  expect(draft.entities[0].compare.date.type).toBe('date');
  expect(draft.entities[0].compare.id.type).toBe('string');
});
it('uses source formats for calendar dates and never enables case or whitespace folding silently', () => {
  const sample = {
    file: fixture('x.csv'),
    kind: 'csv' as const,
    headers: ['id', 'date', 'status'],
    truncated: false,
    rows: [
      { id: '1', date: '20261102', status: 'Active' },
      { id: '2', date: '20261103', status: 'active' },
    ],
  };
  const second = {
    ...sample,
    rows: [
      { id: '1', date: '02-NOV-26', status: 'Active' },
      { id: '2', date: '03-NOV-26', status: 'active' },
    ],
  };
  const text = suggestDraft(
    [
      { name: 'a', sample },
      { name: 'b', sample: second },
    ],
    process.cwd(),
  );
  const rule = parse(text).entities[0].compare;
  expect(rule.date.format).toEqual({ a: 'yyyyMMdd', b: 'dd-MMM-yy' });
  expect(rule.status.caseFold).toBeUndefined();
  expect(rule.status.whitespaceFold).toBeUndefined();
});
it('rejects ambiguous normalized column names rather than dropping a column', () => {
  const sample = {
    file: 'x.csv',
    kind: 'csv' as const,
    headers: ['Record ID', 'record_id'],
    rows: [],
    truncated: false,
  };
  expect(() =>
    suggestDraft(
      [
        { name: 'a', sample },
        { name: 'b', sample },
      ],
      '.',
    ),
  ).toThrow('ambiguous normalized headers');
});
it.each([
  ['amount', ['1,234.50', '10.00'], 'money'],
  ['quantity', ['1,000', '2'], 'number'],
  ['date', ['2026-11-02', '2026-11-03'], 'date'],
  ['date', ['20261102', '20261103'], 'date'],
  ['timestamp', ['2026-11-02T13:00:00Z'], 'datetime'],
  ['status', ['Active', 'active', 'Active'], 'enum'],
  ['empty', [null, ''], 'string'],
  ['ZIP', ['00102', '00103'], 'string'],
  ['note', ['free text', 'other text'], 'string'],
] as [string, unknown[], string][])('explains the %s type guess', (name, values, type) => {
  const g = guess(name, values);
  expect(g.type).toBe(type);
  expect(g.evidence).toContain('TODO');
});
it('keeps ambiguous calendar shapes and complex JSON unresolved', () => {
  expect(guess('date', ['01/02/2026', '02/03/2026']).type).toBe('string');
  expect(guess('object', [{ value: 1 }]).evidence).toContain('complex');
  expect(guess('at', ['2026-11-02 13:00']).naive).toBe(true);
  expect(columnName('CUSTOMER ID')).toBe('customer_id');
});
