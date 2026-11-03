import { checkedReport, parseCheckedJson } from '../../scripts/validate-report.mjs';
import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configSchema,
  loadConfig,
  redactSecrets,
  safeConsole,
  secretValues,
  shortSecretWarnings,
  writeReports,
} from '@logiparity/core';
import { redactInput } from '../../packages/ai/src/redact.js';
it.each([
  ['Authorization: rawtoken1234567890', 'rawtoken1234567890'],
  ["{'Authorization': 'Basic dXNlcjpwYXNzd29yZA=='}", 'dXNlcjpwYXNzd29yZA=='],
  ['mode=fast;password=Hunter2Hunter2', 'Hunter2Hunter2'],
  ['curl -u admin:SuperSecret99 https://h/', 'SuperSecret99'],
  ['pass=Hunter2Hunter2 user=bob', 'Hunter2Hunter2'],
  ['{"password":"hunter2hunter2","id":"S1"}', 'hunter2hunter2'],
])('redacts credential tokens while preserving syntax and idempotence: %s (sam)', (input, secret) => {
  const first = redactInput({ message: input });
  const text = String((first.data as { message: string }).message);
  expect(text).not.toContain(secret);
  expect(first.scrub(text)).toBe(text);
  if (input.startsWith('{"')) expect(parseCheckedJson(text)).toEqual({ password: '[REDACTED]', id: 'S1' });
});
it('tracks every environment interpolation through variables (sam)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m101-env-'));
  try {
    const file = join(dir, 'parity.yaml');
    await writeFile(
      file,
      'version: 1\nvariables: {tenant: "${TENANT_REF}"}\nentities:\n  - name: order\n    key: id\n    sources:\n      a: {type: csv, file: "{{tenant}}", fields: {id: id}}\n      b: {type: csv, file: unused, fields: {id: id}}\n',
    );
    const loaded = await loadConfig(file, { TENANT_REF: 'private-tenant-1234' });
    expect(loaded.secrets).toContain('private-tenant-1234');
    expect(redactSecrets('private-tenant-1234', secretValues(loaded.config, {}))).toBe('[REDACTED]');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('normalizes every invisible format character before redaction (sam)', () => {
  expect(safeConsole('a\u2060\u200c\u200d\u00adb')).toBe('ab');
  expect(redactSecrets('private\u200bsecret99', ['privatesecret99'], 'data')).toBe('[REDACTED]');
});
it('keeps Basic usernames public unless explicitly secret (sam)', () => {
  const config = { auth: { type: 'basic', usernameEnv: 'API_USER', passwordEnv: 'API_PASS' } };
  expect(secretValues(config, { API_USER: 'qa-bot', API_PASS: 'long-password-123' })).not.toContain('qa-bot');
  expect(shortSecretWarnings(config, { API_USER: 'qa-bot', API_PASS: 'long-password-123' })).toEqual([]);
});
it.each(['https://127.0.0.1:3061', '127.0.0.1:3061/admin'])('rejects malformed allowlist entry %s (sam)', (host) => {
  const result = configSchema.safeParse({
    version: 1,
    allowedHosts: [host],
    entities: [
      {
        name: 'o',
        key: 'id',
        sources: {
          a: { type: 'csv', file: 'a', fields: { id: 'id' } },
          b: { type: 'csv', file: 'b', fields: { id: 'id' } },
        },
      },
    ],
  });
  expect(result.success).toBe(false);
});
it('refuses a symlink report destination and preserves its target (sam)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m101-report-'));
  try {
    const target = join(dir, 'private');
    await writeFile(target, 'keep');
    await symlink(target, join(dir, 'report.json'));
    await expect(writeReports({ schemaVersion: 1, entities: [], findings: [] }, dir, ['json'])).rejects.toThrow(
      /symlink/i,
    );
    expect(await readFile(target, 'utf8')).toBe('keep');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('neutralizes Markdown mentions from source keys', async () => {
  const { markdownReport } = await import('@logiparity/core');
  const report = {
    schemaVersion: 1 as const,
    entities: [],
    findings: [
      {
        type: 'missing_in_source' as const,
        entity: 'o',
        source: 'csv',
        key: '@team',
        field: '',
        message: 'Missing @team',
      },
    ],
  };
  const output = markdownReport(report);
  expect(output).not.toContain('@team');
  expect(output).toContain('&#64;team');
});
it('strips format characters before redacting values in every parity writer', async () => {
  const {
    compareEntities,
    entitySchema,
    htmlReport,
    markdownReport,
    junitReport,
    jsonReport,
    consoleReport,
    rememberEnvironment,
  } = await import('@logiparity/core');
  const source = { type: 'csv', file: 'unused', fields: { id: 'id', value: 'value' } };
  const entity = entitySchema.parse({ name: 'o', key: 'id', sources: { a: source, b: source } });
  rememberEnvironment(entity, { secrets: ['privatesecret99'], references: [] });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield { id: 'O1', value: name === 'a' ? 'ordinary' : 'private\u200bsecret99' };
    }),
  );
  for (const output of [
    jsonReport(report),
    consoleReport(report, { entities: [entity] }),
    htmlReport(report, { entities: [entity] }),
    markdownReport(report, { entities: [entity] }),
    junitReport(report, new Date(), { entities: [entity] }),
  ]) {
    expect(output).not.toMatch(/private|\p{Cf}/u);
    expect(output).toContain('REDACTED');
  }
});
it('refuses a scenario report symlink as well', async () => {
  const { writeScenarioReport } = await import('@logiparity/scenarios');
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m101-scenario-link-'));
  try {
    await writeFile(join(dir, 'private'), 'keep');
    await symlink(join(dir, 'private'), join(dir, 'scenario.json'));
    await expect(
      writeScenarioReport(
        {
          schemaVersion: 1,
          kind: 'scenario',
          name: 'test',
          target: 'test',
          environment: 'test',
          events: [],
          invariants: [],
          exitCode: 0,
        },
        dir,
      ),
    ).rejects.toThrow(/symlink/i);
    expect(await readFile(join(dir, 'private'), 'utf8')).toBe('keep');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('scans a long non-credential token without repeated suffix scans', () => {
  const value = 'a'.repeat(256 * 1024);
  expect(redactInput({ message: value }).data).toEqual({ message: value });
});
it('keeps explicit Basic username secrets available as an opt-in and masks invisible key names', () => {
  expect(
    secretValues(
      { secretEnv: ['API_USER'], auth: { type: 'basic', usernameEnv: 'API_USER', passwordEnv: 'API_PASS' } },
      { API_USER: 'private-user', API_PASS: 'private-password' },
    ),
  ).toContain('private-user');
  expect(redactInput({ ['pa\u200bssword']: 'hidden-password' }).data).toEqual({ password: '[REDACTED]' });
});
