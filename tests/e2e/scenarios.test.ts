import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { createDemoServer, type DemoBugs } from '../../apps/demo-delivery/src/server.js';
import type { ScenarioReport } from '../../packages/scenarios/src/report.js';
const cli = resolve('packages/cli/dist/main.js');
const example = resolve('examples/demo');
const directories: string[] = []; const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup(bugs: Partial<DemoBugs> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-scenario-')); directories.push(directory);
  const { server } = createDemoServer({ bugs }); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing demo address');
  return { directory, url: `http://127.0.0.1:${address.port}` };
}
async function run(scenario: string, target: string, directory: string, url: string, allowModules = false) {
  const child = spawn(process.execPath, [cli, 'scenario', 'run', scenario, '--target', target, '--report-dir', join(directory, 'report'), ...(allowModules ? ['--allow-modules'] : [])], { cwd: tmpdir(), env: { ...process.env, DEMO_API_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (v: Buffer) => { stdout += v.toString(); }); child.stderr.on('data', (v: Buffer) => { stderr += v.toString(); });
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}
async function readReport(directory: string) { return JSON.parse(await readFile(join(directory, 'report/scenario.json'), 'utf8')) as ScenarioReport; }
async function variant(directory: string, edit: (scenario: Record<string, unknown>, target: Record<string, unknown>) => void) {
  const scenario = parse(await readFile(join(example, 'scenarios/02-vehicle-breakdown.yaml'), 'utf8')) as Record<string, unknown>;
  const target = parse(await readFile(join(example, 'target.yaml'), 'utf8')) as Record<string, unknown>;
  scenario.setup = { fixture: join(example, 'fixtures/day-55-drivers.json') }; scenario.afterwards = { parity: join(example, 'parity-scenario.yaml') };
  edit(scenario, target);
  const scenarioFile = join(directory, 'scenario.yaml'); const targetFile = join(directory, 'target.yaml');
  await writeFile(scenarioFile, stringify(scenario)); await writeFile(targetFile, stringify(target)); return { scenarioFile, targetFile };
}
it.each(['01-driver-no-show', '02-vehicle-breakdown', '03-traffic-delay', '04-mass-cancellation', '05-capacity-reduction'])('%s passes all six invariants and fresh API/CSV/XLSX parity', async (file) => {
  const { directory, url } = await setup();
  const result = await run(join(example, `scenarios/${file}.yaml`), join(example, 'target.yaml'), directory, url);
  expect(result.stderr).toBe(''); expect(result.code, result.stdout).toBe(0);
  const report = await readReport(directory); expect(report.invariants).toHaveLength(6); expect(report.invariants.every((i) => i.passed)).toBe(true); expect(report.parity?.findings).toEqual([]); expect(report.parity?.entities[0]?.counts).toEqual({ api: 2750, export: 2750, csv: 2750 });
  const state = await fetch(`${url}/api/state`).then((r) => r.json()) as { data: { clock: string; replan_status: string }[] };
  expect(state.data[0]?.clock).toMatch(/:02\.000Z$/); expect(state.data[0]?.replan_status).toBe('completed');
  expect(await readFile(join(directory, 'report/scenario.html'), 'utf8')).toContain('parity/report.html');
  await promisify(execFile)('/usr/bin/xmllint', ['--noout', '--nonet', '--schema', resolve('tests/fixtures/junit/JUnit.xsd'), join(directory, 'report/junit.xml')]);
});
it.each([
  { name: 'lost order', bugs: { loseOrder: true }, check: 'no_order_lost' },
  { name: 'double assignment', bugs: { doubleAssign: true }, check: 'single_assignment' },
])('detects $name with the exact affected order; parity still runs', async ({ bugs, check }) => {
  const { directory, url } = await setup(bugs);
  const result = await run(join(example, 'scenarios/02-vehicle-breakdown.yaml'), join(example, 'target.yaml'), directory, url);
  expect(result.code).toBe(1); const report = await readReport(directory);
  expect(report.invariants.find((i) => i.name === check)).toMatchObject({ passed: false, affectedKeys: ['S000801'] });
  expect(report.parity?.findings).toEqual([]); // A consistent export cannot prove the domain invariant.
  expect(result.stdout).toContain('S000801');
  expect(await readFile(join(directory, 'report/scenario.md'), 'utf8')).toContain('S000801');
});
it('reports all six bugs, displays UTC beside epoch milliseconds, and preserves numeric JSON', async () => {
  const { directory, url } = await setup({ loseOrder: true, doubleAssign: true, dropLastRow: true, roundingPayout: true, timezoneShift: true, staleUi: true });
  const result = await run(join(example, 'scenarios/02-vehicle-breakdown.yaml'), join(example, 'target.yaml'), directory, url);
  expect(result.code).toBe(1); const report = await readReport(directory);
  expect(report.invariants.find((i) => i.name === 'no_order_lost')?.affectedKeys).toEqual(['S000801']);
  expect(report.invariants.find((i) => i.name === 'single_assignment')?.affectedKeys).toEqual(['S000802']);
  const finding = report.parity?.findings.find((f) => f.field === 'eta' && typeof f.expected === 'number'); expect(finding).toBeDefined();
  expect(typeof finding?.actual).toBe('number');
  const epoch = finding!.expected as number; const iso = new Date(epoch).toISOString().replace('.000Z', 'Z');
  for (const file of ['report.html', 'report.md']) { const text = await readFile(join(directory, 'report/parity', file), 'utf8'); expect(text.replaceAll('\\(', '(').replaceAll('\\)', ')')).toContain(`${epoch} (${iso})`); expect(text).toContain('$'); }
  const raw = await readFile(join(directory, 'report/parity/report.json'), 'utf8'); expect(raw).not.toContain(iso);
});
it('runs sorted steps, configured custom HTTP, JSONPath and TypeScript invariants', async () => {
  const { directory, url } = await setup();
  await writeFile(join(directory, 'check.ts'), `export default (state: { after: { orders: unknown[] } }) => ({ name: 'ignored', passed: state.after.orders.length === 2750, affectedKeys: [], explanation: 'All synthetic records retained' });`);
  const { scenarioFile, targetFile } = await variant(directory, (s) => {
    s.events = [{ step: 2, type: 'http', params: { path: '/api/events/traffic-delay', body: { zone: 'Z2', minutes: 15, at: '14:00' } } }, { step: 1, type: 'driver_no_show', params: { driver: 'D03', at: '08:00' } }];
    (s.invariants as unknown[]).push({ name: 'completed', jsonPath: '$.after.meta[0].replan_status', expected: 'completed' }, { name: 'typed record count', module: './check.ts' });
  });
  const result = await run(scenarioFile, targetFile, directory, url, true); expect(result.code, result.stdout + result.stderr).toBe(0);
  expect((await readReport(directory)).events.map((e) => e.step)).toEqual([1, 2]);
});
it.each(['consent', 'foreign request', 'bad module', 'missing fixture', 'duplicate step'])('preflights %s without resetting or injecting events', async (kind) => {
  const { directory, url } = await setup();
  const { scenarioFile, targetFile } = await variant(directory, (s, t) => {
    if (kind === 'consent') t.allowMutations = false;
    if (kind === 'foreign request') t.replan = { method: 'POST', path: 'https://unconfigured.invalid/replan' };
    if (kind === 'bad module') s.invariants = [{ name: 'missing module', module: './missing.ts' }];
    if (kind === 'missing fixture') s.setup = { fixture: './missing.json' };
    if (kind === 'duplicate step') s.events = [s.events && (s.events as unknown[])[0], (s.events as unknown[])[0]];
  });
  expect((await run(scenarioFile, targetFile, directory, url)).code).toBe(2);
  const state = await fetch(`${url}/api/state`).then((r) => r.json()) as { data: { clock: string; replan_status: string }[] };
  expect(state.data[0]).toMatchObject({ clock: '2026-11-02T14:00:00Z', replan_status: 'idle' });
});
it('returns 2 on virtual timeout and writes a runtime error report without parity', async () => {
  const { directory, url } = await setup();
  const { scenarioFile, targetFile } = await variant(directory, (s, t) => { delete t.replan; s.wait = { until: { replan_status: 'completed' }, timeoutSeconds: 3, pollSeconds: 2 }; });
  const result = await run(scenarioFile, targetFile, directory, url); expect(result.code).toBe(2);
  const report = await readReport(directory); expect(report.error).toContain('Timed out'); expect(report.parity).toBeUndefined(); expect(report.events[0]?.completed).toBe(true);
});
it('returns 2 for event HTTP failures and enforces the test mutation header', async () => {
  const { directory, url } = await setup();
  expect((await fetch(`${url}/api/test/reset`, { method: 'POST', body: '{}' })).status).toBe(400);
  const { scenarioFile, targetFile } = await variant(directory, (_, t) => { (t.events as Record<string, unknown>).vehicle_breakdown = { method: 'POST', path: '/api/events/not-supported', body: '{{params}}' }; });
  expect((await run(scenarioFile, targetFile, directory, url)).code).toBe(2);
  expect((await readReport(directory)).error).toContain('HTTP 400');
});
it('returns 2 for a post-scenario source error even when domain invariants pass', async () => {
  const { directory, url } = await setup();
  const parity = parse(await readFile(join(example, 'parity-scenario.yaml'), 'utf8')) as { entities: { sources: Record<string, { file?: string }> }[] };
  parity.entities[0]!.sources.export!.file = './missing.xlsx';
  await writeFile(join(directory, 'parity.yaml'), stringify(parity));
  const { scenarioFile, targetFile } = await variant(directory, (s) => { s.afterwards = { parity: './parity.yaml' }; });
  expect((await run(scenarioFile, targetFile, directory, url)).code).toBe(2);
  const report = await readReport(directory); expect(report.invariants.every((i) => i.passed)).toBe(true); expect(report.parity?.findings.some((f) => f.type === 'source_error')).toBe(true);
});
it('bounds real-clock polling when the target has no virtual-clock mapping', async () => {
  const { directory, url } = await setup();
  const { scenarioFile, targetFile } = await variant(directory, (s, t) => { delete t.clock; s.wait = { until: { replan_status: 'completed' }, timeoutSeconds: 0.05, pollSeconds: 0.01 }; });
  expect((await run(scenarioFile, targetFile, directory, url)).code).toBe(2);
  expect((await readReport(directory)).error).toContain('Timed out');
});
it.each(['failure', 'invalid result'])('handles custom invariant %s with the correct exit code', async (kind) => {
  const { directory, url } = await setup();
  await writeFile(join(directory, 'custom.ts'), kind === 'failure' ? `export default () => ({name:'custom',passed:false,affectedKeys:['S000801'],explanation:'Intentional custom failure'})` : 'export default () => ({passed:true})');
  const { scenarioFile, targetFile } = await variant(directory, (s) => { (s.invariants as unknown[]).push({ name: 'custom', module: './custom.ts' }); });
  expect((await run(scenarioFile, targetFile, directory, url, true)).code).toBe(kind === 'failure' ? 1 : 2);
  const report = await readReport(directory); expect(report.invariants.filter((i) => i.name !== 'custom').every((i) => i.passed)).toBe(true);
  if (kind === 'failure') expect(report.parity?.findings).toEqual([]); else expect(report.error).toBeDefined();
});
