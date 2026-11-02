import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createDemoServer } from '../../apps/demo-delivery/src/server.js';

const cli = resolve('packages/cli/dist/main.js');
const directories: string[] = []; const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); } await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const scenario = `version: 1\nname: Draft breakdown\ntarget: demo\nevents:\n  - {step: 1, type: vehicle_breakdown, params: {driver: D17}}\nwait: {until: {replan_status: completed}, timeoutSeconds: 60, pollSeconds: 2}\ninvariants: [no_order_lost, single_assignment]\n`;
const parity = `version: 1\nenvironment: test\nentities:\n  - name: shipment\n    key: id\n    sources:\n      api:\n        type: rest\n        baseUrl: \${STAGING_API_URL}\n        path: /api/shipments\n        fields: {id: $.id, payout: $.payout}\n      csv:\n        type: csv\n        file: ./shipments.csv\n        fields: {id: ID, payout: Payout}\n    compare: {payout: {type: money, currency: USD}}\n`;
const exampleReport = { schemaVersion: 1, entities: [{ entity: 'shipment', reference: 'api', counts: { api: 1, csv: 1 } }], findings: [{ type: 'field_mismatch', entity: 'shipment', source: 'csv', key: 'S000801', field: 'customer_email', expected: 'alice@example.test', actual: 'bob@example.test', message: 'alice@example.test differs from bob@example.test' }] };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-ai-e2e-')); directories.push(directory);
  await writeFile(join(directory, 'openapi.yaml'), 'openapi: 3.1.0\ninfo: {title: Synthetic shipments, version: "1"}\npaths:\n  /api/shipments:\n    get:\n      summary: synthetic list\n      responses: {"200": {description: shipment list}}\ncomponents: {schemas: {Shipment: {type: object, properties: {id: {type: string}, payout: {type: string}}}}}\nx-ref: {$ref: "https://unconfigured.invalid/never-fetch"}\n');
  await writeFile(join(directory, 'report.json'), JSON.stringify(exampleReport));
  return directory;
}
type Request = { path: string; body: string; authorization?: string | undefined };
async function mock(answer = scenario, status = 200, redirect = false) {
  const requests: Request[] = []; const order: string[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      let body = ''; for await (const part of req) body += String(part);
      requests.push({ path: req.url ?? '', body, authorization: req.headers.authorization }); order.push('request');
      if (redirect) { res.writeHead(302, { location: '/not-configured' }); res.end(); return; }
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(status === 200 ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: answer } }] } : { error: 'fixture-provider-key private response details' }));
    })();
  });
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No mock address');
  return { requests, order, url: `http://127.0.0.1:${address.port}/custom/v1` };
}
async function run(args: string[], cwd: string, url?: string, options: { env?: NodeJS.ProcessEnv; order?: string[] } = {}) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, LOGIPARITY_AI_BASE_URL: url, LOGIPARITY_AI_MODEL: url ? 'fixture-model' : undefined, LOGIPARITY_AI_API_KEY: url ? 'fixture-provider-key' : undefined, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let preview = false;
  child.stdout.on('data', (part: Buffer) => { stdout += part.toString(); if (!preview && stdout.includes('AI request preview')) { preview = true; options.order?.push('preview'); } }); child.stderr.on('data', (part: Buffer) => { stderr += part.toString(); });
  const [code] = await once(child, 'exit'); return { code, stdout, stderr };
}
it.each([
  ['suggest-config', '--openapi', 'openapi.yaml', '--entity', 'shipment'],
  ['scenario', '--from', 'Two vans broke down during the afternoon peak'],
  ['explain', 'report.json'],
])('ai %s previews without provider config or output files', async (...args) => {
  const dir = await fixture(); const before = await readdir(dir); const result = await run(['ai', ...args], dir);
  expect(result.code, result.stderr).toBe(0); expect(result.stdout).toContain('local only; nothing sent'); expect(result.stdout).toContain('"messages"'); expect(await readdir(dir)).toEqual(before);
});
it('stays offline when configured unless --send is explicitly passed, including normal commands', async () => {
  const dir = await fixture(); const provider = await mock();
  expect((await run(['ai', 'scenario', '--from', 'Breakdown D17'], dir, provider.url)).code).toBe(0);
  expect((await run(['--help'], dir, provider.url)).code).toBe(0);
  expect((await run(['init', '--config', 'starter.yaml'], dir, provider.url)).code).toBe(0);
  await writeFile(join(dir, 'a.csv'), 'ID,Status\nS1,delivered\n'); await writeFile(join(dir, 'b.csv'), 'ID,Status\nS1,delivered\n');
  await writeFile(join(dir, 'check.yaml'), 'version: 1\nentities:\n  - name: shipment\n    key: id\n    sources:\n      a: {type: csv, file: a.csv, fields: {id: ID, status: Status}}\n      b: {type: csv, file: b.csv, fields: {id: ID, status: Status}}\nreport: {outputs: [json], dir: ./parity-report}\n');
  expect((await run(['check', '--config', 'check.yaml'], dir, provider.url)).code).toBe(0); expect(provider.requests).toEqual([]);
});
it.each(['LOGIPARITY_AI_BASE_URL', 'LOGIPARITY_AI_MODEL', 'LOGIPARITY_AI_API_KEY'])('sends nothing if %s is missing', async (name) => {
  const dir = await fixture(); const provider = await mock();
  const result = await run(['ai', 'scenario', '--from', 'Breakdown', '--send'], dir, provider.url, { env: { [name]: undefined } });
  expect(result.code).toBe(2); expect(result.stderr).toContain(name); expect(provider.requests).toEqual([]); expect((await readdir(dir)).sort()).toEqual(['openapi.yaml', 'report.json']);
});
it.each([
  { command: ['suggest-config', '--openapi', 'openapi.yaml', '--entity', 'shipment'], answer: parity, output: 'draft-config.yaml' },
  { command: ['scenario', '--from', 'Breakdown D17'], answer: scenario, output: 'draft-scenario.yaml' },
  { command: ['explain', 'report.json'], answer: '# Findings\nObserved one customer email mismatch. This does not establish its cause.', output: 'explanation.md' },
])('ai $command creates a marked, private draft after preview and exactly one provider call', async ({ command, answer, output }) => {
  const dir = await fixture(); const provider = await mock(answer);
  const result = await run(['ai', ...command, '--send', '--output', output, '--redact-fields', 'customer_email'], dir, provider.url, { order: provider.order });
  expect(result.code, result.stdout + result.stderr).toBe(0); expect(provider.order).toEqual(['preview', 'request']); expect(provider.requests).toHaveLength(1);
  expect(provider.requests[0]?.path).toBe('/custom/v1/chat/completions'); expect(provider.requests[0]?.authorization).toBe('Bearer fixture-provider-key');
  expect(provider.requests[0]?.body).not.toContain('fixture-provider-key'); expect(result.stdout).not.toContain('fixture-provider-key');
  const content = await readFile(join(dir, output), 'utf8'); expect(content).toMatch(/^# AI-generated draft: review before use\n/); expect((await stat(join(dir, output))).mode & 0o777).toBe(0o600);
  if (output.endsWith('.yaml')) expect(parse(content)).toHaveProperty('version', 1);
  const previewJson = result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}\n') + 1);
  const preview = JSON.parse(previewJson) as { body: unknown }; expect(preview.body).toEqual(JSON.parse(provider.requests[0]!.body));
  if (output === 'explanation.md') { expect(provider.requests[0]?.body).not.toContain('@example.test'); expect(result.stdout).not.toContain('@example.test'); }
});
it('supports configured redactFields, field aliases, literal credentials, and preserves original files', async () => {
  const dir = await fixture(); const provider = await mock('# Draft\nfixture-provider-key');
  await writeFile(join(dir, 'ai.yaml'), 'version: 1\nredactFields: [customer_email, "$.report.findings[*].key"]\nmaxFindings: 1\n');
  const before = await readFile(join(dir, 'report.json'), 'utf8');
  const result = await run(['ai', 'explain', 'report.json', '--ai-config', 'ai.yaml', '--send', '--output', 'explanation.md'], dir, provider.url);
  expect(result.code, result.stderr).toBe(0);
  for (const secret of ['alice@example.test', 'bob@example.test', 'S000801', 'fixture-provider-key']) { expect(result.stdout).not.toContain(secret); expect(provider.requests[0]?.body).not.toContain(secret); expect(await readFile(join(dir, 'explanation.md'), 'utf8')).not.toContain(secret); }
  expect(await readFile(join(dir, 'report.json'), 'utf8')).toBe(before);
});
it('rejects generated module invariants without saving or executing the draft', async () => {
  const dir = await fixture(); await writeFile(join(dir, 'custom.ts'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(dir, 'EXECUTED'))}, 'bad'); export default () => ({name:'custom',passed:true,affectedKeys:[],explanation:'custom'});`);
  const provider = await mock(scenario.replace('invariants: [no_order_lost, single_assignment]', 'invariants: [{name: custom, module: ./custom.ts}]'));
  const result = await run(['ai', 'scenario', '--from', 'Breakdown D17', '--send', '--output', 'scenario.yaml'], dir, provider.url);
  expect(result.code, result.stderr).toBe(2); expect(result.stderr).toContain('cannot contain module'); expect(await readdir(dir)).not.toContain('scenario.yaml'); expect(await readdir(dir)).not.toContain('EXECUTED'); expect(provider.requests).toHaveLength(1);
});
it.each(['existing output', 'bad extension', 'invalid redaction', 'bad settings', 'missing input', 'wrong command options'])('rejects %s before contacting the provider', async (kind) => {
  const dir = await fixture(); const provider = await mock(); let args = ['ai', 'scenario', '--from', 'Breakdown', '--send', '--output', 'new.yaml'];
  if (kind === 'existing output') { await writeFile(join(dir, 'new.yaml'), 'owner content'); }
  if (kind === 'bad extension') args[args.length - 1] = 'draft.js';
  if (kind === 'invalid redaction') args.push('--redact-fields', '$..field');
  if (kind === 'bad settings') { await writeFile(join(dir, 'ai.yaml'), 'version: 1\nunknown: true\n'); args.push('--ai-config', 'ai.yaml'); }
  if (kind === 'missing input') args = ['ai', 'explain', 'missing.json', '--send'];
  if (kind === 'wrong command options') args.push('--openapi', 'openapi.yaml');
  const result = await run(args, dir, provider.url); expect(result.code).toBe(2); expect(provider.requests).toEqual([]);
  if (kind === 'existing output') expect(await readFile(join(dir, 'new.yaml'), 'utf8')).toBe('owner content');
});
it.each([
  { answer: 'version: 1\nentities: []', status: 200, redirect: false },
  { answer: 'unused', status: 429, redirect: false },
  { answer: 'unused', status: 200, redirect: true },
])('handles invalid/provider failures without writing drafts or retrying', async ({ answer, status, redirect }) => {
  const dir = await fixture(); const provider = await mock(answer, status, redirect);
  const result = await run(['ai', 'scenario', '--from', 'Breakdown', '--send', '--output', 'new.yaml'], dir, provider.url);
  expect(result.code).toBe(2); expect(provider.requests).toHaveLength(1); expect(await readdir(dir)).not.toContain('new.yaml'); expect(result.stderr).not.toContain('fixture-provider-key');
});
it('uses an ignored unique output name when --output is omitted', async () => {
  const dir = await fixture(); const provider = await mock();
  for (let i = 0; i < 2; i++) expect((await run(['ai', 'scenario', '--from', 'Breakdown D17', '--send'], dir, provider.url)).code).toBe(0);
  const files = await readdir(join(dir, 'logiparity-ai-drafts')); expect(files).toHaveLength(2); expect(files.every((f) => /^scenario-[a-f0-9-]+\.yaml$/.test(f))).toBe(true);
});

it('does not invoke AI during an operational scenario, even with a configured provider', async () => {
  const dir = await fixture(); const provider = await mock();
  const { server } = createDemoServer(); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No demo address');
  const result = await run(['scenario', 'run', resolve('examples/demo/scenarios/02-vehicle-breakdown.yaml'), '--target', resolve('examples/demo/target.yaml'), '--report-dir', join(dir, 'scenario-report')], dir, provider.url, { env: { DEMO_API_URL: `http://127.0.0.1:${address.port}` } });
  expect(result.code, result.stdout + result.stderr).toBe(0); expect(provider.requests).toEqual([]);
});
it('rejects oversized requests and empty redaction selectors before network or output creation', async () => {
  const dir = await fixture(); const provider = await mock();
  await writeFile(join(dir, 'large.yaml'), `openapi: 3.1.0\npaths: {}\nx-large: ${'x'.repeat(256 * 1024)}\n`);
  const large = await run(['ai', 'suggest-config', '--openapi', 'large.yaml', '--entity', 'shipment', '--send', '--output', 'new.yaml'], dir, provider.url);
  expect(large.code).toBe(2); expect(large.stderr).toContain('256 KiB'); expect(provider.requests).toEqual([]);
  const empty = await run(['ai', 'scenario', '--from', 'Breakdown', '--redact-fields', ',', '--send', '--output', 'new.yaml'], dir, provider.url);
  expect(empty.code).toBe(2); expect(provider.requests).toEqual([]); expect(await readdir(dir)).not.toContain('new.yaml');
});
