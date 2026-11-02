import { expect, it } from 'vitest';
import { validateReadOnlySql } from '../../packages/adapters/src/sql-guard.js';
import { readSql } from '@logiparity/adapters';
import { sourceSchema, type SqlConfig } from '@logiparity/core';
import { collect } from '../helpers.js';

it.each([
  'SELECT id FROM shipments WHERE status = $1',
  "SELECT 'DELETE FROM shipments; DROP DATABASE x' AS text",
  '/* UPDATE is a comment */ SELECT id FROM shipments',
  'WITH x AS (SELECT id FROM shipments) SELECT * FROM x',
  'WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<3) SELECT * FROM x',
  'SELECT 1 UNION ALL SELECT 2',
  'SELECT pg_catalog.count(*), sum(payout) FROM shipments',
  "SELECT current_setting('transaction_read_only') AS mode",
])('accepts supported read-only SQL: %s', (sql) => expect(() => validateReadOnlySql(sql)).not.toThrow());

it.each([
  'DELETE FROM shipments', 'UPDATE shipments SET status = $1', 'INSERT INTO shipments(id) VALUES(1)',
  'DROP TABLE shipments', 'CREATE TABLE surprise(id int)', 'TRUNCATE shipments', 'SELECT 1; SELECT 2',
  'WITH x AS (DELETE FROM shipments RETURNING *) SELECT * FROM x',
  'WITH x AS (UPDATE shipments SET id=2 RETURNING *) SELECT * FROM x',
  'WITH x AS (SELECT 1) DELETE FROM shipments',
  'SELECT * INTO temp stolen FROM shipments', 'SELECT id FROM shipments FOR UPDATE', 'SELECT id FROM shipments FOR SHARE',
  'EXPLAIN ANALYZE DELETE FROM shipments', "SELECT set_config('transaction_read_only','off',true)",
  "SELECT nextval('sequence')", 'SELECT pg_terminate_backend(123)', "SELECT dblink_exec('db','DELETE FROM x')", 'SELECT public.lower(id) FROM shipments',
  "SELECT pg_read_file('/etc/passwd')", 'CALL proc()', 'SELECT FROM', '', '-- comment only',
])('rejects unsafe or unsupported SQL before execution: %s', (sql) => expect(() => validateReadOnlySql(sql)).toThrow());

it('rejects non-SELECT SQL before reading connection credentials or contacting a database', async () => {
  const config = sourceSchema.parse({ type: 'sql', query: 'DELETE FROM shipments', connectionEnv: 'MISSING', fields: { id: 'id' } }) as SqlConfig;
  await expect(collect(readSql(config, { baseDir: '.', env: {} }))).rejects.toThrow('SELECT');
  const valid = { ...config, query: 'SELECT 1 AS id' };
  await expect(collect(readSql(valid, { baseDir: '.', env: {} }))).rejects.toThrow('MISSING');
  await expect(collect(readSql(valid, { baseDir: '.', env: { MISSING: 'not-a-postgres-url' } }))).rejects.toThrow('explicit postgres://');
});
