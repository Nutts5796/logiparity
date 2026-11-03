import { parseCheckedJson } from '../../scripts/validate-report.mjs';
import { createServer, type Server, type RequestListener } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
const cli = resolve('packages/cli/dist/main.js');
const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function dir() {
  const value = await mkdtemp(join(tmpdir(), 'logiparity-regression-e2e-'));
  dirs.push(value);
  return value;
}
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  return `http://127.0.0.1:${address.port}`;
}
async function run(args: string[], cwd: string) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (value: Buffer) => {
    stdout += value.toString();
  });
  child.stderr.on('data', (value: Buffer) => {
    stderr += value.toString();
  });
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}
it.each([true, false])(
  'CLI handles a capped page with completion metadata=%s without blaming the other source',
  async (signal) => {
    const directory = await dir();
    const url = await serve((_, res) => res.end(JSON.stringify({ data: [{ id: 'S1' }], total: 3 })));
    await writeFile(join(directory, 'input.csv'), 'ID\nS1\nS2\nS3\n');
    await writeFile(
      join(directory, 'config.yaml'),
      JSON.stringify({
        version: 1,
        entities: [
          {
            name: 'shipment',
            key: 'id',
            sources: {
              api: {
                type: 'rest',
                baseUrl: url,
                path: '/',
                pagination: { type: 'page', size: 200, ...(signal ? { totalPath: '$.total' } : {}) },
                fields: { id: '$.id' },
              },
              csv: { type: 'csv', file: 'input.csv', fields: { id: 'ID' } },
            },
          },
        ],
        report: { outputs: ['console', 'json'], dir: './report' },
      }),
    );
    const result = await run(['check', '--config', 'config.yaml'], directory);
    expect(result.code).toBe(2);
    const report = parseCheckedJson(await readFile(join(directory, 'report/report.json'), 'utf8')) as {
      findings: { type: string; message: string }[];
    };
    if (signal) {
      expect(report.findings.map((f) => f.type)).toEqual(['source_error']);
      expect(result.stdout).toContain('requested size 200, received 1');
    } else {
      expect(result.stdout).toContain('totalPath, totalPagesPath or hasMorePath');
      expect(report.findings.map((f) => f.type)).toEqual(['source_error']);
    }
  },
);
it.each(['healthy', 'lost', 'double', 'missing dependency', 'eta'] as const)(
  'runs selected invariants with only their required sources: %s',
  async (mode) => {
    const directory = await dir();
    let injected = false;
    let events = 0;
    let irrelevant = 0;
    const url = await serve((req, res) => {
      if (req.method === 'POST') {
        events++;
        injected = true;
        res.end('{}');
        return;
      }
      if (req.url === '/unneeded') {
        irrelevant++;
        res.statusCode = 500;
        res.end('{}');
        return;
      }
      const orders =
        mode === 'lost' && injected
          ? []
          : [{ id: 'S1', status: 'in_transit', eta: injected ? '2026-11-02T11:00:00Z' : '2026-11-02T10:00:00Z' }];
      const assignments = [
        { id: 'A1', order_id: 'S1', driver_id: injected ? 'D2' : 'D1' },
        ...(mode === 'double' && injected ? [{ id: 'A2', order_id: 'S1', driver_id: 'D3' }] : []),
      ];
      res.end(
        JSON.stringify({
          data: req.url === '/orders' ? orders : req.url === '/assignments' ? assignments : [{ ready: injected }],
        }),
      );
    });
    const source = (path: string, fields: Record<string, string>) => ({ type: 'rest', baseUrl: url, path, fields });
    const state = {
      orders: source('/orders', { id: '$.id', status: '$.status', eta: '$.eta' }),
      assignments: source('/assignments', { id: '$.id', order_id: '$.order_id', driver_id: '$.driver_id' }),
      control: source('/control', { ready: '$.ready' }),
      unused: source('/unneeded', { id: '$.id' }),
    };
    await writeFile(
      join(directory, 'target.yaml'),
      JSON.stringify({
        version: 1,
        name: 'staging',
        environment: 'staging',
        allowMutations: true,
        allowedHosts: ['127.0.0.1', 'localhost', 'example.test', 'example.invalid', 'staging.example.test'],
        baseUrl: url,
        events: { driver_no_show: { method: 'POST', path: '/event', body: '{{params}}' } },
        state,
      }),
    );
    await writeFile(
      join(directory, 'scenario.yaml'),
      JSON.stringify({
        version: 1,
        name: 'Driver absence',
        target: 'staging',
        events: [{ step: 1, type: 'driver_no_show', params: { driver: 'D1' } }],
        wait: { source: 'control', until: { ready: true }, timeoutSeconds: 1, pollSeconds: 0.01 },
        invariants:
          mode === 'missing dependency'
            ? ['capacity_respected']
            : mode === 'eta'
              ? ['eta_updated_for_affected']
              : ['no_order_lost', 'single_assignment'],
      }),
    );
    const result = await run(
      ['scenario', 'run', 'scenario.yaml', '--target', 'target.yaml', '--report-dir', 'report'],
      directory,
    );
    expect(result.code, result.stdout + result.stderr).toBe(
      mode === 'missing dependency' ? 2 : mode === 'healthy' || mode === 'eta' ? 0 : 1,
    );
    expect(irrelevant).toBe(0);
    if (mode === 'missing dependency') {
      expect(events).toBe(0);
      expect(result.stderr).toContain('state.');
    } else {
      expect(events).toBe(1);
      if (mode === 'lost' || mode === 'double') expect(result.stdout).toContain('S1');
    }
  },
);
it.each([
  { allow: false, payout: 12.34, expected: 1 },
  { allow: true, payout: 12.345, expected: 1 },
  { allow: true, payout: 12.34, expected: 0 },
])('numeric HTTP money: allow=$allow payout=$payout', async ({ allow, payout, expected }) => {
  const directory = await dir();
  const url = await serve((_, res) => res.end(JSON.stringify({ data: [{ id: 'S1', payout }] })));
  await writeFile(join(directory, 'input.csv'), 'ID,Payout\nS1,12.34\n');
  await writeFile(
    join(directory, 'parity.yaml'),
    JSON.stringify({
      version: 1,
      entities: [
        {
          name: 'shipment',
          key: 'id',
          sources: {
            api: { type: 'rest', baseUrl: url, path: '/', fields: { id: '$.id', payout: '$.payout' } },
            csv: { type: 'csv', file: 'input.csv', fields: { id: 'ID', payout: 'Payout' } },
          },
          compare: { payout: { type: 'money', currency: 'USD', allowNumber: allow } },
        },
      ],
      report: { outputs: ['console', 'json'], dir: './report' },
    }),
  );
  const result = await run(['check', '--config', 'parity.yaml'], directory);
  expect(result.code, result.stdout + result.stderr).toBe(expected);
  const report = parseCheckedJson(await readFile(join(directory, 'report/report.json'), 'utf8')) as {
    findings: { type: string }[];
  };
  expect(report.findings.map((f) => f.type)).toEqual(expected === 0 ? [] : ['invalid_value']);
});
it('renders real HTTP groups in every report without losing findings or normalized values', async () => {
  const directory = await dir();
  const url = await serve((_, res) =>
    res.end(
      JSON.stringify({
        data: [
          { id: 'S1', payout: 12.34, at: '2026-11-02T13:01:00Z', status: 'delivered' },
          { id: 'S2', payout: 12.35, at: '2026-11-02T13:02:00Z', status: 'delivered' },
          { id: 'S3', payout: 12.36, at: '2026-11-02T13:03:00Z', status: 'delivered' },
        ],
      }),
    ),
  );
  await writeFile(
    join(directory, 'input.csv'),
    'ID,Payout,At,Status\nS1,12.33,2026-11-02T07:01:00Z,in_transit\nS2,12.34,2026-11-02T07:02:00Z,in_transit\nS3,12.35,2026-11-02T07:03:00Z,in_transit\n',
  );
  await writeFile(
    join(directory, 'parity.yaml'),
    JSON.stringify({
      version: 1,
      entities: [
        {
          name: 'shipment',
          key: 'id',
          sources: {
            api: {
              type: 'rest',
              baseUrl: url,
              path: '/',
              fields: { id: '$.id', payout: '$.payout', at: '$.at', status: '$.status' },
            },
            csv: { type: 'csv', file: 'input.csv', fields: { id: 'ID', payout: 'Payout', at: 'At', status: 'Status' } },
          },
          compare: {
            payout: { type: 'money', currency: 'USD', allowNumber: true },
            at: { type: 'datetime' },
            status: { type: 'enum' },
          },
        },
      ],
      report: { outputs: ['console', 'html', 'markdown', 'json', 'junit'], dir: './report' },
    }),
  );
  const result = await run(['check', '--config', 'parity.yaml'], directory);
  expect(result.code).toBe(1);
  expect(result.stdout).toContain('Nov 2, 2026, 1:01 PM UTC');
  expect(result.stdout).toContain('−6 h');
  const report = parseCheckedJson(await readFile(join(directory, 'report/report.json'), 'utf8')) as {
    schemaVersion: number;
    groups: { kind: string }[];
    findings: { expected: string | number; field: string }[];
  };
  expect(report.schemaVersion).toBe(1);
  expect(report.groups.map((g) => g.kind)).toEqual(['datetime_offset', 'money_delta', 'value_mapping']);
  expect(report.findings).toHaveLength(9);
  expect(report.findings.find((f) => f.field === 'payout')?.expected).toBe('1234');
  for (const file of ['report.md']) {
    const text = await readFile(join(directory, 'report', file), 'utf8');
    expect(text).toContain('Repeated datetime offset');
    expect(text).toContain('Likely a different rounding rule');
  }
  const html = await readFile(join(directory, 'report/report.html'), 'utf8');
  expect(html.includes('class="card donut"')).toBe(true);
  expect(html.includes('9 findings')).toBe(true);
});
