import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sourceSchema, type SqlConfig } from '@logiparity/core';
import { readSql } from '@logiparity/adapters';
import { collect } from '../helpers.js';
import { testDatabase } from '../postgres.js';

let db: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  db = await testDatabase();
  await db.client.query(`CREATE TABLE ${db.schema}.shipments(id text PRIMARY KEY, payout numeric(30,2), status text)`);
  await db.client.query(
    `INSERT INTO ${db.schema}.shipments VALUES ('S1', 9007199254740993.01, 'delivered'), ('S2', 2.00, 'in_transit')`,
  );
}, 60000);
afterAll(async () => {
  await db?.close();
}, 30000);
function config(query: string, options: Record<string, unknown> = {}): SqlConfig {
  return sourceSchema.parse({
    type: 'sql',
    connectionEnv: 'TEST_DB',
    query,
    fields: { id: 'id' },
    ...options,
  }) as SqlConfig;
}
const context = () => ({ baseDir: '.', env: { TEST_DB: db.url } });

describe('PostgreSQL read-only adapter against an isolated real server', () => {
  it('reads a SELECT and CTE with parameters, retaining exact numeric strings', async () => {
    const query = `WITH deliveries AS (SELECT id, payout FROM ${db.schema}.shipments WHERE status = $1) SELECT id, payout FROM deliveries ORDER BY id`;
    expect(
      await collect(
        readSql(config(query, { params: ['delivered'], fields: { id: 'id', payout: 'payout' } }), context()),
      ),
    ).toEqual([{ id: 'S1', payout: '9007199254740993.01' }]);
    const injection = "S1'; DROP TABLE never; --";
    expect(await collect(readSql(config('SELECT $1::text AS id', { params: [injection] }), context()))).toEqual([
      { id: injection },
    ]);
  });
  it('enforces transaction_read_only at the server, even for write-through views', async () => {
    expect(await collect(readSql(config("SELECT current_setting('transaction_read_only') AS id"), context()))).toEqual([
      { id: 'on' },
    ]);
    await db.client.query(`CREATE TABLE ${db.schema}.audit(value integer)`);
    await db.client.query(
      `CREATE FUNCTION ${db.schema}.write_probe() RETURNS integer LANGUAGE plpgsql AS 'BEGIN INSERT INTO ${db.schema}.audit VALUES(1); RETURN 1; END'`,
    );
    await db.client.query(`CREATE VIEW ${db.schema}.write_view AS SELECT ${db.schema}.write_probe() AS id`);
    await expect(collect(readSql(config(`SELECT id FROM ${db.schema}.write_view`), context()))).rejects.toThrow(
      '25006',
    );
    expect((await db.client.query(`SELECT count(*) AS n FROM ${db.schema}.audit`)).rows[0]?.n).toBe('0');
  });
  it('reports missing field aliases and database errors without exposing the URL', async () => {
    await expect(collect(readSql(config('SELECT 1 AS other'), context()))).rejects.toThrow('column id');
    await expect(collect(readSql(config(`SELECT id FROM ${db.schema}.absent`), context()))).rejects.toThrow('42P01');
    try {
      await collect(
        readSql(config('SELECT 1 AS id'), {
          baseDir: '.',
          env: { TEST_DB: 'postgres://user:private-secret@127.0.0.1:1/logiparity_test' },
        }),
      );
    } catch (error) {
      expect(String(error)).not.toContain('private-secret');
      expect(String(error)).toContain('TEST_DB');
    }
  });
  it('preserves naive wall clocks while timestamptz stays an absolute Date', async () => {
    const rows = await collect(
      readSql(
        config(
          "SELECT 'S1' AS id, '2026-11-02 07:00:00'::timestamp AS local_time, '2026-11-02 13:00:00+00'::timestamptz AS utc_time",
          { fields: { id: 'id', local: 'local_time', utc: 'utc_time' } },
        ),
        context(),
      ),
    );
    expect(rows[0]?.local).toBe('2026-11-02 07:00:00');
    expect(rows[0]?.utc).toEqual(new Date('2026-11-02T13:00:00Z'));
  });
  it('streams 100,000 rows in bounded batches and cleans up cancelled streams', async () => {
    const query = 'SELECT n::text AS id, 9007199254740993.01::numeric AS payout FROM generate_series(1, 100000) n';
    let count = 0;
    for await (const row of readSql(
      config(query, { batchSize: 777, fields: { id: 'id', payout: 'payout' } }),
      context(),
    )) {
      expect(row.payout).toBe('9007199254740993.01');
      count++;
    }
    expect(count).toBe(100000);
    const rows = readSql(config(query), context())[Symbol.asyncIterator]();
    expect((await rows.next()).value).toEqual({ id: '1' });
    await rows.return?.();
    expect(await collect(readSql(config('SELECT 1 AS id'), context()))).toEqual([{ id: 1 }]);
  });
  it('limits expensive queries using a PostgreSQL statement timeout', async () => {
    const query = 'SELECT count(*) AS id FROM generate_series(1, 1000000) a CROSS JOIN generate_series(1, 1000000) b';
    await expect(collect(readSql(config(query, { timeoutMs: 50 }), context()))).rejects.toThrow('57014');
  });
});
