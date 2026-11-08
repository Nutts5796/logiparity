import { parseCheckedJson } from '../../scripts/validate-report.mjs';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { chromium } from 'playwright';
import { testDatabase } from '../postgres.js';

const cli = resolve('node_modules/.bin/logiparity');
const demo = resolve('apps/demo-delivery/dist/main.js');
const temporary: string[] = [];
const children: ChildProcess[] = [];
const startupLogs = new Map<string, string>();
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    }),
  );
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function startDemo(flags: Record<string, string> = {}, args: string[] = []) {
  const child = spawn(process.execPath, [demo, ...args], {
    env: {
      ...process.env,
      DEMO_PORT: '0',
      BUG_EXPORT_DROPS_LAST_ROW: '0',
      BUG_ROUNDING_PAYOUT: '0',
      BUG_STATUS_STALE_UI: '0',
      BUG_TZ_SHIFT_EXPORT: '0',
      BUG_REPLAN_LOSES_ORDER: '0',
      BUG_DOUBLE_ASSIGN: '0',
      ...flags,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return await new Promise<string>((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error('Demo did not start within 10 seconds.')), 10000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Demo exited before startup: ${code}`));
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        startupLogs.set(match[0], output);
        resolveUrl(match[0]);
      }
    });
  });
}

async function runCli(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const [code] = (await once(child, 'exit')) as [number | null];
  return { code: code ?? 2, stdout, stderr };
}

async function directory() {
  const d = await mkdtemp(join(tmpdir(), 'logiparity-e2e-'));
  temporary.push(d);
  return d;
}
async function saveExport(url: string, dir: string, extension: string) {
  const response = await fetch(`${url}/exports/shipments.${extension}?date=2026-11-02`);
  expect(response.status).toBe(200);
  await writeFile(join(dir, `shipments.${extension}`), new Uint8Array(await response.arrayBuffer()));
}
async function writeConfig(
  dir: string,
  url: string,
  entityOptions: Record<string, unknown> = {},
  outputs = ['console', 'json'],
) {
  const fields = { id: 'Shipment ID', payout: 'Driver payout', status: 'Status', delivered_at: 'Delivered at' };
  await writeFile(
    join(dir, 'parity.yaml'),
    stringify({
      version: 1,
      entities: [
        {
          name: 'shipment',
          key: 'id',
          sources: {
            api: {
              type: 'rest',
              baseUrl: url,
              path: '/api/shipments',
              pagination: { type: 'page', size: 200, totalPath: '$.pagination.total' },
              items: '$.data[*]',
              fields: { id: '$.id', payout: '$.driver_payout', status: '$.status', delivered_at: '$.delivered_at' },
            },
            export: { type: 'xlsx', file: 'shipments.xlsx', sheet: 'Shipments', fields },
            csv: { type: 'csv', file: 'shipments.csv', fields },
          },
          compare: {
            payout: { type: 'money', currency: 'USD' },
            status: { type: 'enum' },
            delivered_at: { type: 'datetime' },
          },
          ...entityOptions,
        },
      ],
      report: { outputs, dir: './report' },
    }),
  );
}
interface JsonFinding {
  type: string;
  source: string;
  key: string;
  field: string;
  expected?: string | number;
  actual?: string | number;
  blocking?: boolean;
  screenshot?: string;
}
interface JsonReport {
  schemaVersion: number;
  findings: JsonFinding[];
  entities: { counts: Record<string, number> }[];
}
const id = (i: number) => `S${String(i).padStart(6, '0')}`;
// Frozen affected keys for the realistic synthetic payout fixture.
const roundingKeys = parseCheckedJson(
  await readFile(resolve('tests/fixtures/demo-rounding-keys.json'), 'utf8'),
) as string[];
const droppedKeys = [...Array.from({ length: 13 }, (_, i) => (i + 1) * 200), 2750].map(id);

describe.sequential('CLI against the actual demo executable', () => {
  it('enables all six implemented bugs with the demo:bugs startup flag', async () => {
    const url = await startDemo({}, ['--bugs']);
    const health = (await fetch(`${url}/health`).then((r) => r.json())) as { bugs: Record<string, boolean> };
    expect(health.bugs).toEqual({
      dropLastRow: true,
      roundingPayout: true,
      staleUi: true,
      timezoneShift: true,
      loseOrder: true,
      doubleAssign: true,
    });
    for (const name of [
      'missing export rows',
      'incorrect payout rounding',
      'stale dispatcher statuses',
      'shifted export datetimes',
      'orders lost during replanning',
      'duplicate assignments after replanning',
    ])
      expect(startupLogs.get(url)).toContain(name);
  });
  it.each([
    { name: 'bugs off', drop: false, rounding: false },
    { name: 'BUG_EXPORT_DROPS_LAST_ROW only', drop: true, rounding: false },
    { name: 'BUG_ROUNDING_PAYOUT only', drop: false, rounding: true },
    { name: 'both M1 bugs', drop: true, rounding: true },
  ])('$name: exact finding keys, values and exit code', async ({ drop, rounding }) => {
    const dir = await directory();
    const url = await startDemo({
      BUG_EXPORT_DROPS_LAST_ROW: drop ? '1' : '0',
      BUG_ROUNDING_PAYOUT: rounding ? '1' : '0',
    });
    await saveExport(url, dir, 'xlsx');
    await saveExport(url, dir, 'csv');
    await writeConfig(dir, url);
    const result = await runCli(['check', '--config', join(dir, 'parity.yaml')], tmpdir());
    expect(result.stderr).toBe('');
    expect(result.code).toBe(drop || rounding ? 1 : 0);
    const report = parseCheckedJson(await readFile(join(dir, 'report/report.json'), 'utf8')) as JsonReport;
    expect(report.schemaVersion).toBe(1);
    expect(report.entities[0]?.counts).toEqual({ api: 2750, export: drop ? 2736 : 2750, csv: 2750 });
    expect(report.findings.filter((f) => f.type === 'missing_in_source').map((f) => f.key)).toEqual(
      drop ? droppedKeys : [],
    );
    for (const source of ['csv', 'export']) {
      const findings = report.findings.filter((f) => f.type === 'field_mismatch' && f.source === source);
      expect(findings.map((f) => f.key)).toEqual(
        rounding ? roundingKeys.filter((key) => source === 'csv' || !drop || !droppedKeys.includes(key)) : [],
      );
      for (const f of findings) {
        expect(f.field).toBe('payout');
        expect(BigInt(f.expected ?? '') - BigInt(f.actual ?? '')).toBe(1n);
      }
      if (rounding) expect(findings).toHaveLength(34);
    }
    expect(report.findings.every((f) => ['missing_in_source', 'field_mismatch'].includes(f.type))).toBe(true);
    const again = await runCli(['check', '--config', join(dir, 'parity.yaml')], dir);
    expect(again.code).toBe(result.code);
    expect(again.stdout).toBe(result.stdout);
  });
  it('exposes synthetic domain lists, details, status filters and rejects unsupported requests', async () => {
    const url = await startDemo();
    const health = (await fetch(`${url}/health`).then((r) => r.json())) as {
      synthetic: boolean;
      bugs: Record<string, boolean>;
    };
    expect(health.synthetic).toBe(true);
    expect(health.bugs).toEqual({
      dropLastRow: false,
      roundingPayout: false,
      staleUi: false,
      timezoneShift: false,
      loseOrder: false,
      doubleAssign: false,
    });
    const drivers = (await fetch(`${url}/api/drivers?limit=100`).then((r) => r.json())) as { data: unknown[] };
    expect(drivers.data).toHaveLength(55);
    const shipment = (await fetch(`${url}/api/shipments/S000001`).then((r) => r.json())) as { data: { id: string } };
    expect(shipment.data.id).toBe('S000001');
    const filtered = (await fetch(`${url}/api/orders?status=delivered`).then((r) => r.json())) as {
      data: { status: string }[];
    };
    expect(filtered.data.every((s) => s.status === 'delivered')).toBe(true);
    for (const path of ['/api/vehicles', '/api/routes', '/api/payouts', '/api/notifications'])
      expect((await fetch(url + path)).status).toBe(200);
    expect((await fetch(`${url}/api/shipments?date=1900-01-01`)).status).toBe(400);
    expect((await fetch(`${url}/api/shipments?page=bad`)).status).toBe(400);
    expect((await fetch(`${url}/api/shipments/missing`)).status).toBe(404);
    expect((await fetch(`${url}/events`, { method: 'POST' })).status).toBe(405);
  });
  it('returns 2 for invalid YAML, missing files, source failures and unwritable reports; prints useful help', async () => {
    const dir = await directory();
    const help = await runCli(['--help'], dir);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('TEST AND STAGING');
    expect((await runCli([], dir)).code).toBe(2);
    expect((await runCli(['--unknown'], dir)).code).toBe(2);
    const missing = await runCli(['check', '--config', 'missing.yaml'], dir);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('cannot read');
    await writeFile(join(dir, 'bad.yaml'), 'version: [');
    expect((await runCli(['check', '--config', 'bad.yaml'], dir)).code).toBe(2);
    const url = await startDemo();
    await writeConfig(dir, url);
    const failedSource = await runCli(['check', '--config', 'parity.yaml'], dir);
    expect(failedSource.code).toBe(2);
    expect(failedSource.stdout).toContain('Source errors');
    await saveExport(url, dir, 'xlsx');
    await saveExport(url, dir, 'csv');
    await rm(join(dir, 'report'), { recursive: true });
    await writeFile(join(dir, 'report'), 'occupied');
    const failedReport = await runCli(['check', '--config', 'parity.yaml'], dir);
    expect(failedReport.code).toBe(2);
    expect(failedReport.stderr).toContain('report');
  });
  it('generates every M2 report with aggregate mismatches and schema-valid JUnit', async () => {
    const dir = await directory();
    const url = await startDemo({ BUG_EXPORT_DROPS_LAST_ROW: '1', BUG_ROUNDING_PAYOUT: '1' });
    await saveExport(url, dir, 'xlsx');
    await saveExport(url, dir, 'csv');
    await writeConfig(
      dir,
      url,
      {
        aggregates: [
          { name: 'delivered_count', type: 'count', where: { status: 'delivered' } },
          { name: 'payout_total', type: 'sum', field: 'payout' },
        ],
      },
      ['console', 'html', 'junit', 'json', 'markdown'],
    );
    expect((await runCli(['check', '--config', 'parity.yaml'], dir)).code).toBe(1);
    const report = parseCheckedJson(await readFile(join(dir, 'report/report.json'), 'utf8')) as JsonReport;
    const aggregates = report.findings.filter((f) => f.type === 'aggregate_mismatch');
    expect(aggregates.map((f) => [f.source, f.field])).toEqual([
      ['export', 'delivered_count'],
      ['csv', 'payout_total'],
      ['export', 'payout_total'],
    ]);
    expect(report.findings).toHaveLength(85);
    const html = await readFile(join(dir, 'report/report.html'), 'utf8');
    expect(html.includes('85 findings')).toBe(true);
    expect(html.includes('<h3>Totals</h3>')).toBe(true);
    expect(await readFile(join(dir, 'report/report.md'), 'utf8')).toContain('One example per cause');
    expect(html).toContain('title="$80,728.70"');
    expect(await readFile(join(dir, 'report/report.md'), 'utf8')).toContain('$80,728.70');
    expect(await readFile(join(dir, 'report/report.json'), 'utf8')).not.toContain('$80,728.70');
    await promisify(execFile)('xmllint', [
      '--nonet',
      '--noout',
      '--schema',
      resolve('tests/fixtures/junit/JUnit.xsd'),
      join(dir, 'report/junit.xml'),
    ]);
    const xml = await readFile(join(dir, 'report/junit.xml'), 'utf8');
    expect(xml).toContain('failures="3"');
    expect(xml.match(/<testcase /g)).toHaveLength(8);
  });
  it('applies CLI thresholds at the boundary, preserves observations and cannot suppress runtime errors', async () => {
    const dir = await directory();
    const url = await startDemo({ BUG_EXPORT_DROPS_LAST_ROW: '1', BUG_ROUNDING_PAYOUT: '1' });
    await saveExport(url, dir, 'xlsx');
    await saveExport(url, dir, 'csv');
    for (const [failOn, code] of [
      [{ missing: 14, mismatch: 68 }, 0],
      [{ missing: 13, mismatch: 68 }, 1],
      [[], 0],
    ] as const) {
      await writeConfig(dir, url, { failOn }, ['console', 'json', 'junit']);
      const result = await runCli(['check', '--config', 'parity.yaml'], dir);
      expect(result.code).toBe(code);
      const report = parseCheckedJson(await readFile(join(dir, 'report/report.json'), 'utf8')) as JsonReport;
      expect(report.findings).toHaveLength(82);
      expect(report.findings.filter((f) => f.blocking)).toHaveLength(code === 1 ? 14 : 0);
      if (code === 0) expect(await readFile(join(dir, 'report/junit.xml'), 'utf8')).toContain('skipped="2"');
    }
    await rm(join(dir, 'shipments.csv'));
    expect((await runCli(['check', '--config', 'parity.yaml'], dir)).code).toBe(2);
    await writeConfig(dir, url, { failOn: { mismatch: -1 } });
    const invalid = await runCli(['check', '--config', 'parity.yaml'], dir);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain('failOn');
  });
  it('init creates commented usable YAML, performs no reads, and never overwrites a file', async () => {
    const dir = await directory();
    const created = await runCli(['init'], dir, { STAGING_API_URL: '' });
    expect(created.code).toBe(0);
    const original = await readFile(join(dir, 'parity.yaml'), 'utf8');
    expect(original).toContain('# LogiParity starter');
    expect(original).toContain('${STAGING_API_URL}');
    const exists = await runCli(['init'], dir);
    expect(exists.code).toBe(2);
    expect(exists.stderr).toContain('already exists');
    expect(await readFile(join(dir, 'parity.yaml'), 'utf8')).toBe(original);
    expect((await runCli(['init', '--config', 'another.yaml'], dir)).code).toBe(0);
    expect((await runCli(['init', '--config', 'absent/another.yaml'], dir)).code).toBe(2);
    const url = await startDemo();
    await saveExport(url, dir, 'csv');
    const config = parse(original) as {
      entities: { key: string; sources: Record<string, { fields: Record<string, string> }> }[];
    };
    expect(config.entities[0]?.key).toBe('shipment_id');
    const result = await runCli(['check', '--config', 'parity.yaml'], dir, { STAGING_API_URL: url });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(await readFile(join(dir, 'logiparity-report/report.html'), 'utf8')).toContain(
      'All configured comparisons passed',
    );
  });
  it.each([
    { stale: false, timezone: false },
    { stale: true, timezone: false },
    { stale: false, timezone: true },
    { stale: true, timezone: true },
  ])('detects exact M3 bug keys: stale=$stale timezone=$timezone', async ({ stale, timezone }) => {
    const dir = await directory();
    const url = await startDemo({ BUG_STATUS_STALE_UI: stale ? '1' : '0', BUG_TZ_SHIFT_EXPORT: timezone ? '1' : '0' });
    await saveExport(url, dir, 'xlsx');
    await saveExport(url, dir, 'csv');
    await loginState(dir, url);
    await writeUiConfig(dir, url);
    const result = await runCli(['check', '--config', 'parity.yaml'], dir);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(stale || timezone ? 1 : 0);
    const report = parseCheckedJson(await readFile(join(dir, 'report/report.json'), 'utf8')) as JsonReport;
    expect(report.entities[0]?.counts).toEqual({ api: 2750, export: 2750, csv: 2750, ui: 2750 });
    const staleKeys = parseCheckedJson(
      await readFile(resolve('tests/fixtures/demo-stale-keys.json'), 'utf8'),
    ) as string[];
    expect(report.findings.filter((f) => f.source === 'ui' && f.field === 'status').map((f) => f.key)).toEqual(
      stale ? staleKeys : [],
    );
    const delivered = Array.from({ length: 2750 }, (_, i) => i + 1)
      .filter((n) => n % 3 !== 1)
      .map(id);
    for (const source of ['export', 'csv']) {
      const findings = report.findings.filter((f) => f.source === source && f.field === 'delivered_at');
      expect(findings.map((f) => f.key)).toEqual(timezone ? delivered : []);
      for (const f of findings) expect(Number(f.expected) - Number(f.actual)).toBe(6 * 3600000);
    }
    expect(report.findings.filter((f) => f.type === 'aggregate_mismatch')).toHaveLength(stale ? 1 : 0);
    expect(report.findings).toHaveLength((stale ? staleKeys.length + 1 : 0) + (timezone ? 3666 : 0));
  });
  it('links a real UI failure screenshot from the HTML report and exits 2', async () => {
    const dir = await directory();
    const url = await startDemo();
    await loginState(dir, url);
    await saveExport(url, dir, 'xlsx');
    await saveExport(url, dir, 'csv');
    await writeUiConfig(dir, url, { table: 'table#missing', timeoutMs: 500 });
    expect((await runCli(['check', '--config', 'parity.yaml'], dir)).code).toBe(2);
    const report = parseCheckedJson(await readFile(join(dir, 'report/report.json'), 'utf8')) as JsonReport;
    expect(report.findings).toHaveLength(1);
    const error = report.findings[0];
    expect(error?.type).toBe('source_error');
    expect(error?.screenshot).toMatch(/^screenshots\/ui-/);
    expect((await readFile(join(dir, 'report', error?.screenshot ?? ''))).subarray(1, 4).toString()).toBe('PNG');
    expect(await readFile(join(dir, 'report/report.html'), 'utf8')).toContain('View screenshot');
  });
  it('runs the SQL adapter through the CLI and refuses non-SELECT before connecting', async () => {
    const db = await testDatabase();
    try {
      const dir = await directory();
      const url = await startDemo();
      const response = (await fetch(url + '/api/shipments?limit=2').then((r) => r.json())) as {
        data: { id: string; driver_payout: string }[];
      };
      await db.client.query(`CREATE TABLE ${db.schema}.shipments(id text, payout numeric(30,2))`);
      for (const row of response.data)
        await db.client.query(`INSERT INTO ${db.schema}.shipments VALUES($1,$2)`, [row.id, row.driver_payout]);
      const config = {
        version: 1,
        entities: [
          {
            name: 'shipment',
            key: 'id',
            sources: {
              api: {
                type: 'rest',
                baseUrl: url,
                path: '/api/shipments?limit=2',
                fields: { id: '$.id', payout: '$.driver_payout' },
              },
              database: {
                type: 'sql',
                connectionEnv: 'CLI_TEST_DB',
                query: `SELECT id, payout FROM ${db.schema}.shipments ORDER BY id`,
                fields: { id: 'id', payout: 'payout' },
              },
            },
            compare: { payout: { type: 'money', currency: 'USD' } },
            aggregates: [{ name: 'payout_total', type: 'sum', field: 'payout' }],
          },
        ],
        report: { outputs: ['console', 'json', 'html'], dir: './report' },
      };
      await writeFile(join(dir, 'parity.yaml'), stringify(config));
      expect((await runCli(['check', '--config', 'parity.yaml'], dir, { CLI_TEST_DB: db.url })).code).toBe(0);
      expect(await readFile(join(dir, 'report/report.html'), 'utf8')).toContain('$43.67');
      config.entities[0]!.sources.database.query = `DELETE FROM ${db.schema}.shipments`;
      await writeFile(join(dir, 'parity.yaml'), stringify(config));
      expect((await runCli(['check', '--config', 'parity.yaml'], dir, { CLI_TEST_DB: '' })).code).toBe(2);
      expect((await db.client.query(`SELECT count(*) AS n FROM ${db.schema}.shipments`)).rows[0]?.n).toBe('2');
    } finally {
      await db.close();
    }
  });
});

async function loginState(dir: string, url: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const session = await browser.newContext();
    const page = await session.newPage();
    await page.goto(url + '/dispatcher');
    await page.getByLabel('Username', { exact: true }).fill('dispatcher');
    await page.getByLabel('Password', { exact: true }).fill('demo-password');
    await Promise.all([
      page.waitForURL('**/dispatcher*'),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await session.storageState({ path: join(dir, 'state.json') });
  } finally {
    await browser.close();
  }
}

async function writeUiConfig(dir: string, url: string, uiOptions: Record<string, unknown> = {}): Promise<void> {
  await writeConfig(
    dir,
    url,
    {
      aggregates: [
        { name: 'delivered_count', type: 'count', where: { status: 'delivered' } },
        { name: 'payout_total', type: 'sum', field: 'payout' },
      ],
    },
    ['console', 'json', 'html', 'markdown'],
  );
  const config = parse(await readFile(join(dir, 'parity.yaml'), 'utf8')) as {
    entities: { sources: Record<string, unknown>; compare: Record<string, unknown> }[];
  };
  const entity = config.entities[0]!;
  entity.sources.ui = {
    type: 'ui',
    url: url + '/dispatcher',
    storageState: './state.json',
    table: 'table#shipments',
    nextPage: 'button[aria-label="Next page"]',
    fields: {
      id: '[data-col=id]',
      status: '[data-col=status]',
      payout: '[data-col=payout]',
      delivered_at: 'td[data-col=delivered_at] .parity-time',
    },
    ...uiOptions,
  };
  entity.compare.payout = { type: 'money', currency: 'USD', allowCurrencySymbol: true };
  entity.compare.status = { type: 'enum', map: { Delivered: 'delivered', 'In transit': 'in_transit' } };
  entity.compare.delivered_at = {
    type: 'datetime',
    format: { ui: "h:mm a'\n'LLL d, yyyy" },
    sourceTimezones: { export: 'UTC', csv: 'UTC', ui: 'America/Chicago' },
  };
  await writeFile(join(dir, 'parity.yaml'), stringify(config));
}

describe.sequential('Operational scenario bug flags through the demo executable', () => {
  it.each([
    { flag: 'BUG_REPLAN_LOSES_ORDER', invariant: 'no_order_lost' },
    { flag: 'BUG_DOUBLE_ASSIGN', invariant: 'single_assignment' },
  ])('$flag names S000801 after a breakdown scenario', async ({ flag, invariant }) => {
    const dir = await directory();
    const url = await startDemo({ [flag]: '1' });
    const result = await runCli(
      [
        'scenario',
        'run',
        resolve('examples/demo/scenarios/02-vehicle-breakdown.yaml'),
        '--target',
        resolve('examples/demo/target.yaml'),
        '--report-dir',
        join(dir, 'scenario-report'),
      ],
      tmpdir(),
      { DEMO_API_URL: url },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    const report = parseCheckedJson(await readFile(join(dir, 'scenario-report/scenario.json'), 'utf8')) as {
      invariants: { name: string; passed: boolean; affectedKeys: string[] }[];
    };
    expect(report.invariants.find((i) => i.name === invariant)).toMatchObject({
      passed: false,
      affectedKeys: ['S000801'],
    });
  });
});
