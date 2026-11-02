import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configSchema, errorText, loadConfig, ruleSchema } from '@logiparity/core';

const temporary: string[] = [];
async function configFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-config-')); temporary.push(dir);
  const file = join(dir, 'parity.yaml'); await writeFile(file, content); return file;
}
const valid = `version: 1
entities:
  - name: shipments
    key: id
    sources:
      api:
        type: rest
        baseUrl: \${API_URL}
        path: /api/shipments?date={{date}}
        fields: {id: $.id}
      export:
        type: csv
        file: ./out/{{date}}.csv
        fields: {id: ID}
variables: {date: "2026-11-02"}
`;
afterEach(async () => { await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe('configuration', () => {
  it('validates and interpolates parsed scalar values, resolves paths relative to the config', async () => {
    const file = await configFile(valid);
    const { config, baseDir } = await loadConfig(file, { API_URL: 'http://localhost:3010' });
    expect(baseDir).toBe(file.slice(0, file.lastIndexOf('/')));
    expect(config.entities[0]?.sources.api).toMatchObject({ path: '/api/shipments?date=2026-11-02', timeoutMs: 10000 });
    expect(config.environment).toBe('test');
    expect(config.report.outputs).toEqual(['console', 'json']);
  });
  it('reports file and precise schema path without dumping supplied values', async () => {
    const file = await configFile(valid.replace('type: csv', 'type: sql'));
    await expect(loadConfig(file, { API_URL: 'http://localhost' })).rejects.toThrow('entities.0.sources.export.type');
  });
  it('preserves injected YAML punctuation inside scalar strings', async () => {
    const file = await configFile(valid.replace('file: ./out/{{date}}.csv', 'file: ${LOCAL_FILE}'));
    const { config } = await loadConfig(file, { API_URL: 'http://localhost', LOCAL_FILE: 'safe\nreport: hacked' });
    expect(config.entities[0]?.sources.export).toMatchObject({ file: 'safe\nreport: hacked' });
  });
  it('reports missing env names without secret values', async () => {
    const file = await configFile(valid);
    await expect(loadConfig(file, {})).rejects.toThrow('API_URL is missing');
  });
  it('rejects missing or non-string variables', async () => {
    await expect(loadConfig(await configFile(valid.replace('variables: {date: "2026-11-02"}', 'variables: {}')), { API_URL: 'http://localhost' })).rejects.toThrow('variables.date is missing');
    await expect(loadConfig(await configFile(valid.replace('"2026-11-02"', '20261102')), { API_URL: 'http://localhost' })).rejects.toThrow('quoted string');
  });
  it('rejects malformed YAML, duplicate keys, absent files and excessive aliases', async () => {
    await expect(loadConfig(await configFile('bad: ['))).rejects.toThrow('Fix the YAML syntax');
    await expect(loadConfig(await configFile('version: 1\nversion: 1'))).rejects.toThrow('Map keys must be unique');
    await expect(loadConfig('/does/not/exist.yaml')).rejects.toThrow('cannot read');
    const aliases = 'a: &a [1, 2]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]';
    await expect(loadConfig(await configFile(aliases))).rejects.toThrow('aliases');
  });
  it('requires at least two sources and a mapped key', async () => {
    const file = await configFile('version: 1\nentities: [{name: a, key: id, sources: {one: {type: csv, file: a.csv, fields: {other: Other}}}}]');
    await expect(loadConfig(file)).rejects.toThrow('at least two');
    await expect(loadConfig(file)).rejects.toThrow('Map the entity key id');
  });
  it('requires money currency and integer minor-unit tolerance', () => {
    expect(ruleSchema.safeParse({ type: 'money' }).success).toBe(false);
    expect(ruleSchema.safeParse({ type: 'money', currency: 'USD', tolerance: 0.01 }).success).toBe(false);
  });
  it('rejects production environment, future milestone options and literal auth secrets', async () => {
    const file = await configFile(valid + 'environment: production\n');
    await expect(loadConfig(file, { API_URL: 'http://localhost' })).rejects.toThrow('environment');
    const { config } = await loadConfig(await configFile(valid), { API_URL: 'http://localhost' });
    expect(configSchema.safeParse({ ...config, report: { outputs: ['html'] } }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, entities: [...config.entities, ...config.entities] }).success).toBe(false);
    await expect(loadConfig(await configFile(valid.replace('baseUrl: ${API_URL}', 'baseUrl: ftp://localhost')), {})).rejects.toThrow('HTTP(S)');
    await expect(loadConfig(await configFile(valid.replace('path: /api/shipments?date={{date}}', 'path: /api\n        auth: {type: bearer, token: SECRET}')), { API_URL: 'http://localhost' })).rejects.toThrow('tokenEnv');
  });
  it('formats unknown errors safely', () => { expect(errorText('failure')).toBe('failure'); expect(errorText(new Error('failure'))).toBe('failure'); });
});
