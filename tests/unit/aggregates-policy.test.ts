import { describe, expect, it } from 'vitest';
import { compareEntities, entitySchema, jsonReport, reportExitCode, type DataRow, type EntityConfig, type SourceReader } from '@logiparity/core';

const fields = { id: 'ID', status: 'Status', payout: 'Payout', distance: 'Distance' };
const source = { type: 'csv', file: 'unused.csv', fields };
const raw = { name: 'shipment', key: 'id', sources: { api: source, export: source }, compare: { status: { type: 'enum', map: { Delivered: 'delivered' } }, payout: { type: 'money', currency: 'USD' }, distance: { type: 'number' } } };
function read(rows: Record<string, DataRow[]>): SourceReader { return async function* (name) { yield* rows[name] ?? []; }; }
const row = (id: string, payout = '1.01', status = 'delivered', distance: string | null = '0.1') => ({ id, payout, status, distance });
async function check(entity: EntityConfig, api: DataRow[], exported: DataRow[]) { return compareEntities([entity], read({ api, export: exported })); }

describe('aggregates', () => {
  const aggregates = [
    { name: 'delivered_count', type: 'count', where: { status: 'Delivered' } },
    { name: 'payout_total', type: 'sum', field: 'payout' },
    { name: 'distance_total', type: 'sum', field: 'distance' },
  ];
  it('compares normalized filtered counts and sums while retaining exact monetary values', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates });
    const report = await check(entity, [row('a', '9007199254740993.01'), row('b', '2.00', 'in_transit')], [row('a', '9007199254740993.00')]);
    expect(report.findings.filter((f) => f.type === 'aggregate_mismatch').map((f) => [f.field, f.expected, f.actual])).toEqual([
      ['distance_total', 0.2, 0.1], ['payout_total', 900719925474099501n, 900719925474099300n],
    ]);
    expect(report.entities[0]?.aggregates?.[0]?.values).toEqual({ api: 1, export: 1 });
    expect(jsonReport(report)).toContain('900719925474099501');
  });
  it('reports count mismatch even when record mismatches are allowed', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates, failOn: ['aggregate'] });
    const report = await check(entity, [row('a'), row('b')], [row('a')]);
    expect(report.findings.filter((f) => f.type === 'aggregate_mismatch').map((f) => f.field)).toEqual(['delivered_count', 'distance_total', 'payout_total']);
    expect(report.findings.find((f) => f.type === 'missing_in_source')?.blocking).toBe(false);
    expect(reportExitCode(report)).toBe(1);
  });
  it('treats empty sources and all-null sums as zero; deduplicates keys before aggregating', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates });
    const empty = await check(entity, [], []);
    expect(empty.findings).toEqual([]);
    expect(empty.entities[0]?.aggregates?.map((a) => a.values.api)).toEqual([0, 0n, 0]);
    const duplicate = await check(entity, [row('a', '1.01', 'delivered', null), row('a', '9.00')], [row('a', '1.01', 'delivered', null)]);
    expect(duplicate.findings.map((f) => f.type)).toEqual(['duplicate_key']);
    expect(duplicate.entities[0]?.aggregates?.[2]?.values).toEqual({ api: 0, export: 0 });
  });
  it('uses aggregate-specific tolerances, including inclusive money boundaries', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates: [{ name: 'payout', type: 'sum', field: 'payout', tolerance: 1 }, { name: 'distance', type: 'sum', field: 'distance', tolerance: 0.01 }, { name: 'count', type: 'count', tolerance: 1 }] });
    const report = await check(entity, [row('a', '1.01', 'delivered', '0.1')], [row('a', '1.00', 'delivered', '0.105')]);
    expect(report.findings.filter((f) => f.type === 'aggregate_mismatch')).toEqual([]);
    const reverse = await check(entity, [row('a', '1.00')], [row('a', '1.01')]);
    expect(reverse.findings.filter((f) => f.type === 'aggregate_mismatch')).toEqual([]);
  });
  it('computes exact decimal sums independently of row order, including exponents', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates: [{ name: 'distance', type: 'sum', field: 'distance' }], failOn: ['aggregate'] });
    const values = [row('a', '1.00', 'delivered', '1000000000000000000000'), row('b', '1.00', 'delivered', '-1000000000000000000000'), row('c', '1.00', 'delivered', '0.0000001'), row('d', '1.00', 'delivered', '-0.1'), row('e', '1.00', 'delivered', '0.2')];
    const report = await check(entity, values, [...values].reverse());
    expect(report.findings).toEqual([]);
    expect(report.entities[0]?.aggregates?.[0]?.values).toEqual({ api: 0.1000001, export: 0.1000001 });
    const decimal = await check(entity, [row('a', '1.00', 'delivered', '0.1'), row('b', '1.00', 'delivered', '0.2')], [row('c', '1.00', 'delivered', '0.3')]);
    expect(decimal.entities[0]?.aggregates?.[0]?.values).toEqual({ api: 0.3, export: 0.3 });
    expect(reportExitCode(decimal)).toBe(0);
  });
  it('honors inclusive decimal tolerance boundaries without subtraction artifacts', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates: [{ name: 'distance', type: 'sum', field: 'distance', tolerance: 0.1 }], failOn: ['aggregate'] });
    for (const [expected, actual] of [['0.3', '0.4'], ['0.4', '0.3'], ['0.001', '0.101']]) {
      const report = await check(entity, [row('a', '1.00', 'delivered', expected)], [row('a', '1.00', 'delivered', actual)]);
      expect(reportExitCode(report)).toBe(0);
    }
  });
  it('reports opposite large finite totals as a mismatch without overflowing the difference', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates: [{ name: 'distance', type: 'sum', field: 'distance' }], failOn: ['aggregate'] });
    const value = '1' + '0'.repeat(308);
    const report = await check(entity, [row('a', '1.00', 'delivered', value)], [row('a', '1.00', 'delivered', '-' + value)]);
    expect(report.findings.find((f) => f.type === 'aggregate_mismatch')).toBeDefined(); expect(reportExitCode(report)).toBe(1);
  });
  it('explicitly skips aggregates unavailable in partial sources', async () => {
    const partial = { ...source, fields: { id: 'ID' } };
    const entity = entitySchema.parse({ ...raw, sources: { api: source, export: partial }, aggregates });
    const report = await check(entity, [row('a')], [{ id: 'a' }]);
    expect(report.findings).toEqual([]);
    expect(report.entities[0]?.aggregates?.every((a) => a.skippedSources.includes('export'))).toBe(true);
  });
  it('reports aggregate evaluation failures as source errors, without partial aggregate results', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates, failOn: [] });
    const report = await check(entity, [row('a')], [{ id: 'a', status: 'delivered', payout: '1.01' }]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ type: 'source_error', blocking: true });
    expect(report.findings[0]?.message).toContain('aggregate distance_total');
    expect(report.entities[0]?.aggregates?.every((a) => !Object.hasOwn(a.values, 'export'))).toBe(true);
    expect(reportExitCode(report)).toBe(2);
  });
  it('rejects overflowing finite numeric sums', async () => {
    const entity = entitySchema.parse({ ...raw, aggregates: [{ name: 'distance', type: 'sum', field: 'distance' }] });
    const value = '1' + '0'.repeat(308);
    const report = await check(entity, [row('a', '1.00', 'delivered', value), row('b', '1.00', 'delivered', value)], []);
    expect(report.findings[0]?.message).toContain('exceeds finite'); expect(reportExitCode(report)).toBe(2);
  });
  it('validates aggregate names, fields, filter mappings and monetary tolerances', () => {
    for (const invalid of [
      [{ name: 'a', type: 'sum', field: 'unknown' }],
      [{ name: 'a', type: 'sum', field: 'status' }],
      [{ name: 'a', type: 'count', where: { unknown: true } }],
      [{ name: 'a', type: 'count' }, { name: 'a', type: 'count' }],
      [{ name: 'a', type: 'sum', field: 'payout', tolerance: 0.01 }],
      [{ name: 'a', type: 'count', tolerance: -1 }],
    ]) expect(entitySchema.safeParse({ ...raw, aggregates: invalid }).success).toBe(false);
  });
});

