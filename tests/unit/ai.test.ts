import { mkdtemp, readFile, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { aiSettingsSchema, draftMarker, generateDraft, loadAiSettings, prepareDestination, prepareDraft, providerConfig, renderDraft, requestBody, type PreparedDraft } from '@logiparity/ai';
import { parseStructured, readStructured } from '../../packages/ai/src/input.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'logiparity-ai-unit-')); dirs.push(dir); return dir; }
const settings = aiSettingsSchema.parse({ version: 1 });
const report = { schemaVersion: 1, entities: [{ entity: 'shipment', reference: 'api', counts: { api: 2, csv: 2 } }], findings: [{ type: 'field_mismatch', entity: 'shipment', source: 'csv', key: 'S1', field: 'customer_email', expected: 'alice@example.test', actual: 'bob@example.test', message: 'alice@example.test differs' }, { type: 'source_error', entity: 'shipment', source: 'sql', key: '', field: '', message: 'read failed', blocking: false }] };
const configDraft = `version: 1\nenvironment: test\nentities:\n  - name: shipment\n    key: id\n    sources:\n      api: {type: rest, baseUrl: "\${STAGING_API_URL}", path: /shipments, fields: {id: $.id}}\n      csv: {type: csv, file: ./shipments.csv, fields: {id: ID}}\n`;
it('builds a local scenario prompt without requiring any provider configuration', async () => {
  expect(providerConfig({}, 1000, false)).toBeUndefined(); expect(() => providerConfig({}, 1000)).toThrow('AI is disabled');
  const prepared = await prepareDraft({ kind: 'scenario', description: 'Two vans broke down' }, settings);
  expect(prepared.messages[1]?.content).toContain('Two vans broke down'); expect(prepared.messages[0]?.content).toContain('test/staging-only');
});
it.each(['file:///tmp/provider', 'https://user:pass@example.test/v1', 'https://example.test/v1?token=value', 'https://example.test/v1#fragment', 'broken'])('rejects provider base %s without leaking it', (url) => {
  expect(() => providerConfig({ LOGIPARITY_AI_BASE_URL: url, LOGIPARITY_AI_MODEL: 'mock-model', LOGIPARITY_AI_API_KEY: 'mock-key' }, 1000)).toThrow(/LOGIPARITY_AI_BASE_URL/);
});
it('appends the endpoint under the exact configured base and keeps keys out of request bodies', () => {
  const config = providerConfig({ LOGIPARITY_AI_BASE_URL: 'http://127.0.0.1:4321/custom/v1/', LOGIPARITY_AI_MODEL: 'owner-selected-model', LOGIPARITY_AI_API_KEY: 'fixture-credential' }, 500)!;
  expect(config.endpoint).toBe('http://127.0.0.1:4321/custom/v1/chat/completions');
  expect(requestBody(config, [{ role: 'user', content: 'hello' }])).not.toContain('fixture-credential');
  expect(() => providerConfig({ LOGIPARITY_AI_BASE_URL: 'https://provider.test/fixture-credential', LOGIPARITY_AI_MODEL: 'mock', LOGIPARITY_AI_API_KEY: 'fixture-credential' }, 500)).toThrow('only in');
});
it('does not expand environment placeholders or resolve OpenAPI references', async () => {
  const dir = await directory(); const file = join(dir, 'openapi.yaml');
  await writeFile(file, 'openapi: 3.1.0\ninfo: {title: Synthetic, version: "1"}\npaths: {}\nx-example: ${DO_NOT_EXPAND}\ncomponents: {schemas: {Order: {$ref: "https://unconfigured.invalid/schema"}}}\n');
  const prepared = await prepareDraft({ kind: 'suggest-config', openapi: file, entity: 'shipment' }, settings);
  expect(prepared.messages[1]?.content).toContain('${DO_NOT_EXPAND}'); expect(prepared.messages[1]?.content).toContain('https://unconfigured.invalid/schema');
  expect(prepared.messages[0]?.content).toContain('Do not dereference');
});
it('summarizes complete report totals, explicitly samples findings, and redacts field values', async () => {
  const dir = await directory(); const file = join(dir, 'report.json'); await writeFile(file, JSON.stringify(report));
  const prepared = await prepareDraft({ kind: 'explain', report: file }, { ...settings, maxFindings: 1, redactFields: ['customer_email'] });
  const input = JSON.parse(prepared.messages[1]!.content) as { report: { findings: unknown[] }; sampling: Record<string, unknown> };
  expect(input.report.findings).toHaveLength(1); expect(input.sampling).toEqual({ totalFindings: 2, sentFindings: 1, omittedFindings: 1, blockingFindings: 2, countsByType: { field_mismatch: 1, source_error: 1 } });
  expect(prepared.messages[1]?.content).not.toContain('@example.test'); expect(await readFile(file, 'utf8')).toContain('alice@example.test');
});
it('accepts additive report groups and redacts their values and summaries before AI preview', async () => {
  const dir = await directory(); const file = join(dir, 'grouped.json');
  await writeFile(file, JSON.stringify({ ...report, groups: [{ entity: 'shipment', source: 'csv', field: 'customer_email', count: 1, kind: 'value_mapping', expected: 'alice@example.test', actual: 'bob@example.test', summary: 'alice@example.test -> bob@example.test' }] }));
  const prepared = await prepareDraft({ kind: 'explain', report: file }, { ...settings, redactFields: ['customer_email'] });
  const input = JSON.parse(prepared.messages[1]!.content) as { report: { groups: { expected: string; actual: string; summary: string }[] } };
  expect(input.report.groups).toHaveLength(1); expect(input.report.groups[0]).toMatchObject({ expected: '[REDACTED]', actual: '[REDACTED]', summary: '[REDACTED] -> [REDACTED]' });
  expect(prepared.messages[1]?.content).not.toContain('@example.test');
});
it('validates settings, YAML syntax, finite JSON-compatible input and input size without echoing content', async () => {
  const dir = await directory(); const file = join(dir, 'bad.yaml'); await writeFile(file, 'version: 1\nredactFields: [email]\ntimeoutMs: 100\n');
  expect((await loadAiSettings(file)).redactFields).toEqual(['email']);
  await writeFile(file, 'version: 1\nunknown: private-value\n'); await expect(loadAiSettings(file)).rejects.toThrow('invalid settings');
  expect(() => parseStructured('a: [private-value\na: 2', 'input.yaml')).toThrow(/input.yaml:\d+:\d+: invalid/);
  try { parseStructured('a: [private-value\na: 2', 'input.yaml'); } catch (error) { expect(String(error)).not.toContain('private-value'); }
  expect(() => parseStructured('a: &self {child: *self}', 'cycle')).toThrow('cyclic');
  expect(() => parseStructured('a: .inf', 'infinite')).toThrow('finite');
  await writeFile(file, 'x'.repeat(16 * 1024 * 1024 + 1)); await expect(readStructured(file)).rejects.toThrow('16 MiB');
});
it('rejects malformed task inputs and oversized provider requests', async () => {
  const dir = await directory(); const file = join(dir, 'input.json'); await writeFile(file, '{}');
  await expect(prepareDraft({ kind: 'suggest-config', openapi: file, entity: 'shipment' }, settings)).rejects.toThrow('OpenAPI');
  await expect(prepareDraft({ kind: 'explain', report: file }, settings)).rejects.toThrow('Parity');
  await expect(prepareDraft({ kind: 'scenario', description: '' }, settings)).rejects.toThrow('--from');
  await expect(prepareDraft({ kind: 'scenario', description: 'a'.repeat(8193) }, settings)).rejects.toThrow('8 KiB');
  expect(() => requestBody({ model: 'mock' }, [{ role: 'user', content: 'x'.repeat(256 * 1024) }])).toThrow('256 KiB');
});
it('validates draft syntax without expanding env or reading fixture/module paths', async () => {
  const prepared = await prepareDraft({ kind: 'scenario', description: 'Breakdown D17' }, settings);
  const scenario = `version: 1\nname: Draft breakdown\ntarget: demo\nsetup: {fixture: ./does-not-exist.json}\nevents: [{step: 1, type: vehicle_breakdown, params: {driver: D17}}]\nwait: {until: {replan_status: completed}}\ninvariants: [no_order_lost]\n`;
  expect(renderDraft(prepared, `\`\`\`yaml\n${scenario}\n\`\`\``)).toContain(draftMarker);
  const config = { ...prepared, kind: 'suggest-config' as const }; expect(renderDraft(config, configDraft)).toContain('${STAGING_API_URL}');
  expect(() => renderDraft(config, 'version: 1\nentities: []')).toThrow('schema'); expect(() => renderDraft(prepared, '')).toThrow('empty');
  expect(renderDraft({ ...prepared, kind: 'explain' }, '# Findings\nObserved one mismatch.')).toMatch(/^# AI-generated draft: review before use\n/);
});
it('supports injected mock providers, writes private new draft files and refuses overwrite/symlinks', async () => {
  const dir = await directory(); const prepared: PreparedDraft = { kind: 'suggest-config', messages: [{ role: 'user', content: 'Synthetic schema' }], redactions: 0, scrub: (value) => value };
  const destination = await prepareDestination(join(dir, 'new/config.yaml'), prepared.kind); let calls = 0;
  await generateDraft(prepared, { async complete(messages) { calls++; expect(messages[0]?.content).toBe('Synthetic schema'); return configDraft; } }, destination);
  expect(calls).toBe(1); expect(await readFile(destination, 'utf8')).toMatch(/^# AI-generated draft: review before use\n/); expect((await stat(destination)).mode & 0o777).toBe(0o600);
  await expect(prepareDestination(destination, prepared.kind)).rejects.toThrow('already exists');
  let overwriteCalls = 0;
  await expect(generateDraft(prepared, { async complete() { overwriteCalls++; return configDraft; } }, destination)).rejects.toThrow('already exists');
  expect(overwriteCalls).toBe(0);
  const link = join(dir, 'link.yaml'); await symlink(destination, link); await expect(prepareDestination(link, prepared.kind)).rejects.toThrow('already exists');
  await expect(prepareDestination(join(dir, 'unsafe.js'), prepared.kind)).rejects.toThrow('.yaml');
});

it('preserves a file created concurrently while the provider is generating a draft', async () => {
  const dir = await directory(); const destination = join(dir, 'concurrent.yaml');
  const prepared: PreparedDraft = { kind: 'suggest-config', messages: [], redactions: 0, scrub: (text) => text };
  await expect(generateDraft(prepared, { async complete() { await writeFile(destination, 'owner content', { flag: 'wx' }); return configDraft; } }, destination)).rejects.toThrow('No file was overwritten');
  expect(await readFile(destination, 'utf8')).toBe('owner content');
});
