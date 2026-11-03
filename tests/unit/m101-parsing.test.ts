import { expect, it } from 'vitest';
import { compareEntities, entitySchema, normalize, ruleSchema } from '@logiparity/core';
const csv = { type: 'csv', file: 'unused', fields: { id: 'id', at: 'at', amount: 'amount', status: 'status' } };
const definition = (changes: Record<string, unknown> = {}) =>
  entitySchema.parse({ name: 'order', key: 'id', sources: { a: csv, b: csv }, ...changes });
it('does not infer mappings from blank statuses (raj/t8)', async () => {
  const report = await compareEntities([definition()], async function* (name) {
    for (let i = 1; i <= 3; i++) yield { id: `O${i}`, status: name === 'a' ? 'delivered' : '' };
  });
  expect(report.groups).toEqual([]);
});
it('does not infer page boundaries from CSV strides (raj/t3)', async () => {
  const report = await compareEntities([definition()], async function* (name) {
    for (let i = 1; i <= 20; i++) if (name === 'a' || ![4, 7, 10].includes(i)) yield { id: `O${i}` };
  });
  expect(report.findings.map((f) => f.key)).toEqual(['O4', 'O7', 'O10']);
  expect(report.groups?.[0]?.summary).not.toMatch(/page|pagination/i);
});
it('gates timezone explanations on offset-free source values and a quarter-hour delta (raj/t1)', async () => {
  const config = definition({ compare: { at: { type: 'datetime' } } });
  const report = await compareEntities([config], async function* (name) {
    for (let i = 1; i <= 3; i++)
      yield { id: `O${i}`, at: name === 'a' ? '2026-03-01T10:00:00Z' : '2026-03-01T10:02:00Z' };
  });
  expect(report.groups?.[0]?.summary).not.toMatch(/timezone|local time/i);
});
it('accepts real numeric JSON scalars with scientific notation (raj/t6)', () => {
  for (const value of [1e-7, 1e21]) expect(normalize(value, ruleSchema.parse({ type: 'number' }), 'a')).toBe(value);
});
it('accepts short ISO offsets and hour-only times without false gap diagnostics (raj/t4)', () => {
  const rule = ruleSchema.parse({ type: 'datetime', sourceTimezones: { a: 'America/Chicago' } });
  expect(normalize('2026-03-08T20:00:00+05', rule, 'a')).toBe(Date.parse('2026-03-08T15:00:00Z'));
  expect(normalize('2026-03-08T10', rule, 'a')).toBe(Date.parse('2026-03-08T15:00:00Z'));
});
it.each([
  ['501.7266', 'half-up', 50173n],
  ['1.005', 'half-even', 100n],
  ['1.015', 'half-even', 102n],
  ['-1.005', 'half-up', -101n],
])('rounds %s using %s only when opted in (tom)', (value, round, expected) => {
  expect(normalize(value, ruleSchema.parse({ type: 'money', currency: 'USD', round }), 'a')).toBe(expected);
});
it('rejects invalid locales and source zones at validation (raj/t4)', () => {
  expect(ruleSchema.safeParse({ type: 'number', locale: 'en_US' }).success).toBe(false);
  expect(ruleSchema.safeParse({ type: 'datetime', sourceTimezones: { a: 'America/Chicagoo' } }).success).toBe(false);
});
it('combines per-source formatting with field overrides (raj/t6)', async () => {
  const config = definition({
    sources: { a: csv, b: { ...csv, locale: 'de-DE' } },
    compare: { amount: { type: 'money', currency: 'EUR' } },
  });
  const report = await compareEntities([config], async function* (name) {
    yield { id: 'O1', amount: name === 'a' ? '1234.50' : '1.234,50' };
  });
  expect(report.findings).toEqual([]);
});
it('applies enum maps on key parts before matching (tom)', async () => {
  const config = definition({ compare: { id: { type: 'enum', map: { FSC: 'fuel' } } } });
  const report = await compareEntities([config], async function* (name) {
    yield { id: name === 'a' ? 'fuel' : 'FSC' };
  });
  expect(report.findings).toEqual([]);
});
it('rejects projected-away uniqueness fields and accepts equivalent array rollup keys (raj/t7)', () => {
  const sources = {
    a: csv,
    b: {
      ...csv,
      unique: ['status'],
      rollup: { by: ['id'], sum: ['amount'], first: ['at'], duplicates: { by: ['id', 'status'] } },
    },
  };
  const result = entitySchema.safeParse({
    name: 'order',
    key: 'id',
    sources,
    compare: { amount: { type: 'money', currency: 'USD' } },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.message).toContain('Unique field status');
    expect(result.error.message).not.toContain('must match the entity key');
  }
});
it('applies the same DST gap and overlap rules to tagged XLSX wall clocks', () => {
  const rule = ruleSchema.parse({ type: 'datetime', sourceTimezones: { x: 'America/Chicago' } });
  for (const [text, expected] of [
    ['2026-03-08T02:30:00', 'gap'],
    ['2026-11-01T01:30:00', 'ambiguous'],
  ]) {
    const date = new Date(text + 'Z');
    Object.defineProperty(date, Symbol.for('logiparity.wallClock'), { value: text });
    expect(() => normalize(date, rule, 'x')).toThrow(expected);
  }
});
it('permits timezone hints when every source value lacks an offset and the delta is a quarter-hour multiple', async () => {
  const config = definition({ compare: { at: { type: 'datetime', sourceTimezones: { b: 'UTC' } } } });
  const report = await compareEntities([config], async function* (name) {
    for (let i = 1; i <= 3; i++)
      yield { id: `O${i}`, at: name === 'a' ? '2026-03-01T10:00:00Z' : '2026-03-01T11:00:00' };
  });
  expect(report.groups?.[0]?.cause).toBe('timezone');
});
it('uses a configured reference page size as page-boundary evidence for a file export', async () => {
  const config = definition({
    sources: {
      a: {
        type: 'rest',
        baseUrl: 'http://unused.test',
        path: '/',
        pagination: { type: 'page', size: 3 },
        fields: { id: '$.id' },
      },
      b: csv,
    },
  });
  const report = await compareEntities([config], async function* (source) {
    for (let i = 1; i <= 12; i++) if (source === 'a' || i % 3 !== 0) yield { id: `O${i}` };
  });
  expect(report.groups?.[0]?.cause).toBe('pagination');
});
it('marks categories skipped when the reference failed instead of passing unperformed comparisons', async () => {
  const { junitReport } = await import('@logiparity/core');
  const report = await compareEntities([definition()], async function* () {
    throw new Error('Reference unavailable');
    yield {};
  });
  const xml = junitReport(report);
  expect(xml).toContain('skipped="7"');
  expect(xml.match(/<skipped /g)).toHaveLength(7);
});
it('flags blank numeric rollup sums instead of silently treating them as zero', async () => {
  const config = definition({
    sources: { a: csv, b: { ...csv, rollup: { by: 'id', sum: ['amount'], first: ['at', 'status'] } } },
    compare: { amount: { type: 'number' } },
  });
  const report = await compareEntities([config], async function* (source) {
    yield { id: 'O1', amount: source === 'a' ? 1 : null };
  });
  expect(report.findings.some((finding) => finding.type === 'invalid_value' && finding.field === 'amount')).toBe(true);
});
it('reports a misspelled key without a second required-key error', async () => {
  const { configSchema, formatConfigIssues } = await import('@logiparity/core');
  const raw = { version: 1, entities: [{ name: 'o', kee: 'id', sources: { a: csv, b: csv } }] };
  const result = configSchema.safeParse(raw);
  expect(result.success).toBe(false);
  if (!result.success) {
    const message = formatConfigIssues(configSchema, raw, result.error);
    expect(message).toContain('kee');
    expect(message).not.toContain('entities[0].key:');
  }
});
it('keeps source date defaults when a field overrides only another source', async () => {
  const config = definition({
    sources: { a: csv, b: { ...csv, datetimeFormat: 'MM/dd/yyyy HH:mm' } },
    compare: {
      at: { type: 'datetime', format: { a: "yyyy-MM-dd'T'HH:mm:ss'Z'" }, sourceTimezones: { a: 'UTC', b: 'UTC' } },
    },
  });
  const report = await compareEntities([config], async function* (name) {
    yield { id: 'O1', at: name === 'a' ? '2026-11-02T13:01:00Z' : '11/02/2026 13:01' };
  });
  expect(report.findings).toEqual([]);
});