describe('failure policies', () => {
  it('accepts findings at the threshold, fails above it, and retains every finding', async () => {
    const entity = entitySchema.parse({ ...raw, failOn: { missing: 1, mismatch: 1 } });
    const allowed = await check(entity, [row('a'), row('b')], [row('a', '1.00')]);
    expect(allowed.findings).toHaveLength(2); expect(allowed.findings.every((f) => f.blocking === false)).toBe(true);
    expect(reportExitCode(allowed)).toBe(0);
    const failed = await check(entity, [row('a'), row('b'), row('c')], [row('a', '1.00')]);
    expect(failed.findings.filter((f) => f.blocking).map((f) => f.type)).toEqual(['missing_in_source', 'missing_in_source']);
    expect(reportExitCode(failed)).toBe(1);
  });
  it('supports report-only mode but never masks runtime errors', async () => {
    const entity = entitySchema.parse({ ...raw, failOn: [] });
    const report = await check(entity, [row('a'), row('a')], [row('extra')]);
    expect(report.findings.every((f) => f.blocking === false)).toBe(true); expect(reportExitCode(report)).toBe(0);
    const broken = await check(entity, [row('a')], [{ id: '' }]);
    expect(reportExitCode(broken)).toBe(2);
  });
  it('counts categories across sources but isolates each entity policy', async () => {
    const first = entitySchema.parse({ ...raw, failOn: { mismatch: 1 }, sources: { api: source, export: source, another: source } });
    const second = entitySchema.parse({ ...raw, name: 'another_entity', failOn: {} });
    const report = await compareEntities([first, second], read({ api: [row('a')], export: [row('a', '1.00')], another: [row('a', '1.00')] }));
    expect(report.findings.filter((f) => f.entity === 'shipment').every((f) => f.blocking)).toBe(true);
    expect(report.findings.filter((f) => f.entity === 'another_entity').every((f) => f.blocking === false)).toBe(true);
  });
  it('validates category and threshold typos rather than silently ignoring them', () => {
    for (const failOn of [['source_error'], { missing: -1 }, { mismatch: 0.5 }, { typo: 0 }, { duplicate: Number.MAX_SAFE_INTEGER + 1 }]) expect(entitySchema.safeParse({ ...raw, failOn }).success).toBe(false);
  });
});
