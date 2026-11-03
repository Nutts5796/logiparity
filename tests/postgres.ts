import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { startServer } from './helpers.js';

const exec = promisify(execFile);
async function binary(name: string): Promise<string> {
  for (const directory of [
    process.env.LOGIPARITY_PG_BIN,
    ...(process.env.PATH ?? '').split(':'),
    '/opt/homebrew/opt/postgresql@14/bin',
  ].filter((s): s is string => Boolean(s))) {
    const file = join(directory, name);
    try {
      await access(file, constants.X_OK);
      return file;
    } catch {
      /* Try the next explicit PATH entry. */
    }
  }
  throw new Error(
    'PostgreSQL tests require initdb/pg_ctl on PATH (or LOGIPARITY_PG_BIN), or LOGIPARITY_TEST_DATABASE_URL pointing to a disposable loopback database named logiparity_test.',
  );
}

export async function testDatabase() {
  let url = process.env.LOGIPARITY_TEST_DATABASE_URL;
  let temporary: string | undefined;
  let ctl: string | undefined;
  let running = false;
  let fixtureClient: pg.Client | undefined;
  const stop = async () => {
    if (temporary && ctl && running) {
      await exec(ctl, ['-D', join(temporary, 'data'), '-m', 'fast', '-w', 'stop'], { timeout: 15000 });
      running = false;
    }
    if (temporary) await rm(temporary, { recursive: true, force: true });
  };
  try {
    if (!url) {
      const init = await binary('initdb');
      ctl = await binary('pg_ctl');
      temporary = await mkdtemp(join(tmpdir(), 'logiparity-pg-'));
      await exec(
        init,
        [
          '-D',
          join(temporary, 'data'),
          '--auth=trust',
          '--username=logiparity_test',
          '--no-locale',
          '--encoding=UTF8',
          '--no-sync',
        ],
        { timeout: 30000 },
      );
      const portProbe = await startServer((_, response) => response.end());
      const port = new URL(portProbe.url).port;
      await portProbe.close();
      const sockets = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
      await exec(
        ctl,
        [
          '-D',
          join(temporary, 'data'),
          '-o',
          `-F -h 127.0.0.1 -p ${port} -k ${sockets}`,
          '-l',
          join(temporary, 'postgres.log'),
          '-w',
          'start',
        ],
        { timeout: 15000 },
      );
      running = true;
      const admin = new pg.Client({ connectionString: `postgres://logiparity_test@127.0.0.1:${port}/postgres` });
      try {
        await admin.connect();
        await admin.query('CREATE DATABASE logiparity_test');
      } finally {
        await admin.end();
      }
      url = `postgres://logiparity_test@127.0.0.1:${port}/logiparity_test`;
    }
    const target = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.pathname !== '/logiparity_test')
      throw new Error('Refusing test fixture writes: use only a disposable loopback database named logiparity_test.');
    const client = new pg.Client({ connectionString: url });
    fixtureClient = client;
    await client.connect();
    const schema = 'lp_' + randomBytes(8).toString('hex');
    await client.query(`CREATE SCHEMA ${schema}`);
    return {
      url,
      client,
      schema,
      close: async () => {
        try {
          await client.query(`DROP SCHEMA ${schema} CASCADE`);
        } finally {
          await client.end();
          await stop();
        }
      },
    };
  } catch (error) {
    await fixtureClient?.end().catch(() => {});
    await stop();
    throw error;
  }
}
