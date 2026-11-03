import { expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atomicReportFile,
  configSchema,
  sourceSchema,
  entitySchema,
  compareEntities,
  consoleReport,
} from '@logiparity/core';
import { readRest } from '@logiparity/adapters';
import { checkedReport } from '../../scripts/validate-report.mjs';
afterEach(() => vi.unstubAllGlobals());
it.each(['artifacts', 'parity', 'screenshots'])(
  'refuses a symlinked %s report subdirectory (Crowd9 Sam N4)',
  async (name) => {
    const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-link-'));
    try {
      await mkdir(join(dir, 'outside'));
      await mkdir(join(dir, 'report'));
      await symlink(join(dir, 'outside'), join(dir, 'report', name));
      await expect(atomicReportFile(join(dir, 'report', name, 'evidence.txt'), 'private')).rejects.toThrow(/symlink/i);
      expect(await readdir(join(dir, 'outside'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
it('accepts quoted octal modes and rejects plain integers with a clear quoting hint (Crowd9 Sam N6)', () => {
  for (const value of ['0640', '0o640'])
    expect(
      configSchema.parse({
        version: 1,
        entities: [
          {
            name: 'row',
            key: 'id',
            sources: {
              a: { type: 'csv', file: 'a', fields: { id: 'ID' } },
              b: { type: 'csv', file: 'b', fields: { id: 'ID' } },
            },
          },
        ],
        report: { fileMode: value },
      }).report.fileMode,
    ).toBe(0o640);
  for (const value of [444, 640])
    expect(() => configSchema.parse({ version: 1, entities: [], report: { fileMode: value } })).toThrow(
      /Quote.*fileMode|fileMode.*quoted/,
    );
});
it('never throws an unlocated Invalid URL while parsing a bad source (Crowd9 Sam N5)', () => {
  const result = sourceSchema.safeParse({ type: 'rest', baseUrl: 'not a URL', path: '/', fields: { id: '$.id' } });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.some((issue) => issue.path.includes('baseUrl'))).toBe(true);
});
it('does not expose a redirect Location host (Crowd9 Sam N2)', async () => {
  vi.stubGlobal(
    'fetch',
    async () => new Response(null, { status: 301, headers: { location: 'http://private-test-host:3091/x' } }),
  );
  const source = sourceSchema.parse({
    type: 'rest',
    baseUrl: 'http://fixture.test',
    path: '/',
    fields: { id: '$.id' },
    retries: 0,
  });
  try {
    for await (const row of readRest(source as never, { baseDir: '.', env: {} })) void row;
    throw Error('expected redirect refusal');
  } catch (error) {
    expect(String(error)).toContain('redirect refused');
    expect(String(error)).not.toContain('private-test-host');
  }
});
it('names the limit path once and gives maxFindings the formatted Node memory guidance (Crowd9 all reviewers)', async () => {
  const source = { type: 'csv', file: 'unused', fields: { id: 'id' } };
  const entity = entitySchema.parse({
    name: 'row',
    key: 'id',
    sources: { a: { ...source, label: 'A', maxRows: 2 }, b: source },
  });
  const report = await checkedReport(
    compareEntities([entity], async function* () {
      for (let i = 0; i < 3; i++) yield { id: String(i) };
    }),
  );
  const text = consoleReport(report, { entities: [entity] });
  expect(text).toContain('entities[0].sources.a.maxRows');
  expect(text).not.toContain('A: a:');
  expect(text).toContain('--max-old-space-size');
});
