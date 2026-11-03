import { describe, expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  jsonReport,
  reportExitCode,
  type DataRow,
  type SourceReader,
} from '@logiparity/core';

const source = { type: 'csv', file: 'unused.csv', fields: { id: 'ID', payout: 'Payout' } };
const entity = entitySchema.parse({
  name: 'shipment',
  key: 'id',
  sources: { api: source, export: source },
  compare: { payout: { type: 'money', currency: 'USD' } },
});
function fromRows(rows: Record<string, DataRow[]>): SourceReader {
  return async function* (name) {
    yield* rows[name] ?? [];
  };
}

describe('comparison engine', () => {
  it('reports missing, extra and exact one-cent discrepancies', async () => {
    const report = await compareEntities(
      [entity],
      fromRows({
        api: [
          { id: 'S2', payout: '1.01' },
          { id: 'S1', payout: '2.00' },
        ],
        export: [
          { id: 'S2', payout: '1.00' },
          { id: 'S3', payout: '2.00' },
        ],
      }),
    );
    expect(report.findings.map((f) => [f.key, f.type])).toEqual([
      ['S1', 'missing_in_source'],
      ['S2', 'field_mismatch'],
      ['S3', 'extra_in_source'],
    ]);
    expect(report.findings[1]).toMatchObject({ field: 'payout', expected: 101n, actual: 100n });
    expect(reportExitCode(report)).toBe(1);
    expect(report.entities).toMatchObject([{ entity: 'shipment', reference: 'api', counts: { api: 2, export: 2 } }]);
  });
  it('uses the first duplicate record, reports duplicates in reference and compared source', async () => {
    const report = await compareEntities(
      [entity],
      fromRows({
        api: [
          { id: 'X', payout: '1.00' },
          { id: 'X', payout: '2.00' },
        ],
        export: [
          { id: 'X', payout: '1.00' },
          { id: 'X', payout: '3.00' },
        ],
      }),
    );
    expect(report.findings.map((f) => f.type)).toEqual(['duplicate_key', 'duplicate_key']);
    expect(report.entities[0]?.counts).toEqual({ api: 2, export: 2 });
  });
  it('matches trimmed keys and supports partial sources', async () => {
    const partial = entitySchema.parse({
      name: 'x',
      key: 'id',
      sources: { api: source, ui: { ...source, fields: { id: 'ID' } } },
    });
    const report = await compareEntities(
      [partial],
      fromRows({ api: [{ id: ' X ', payout: '1.00' }], ui: [{ id: 'X' }] }),
    );
    expect(report.findings).toEqual([]);
    expect(reportExitCode(report)).toBe(0);
  });
  it.each([null, '', {}, 1.2, Number.MAX_SAFE_INTEGER + 1])('rejects invalid key %s as a row finding', async (id) => {
    const report = await compareEntities([entity], fromRows({ api: [{ id, payout: '1.00' }], export: [] }));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.type).toBe('invalid_value');
    expect(report.findings[0]?.row).toBe(1);
    expect(reportExitCode(report)).toBe(1);
  });
  it('reports normalization location and suppresses misleading missing records for failed sources', async () => {
    const report = await compareEntities(
      [entity],
      fromRows({ api: [{ id: 'S1', payout: '1.00' }], export: [{ id: 'S1', payout: 'bad' }] }),
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ row: 1, key: 'S1', field: 'payout' });
    expect(report.findings[0]?.type).toBe('invalid_value');
  });
  it('turns a failure after partial reading into one source error', async () => {
    const read: SourceReader = async function* (name) {
      yield { id: '1', payout: '1.00' };
      if (name === 'export') throw new Error('fixture connection interrupted');
    };
    const report = await compareEntities([entity], read);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.message).toContain('connection interrupted');
  });
  it('compares numeric and null keys/values without treating missing records as field mismatches', async () => {
    const report = await compareEntities(
      [entity],
      fromRows({ api: [{ id: 1, payout: null }], export: [{ id: '1', payout: '' }] }),
    );
    expect(report.findings).toEqual([]);
  });
  it('produces byte-identical reports regardless of record arrival order', async () => {
    const api = [
      { id: 'b', payout: '1.00' },
      { id: 'a', payout: '2.00' },
    ];
    const compared = [
      { id: 'b', payout: '1.01' },
      { id: 'a', payout: '2.01' },
    ];
    const first = await compareEntities([entity], fromRows({ api, export: compared }));
    const second = await compareEntities(
      [entity],
      fromRows({ api: [...api].reverse(), export: [...compared].reverse() }),
    );
    expect(jsonReport(first)).toBe(jsonReport(second));
  });
  it('handles 100,000 records in each of two async source streams', async () => {
    const read: SourceReader = async function* () {
      for (let i = 0; i < 100000; i++) yield { id: String(i), payout: '9007199254740993.01' };
    };
    const largeEntity = entitySchema.parse({
      ...entity,
      aggregates: [
        { name: 'count', type: 'count' },
        { name: 'payout', type: 'sum', field: 'payout' },
      ],
    });
    const report = await compareEntities([largeEntity], read);
    expect(report.findings).toEqual([]);
    expect(report.entities[0]?.counts).toEqual({ api: 100000, export: 100000 });
    expect(report.entities[0]?.aggregates?.[1]?.values).toEqual({
      api: 90071992547409930100000n,
      export: 90071992547409930100000n,
    });
  }, 30000);
});
