import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configSchema, loadConfig, entitySchema } from '@logiparity/core';
const source = { type: 'csv', file: 'unused', fields: { id: 'id', pay: 'pay' } };
const entity = {
  name: 'order',
  key: 'id',
  sources: { a: source, b: source },
  compare: { pay: { type: 'money', currency: 'USD' } },
};
async function configuration(raw: unknown, check: (file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m102-config-'));
  try {
    const file = join(dir, 'parity.yaml');
    await writeFile(file, JSON.stringify(raw));
    await check(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
it('warns at validate time when an explicit failOn omits invalid, and lists categories for typos (david)', async () => {
  await configuration({ version: 1, entities: [{ ...entity, failOn: ['missing'] }] }, async (file) => {
    expect((await loadConfig(file, {}, { command: 'validate' })).warnings.join(' ')).toContain('invalid');
  });
  for (const failOn of [['bogus'], { bogus: 1 }])
    await configuration({ version: 1, entities: [{ ...entity, failOn }] }, async (file) => {
      await expect(loadConfig(file, {})).rejects.toThrow(/missing, extra, mismatch, aggregate, duplicate, invalid/);
    });
});
it('keeps invalid in every shipped complete failure policy (david, maria)', async () => {
  for (const file of [
    'packages/cli/src/init.ts',
    'packages/ai/src/prompts.ts',
    'README.md',
    'examples/demo/parity.yaml',
    'examples/demo/parity-ui.yaml',
    'examples/demo/parity-scenario.yaml',
  ]) {
    const text = await readFile(file, 'utf8');
    for (const list of text.matchAll(/\[missing, extra, mismatch, aggregate, duplicate[^\]]*\]/g))
      expect(list[0], file).toContain('invalid');
  }
});
it('retains the version 1.0 runtime exports as deprecated API aliases (david)', async () => {
  const api = await import('../../api/core.js');
  for (const name of [
    'SourceError',
    'ConfigError',
    'aggregateSchema',
    'failOnSchema',
    'errorText',
    'loadYaml',
    'formatConfigIssues',
    'isSecretName',
    'secretValues',
    'redactSecrets',
    'safeConsole',
    'sortFindings',
    'groupFindings',
    'reportGroups',
    'formatDatetimeUtc',
    'formatMoneyMajor',
    'presentationValue',
    'findingCategories',
    'isBlocking',
    'applyFailurePolicies',
    'writeJsonReport',
  ])
    expect(Reflect.get(api, name), name).toBeDefined();
});
it('rejects nonsense date formats before reading any source (raj)', () => {
  expect(
    configSchema.safeParse({
      version: 1,
      entities: [{ ...entity, sources: { a: { ...source, datetimeFormat: 'nonsense' }, b: source } }],
    }).success,
  ).toBe(false);
  expect(
    entitySchema.safeParse({ ...entity, compare: { pay: { type: 'datetime', format: 'not a date' } } }).success,
  ).toBe(false);
});
