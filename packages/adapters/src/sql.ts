import { finished } from 'node:stream/promises';

import type QueryStreamType from 'pg-query-stream';
import {
  assertAllowedHost,
  fieldPath,
  SourceError,
  type AdapterContext,
  type DataRow,
  type SqlConfig,
} from '@logiparity/core';
import { validateReadOnlySql } from './sql-guard.js';

export async function* readSql(config: SqlConfig, context: AdapterContext): AsyncIterable<DataRow> {
  validateReadOnlySql(config.query); // Must happen before credentials are read or any connection is made.
  const [{ default: pg }, { default: QueryStream }] = await Promise.all([import('pg'), import('pg-query-stream')]);
  const connection = Object.hasOwn(context.env, config.connectionEnv) ? context.env[config.connectionEnv] : undefined;
  if (!connection)
    throw new SourceError(
      `SQL connection environment variable ${config.connectionEnv} is missing; set a test/staging PostgreSQL URL for a read-only role.`,
    );
  try {
    const url = new URL(connection);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2)
      throw new Error('Invalid URL');
  } catch {
    throw new SourceError(
      `SQL ${config.connectionEnv} must contain an explicit postgres:// or postgresql:// host/database URL; correct the environment variable.`,
    );
  }
  assertAllowedHost(connection, context.allowedHosts, 'SQL');
  const client = new pg.Client({
    connectionString: connection,
    application_name: 'logiparity',
    connectionTimeoutMillis: config.timeoutMs,
  });
  // Keep timestamp-without-timezone wall clocks available for sourceTimezones.
  // timestamptz stays pg's Date, and numeric/int8 stay pg's exact decimal strings.
  client.setTypeParser(1114, (text: string) => text);
  client.on('error', () => {
    /* Active operations report connection errors; prevent idle socket errors from escaping cleanup. */
  });
  let transaction = false;
  let stream: QueryStreamType | undefined;
  let stage = 'connect';
  try {
    await client.connect();
    stage = 'begin a read-only transaction';
    await client.query('BEGIN READ ONLY');
    transaction = true;
    await client.query(
      "SELECT pg_catalog.set_config('statement_timeout', $1, true), pg_catalog.set_config('lock_timeout', $1, true), pg_catalog.set_config('search_path', 'pg_catalog, public', true)",
      [String(config.timeoutMs)],
    );
    stage = 'execute the validated SELECT';
    stream = client.query(new QueryStream(config.query, config.params, { batchSize: config.batchSize }));
    let row = 0;
    for await (const record of stream as AsyncIterable<DataRow>) {
      row++;
      const values: DataRow = Object.create(null) as DataRow;
      for (const [field, mapping] of Object.entries(config.fields)) {
        const column = fieldPath(mapping);
        if (!Object.hasOwn(record, column))
          throw new SourceError(
            `SQL ${config.connectionEnv}, row ${row}: column ${column} for field ${field} is missing; correct SELECT aliases or fields.`,
          );
        values[field] = record[column];
      }
      yield values;
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z0-9_]+$/.test(error.code)
        ? ` (${error.code})`
        : '';
    throw new SourceError(
      `SQL ${config.connectionEnv}: failed to ${stage}${code}; check target availability, SELECT columns/permissions and timeoutMs. Credentials and server error text are not printed.`,
    );
  } finally {
    if (stream) {
      stream.destroy();
      await finished(stream).catch(() => {});
    }
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}
