import { checkedReport } from '../../scripts/validate-report.mjs';
import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runScenario } from '@logiparity/scenarios';
import { configSchema } from '@logiparity/core';
import { validateConfig } from '@logiparity/adapters';
import { sqlConnectionUrl } from '../../packages/adapters/src/sql-guard.js';
import { startServer } from '../helpers.js';
it('validates SQL URL overrides and the PGPORT actually used by the client before connecting (sam)', () => {
  const url = sqlConnectionUrl('postgres://qa:pw@127.0.0.1/db', { PGPORT: '3092', PGHOST: 'other.test' });
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.port).toBe('3092');
  const sql = { type: 'sql', connectionEnv: 'DB_URL', query: 'SELECT id FROM orders', fields: { id: 'id' } };
  const source = { type: 'csv', file: 'unused', fields: { id: 'id' } };
  const config = configSchema.parse({
    version: 1,
    allowedHosts: ['127.0.0.1:80'],
    entities: [{ name: 'order', key: 'id', sources: { a: source, sql } }],
  });
  expect(() => validateConfig(config, { DB_URL: 'postgres://qa:pw@127.0.0.1/db', PGPORT: '3092' })).toThrow(
    /3092.*allowedHosts/,
  );
  expect(() => validateConfig(config, { DB_URL: 'postgres://qa:pw@127.0.0.1/db?host=allowed.test' })).toThrow(
    /cannot override host/,
  );
});
it.each(['symlink', 'oversize'] as const)(
  'protects a scenario artifact from %s and reports the reason (sam)',
  async (mode) => {
    const dir = await mkdtemp(join(tmpdir(), 'logiparity-m102-artifact-'));
    const server = await startServer((req, res) => {
      if (req.url === '/orders') res.end(JSON.stringify({ data: [{ id: 'O1', status: 'in_transit' }] }));
      else if (req.url === '/file') res.end('id\n' + 'O1\n'.repeat(1000));
      else res.end('{}');
    });
    try {
      const reportDir = join(dir, 'report'),
        artifactDir = join(reportDir, 'artifacts');
      await mkdir(artifactDir, { recursive: true });
      const victim = join(dir, 'victim.csv');
      await writeFile(victim, 'keep this');
      if (mode === 'symlink') await symlink(victim, join(artifactDir, 'input.csv'));
      const source = { type: 'csv', file: '${LOGIPARITY_SCENARIO_ARTIFACT_DIR}/input.csv', fields: { id: 'id' } };
      await writeFile(
        join(dir, 'parity.yaml'),
        JSON.stringify({ version: 1, entities: [{ name: 'order', key: 'id', sources: { a: source, b: source } }] }),
      );
      await writeFile(
        join(dir, 'scenario.yaml'),
        JSON.stringify({
          version: 1,
          name: 'Artifact check',
          target: 'demo',
          events: [{ step: 1, type: 'http' }],
          invariants: ['no_order_lost'],
          afterwards: { parity: 'parity.yaml' },
        }),
      );
      await writeFile(
        join(dir, 'target.yaml'),
        JSON.stringify({
          version: 1,
          name: 'demo',
          environment: 'test',
          allowMutations: true,
          allowedHosts: ['127.0.0.1'],
          baseUrl: server.url,
          events: { http: { method: 'POST', path: '/event' } },
          state: {
            orders: { type: 'rest', baseUrl: server.url, path: '/orders', fields: { id: '$.id', status: '$.status' } },
          },
          artifacts: [{ path: '/file', file: 'input.csv', ...(mode === 'oversize' ? { maxBytes: 1024 } : {}) }],
        }),
      );
      const report = await checkedReport(
        runScenario(join(dir, 'scenario.yaml'), join(dir, 'target.yaml'), reportDir, {}),
      );
      expect(report.exitCode).toBe(2);
      expect(report.error).toMatch(mode === 'symlink' ? /symlink/ : /maxBytes/);
      expect(await readFile(victim, 'utf8')).toBe('keep this');
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
