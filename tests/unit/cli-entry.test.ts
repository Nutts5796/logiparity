import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const temporary: string[] = [];
const originalArgv = process.argv;
const originalExit = process.exitCode;
afterEach(async () => {
  process.argv = originalArgv;
  process.exitCode = originalExit;
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function cli(args: string[]) {
  vi.resetModules();
  process.argv = ['node', 'logiparity', ...args];
  let stdout = '',
    stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((value: unknown) => {
    stdout += String(value);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((value: unknown) => {
    stderr += String(value);
    return true;
  });
  await import('../../packages/cli/src/main.js');
  return { stdout, stderr, code: process.exitCode };
}
it.each([
  ['--help'],
  ['check', '--help'],
  ['validate', '--help'],
  ['init', '--help'],
  ['scenario', '--help'],
  ['ai', '--help'],
  ['install-browser', '--help'],
  ['demo', '--help'],
  ['--version'],
])('prints command help or version for %j', async (...args) => {
  const output = await cli(args);
  expect(output.code).toBe(0);
  expect(output.stdout.length).toBeGreaterThan(3);
});
it.each([
  ['bogus'],
  ['--verbose'],
  ['scenario', 'validate', 'missing.yaml'],
  ['scenario', 'run', 'missing.yaml'],
  ['check'],
  ['--allow-modules'],
  ['--send'],
  ['--allow-missing-env'],
])('rejects incomplete or invalid commands %j', async (...args) => {
  const output = await cli(args);
  expect(output.code).toBe(2);
  expect(output.stderr).toContain('LogiParity:');
});
it('runs init, validates without source access and checks actual CSV files through the entry point', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-cli-entry-'));
  temporary.push(directory);
  const starter = join(directory, 'starter.yaml');
  expect((await cli(['init', '--config', starter])).code).toBe(0);
  expect(await readFile(starter, 'utf8')).toContain('STAGING_API_URL');
  vi.restoreAllMocks();
  const config = join(directory, 'parity.json');
  await writeFile(
    config,
    JSON.stringify({
      version: 1,
      entities: [
        {
          name: 'o',
          key: 'id',
          sources: {
            a: { type: 'csv', file: 'a.csv', fields: { id: 'id' } },
            b: { type: 'csv', file: 'b.csv', fields: { id: 'id' } },
          },
        },
      ],
      report: { dir: 'report', outputs: ['console', 'json'] },
    }),
  );
  expect((await cli(['validate', '--config', config])).code).toBe(0);
  await writeFile(join(directory, 'a.csv'), 'id\nO1\n');
  await writeFile(join(directory, 'b.csv'), 'id\nO1\n');
  expect((await cli(['check', '--config', config])).code).toBe(0);
  expect(JSON.parse(await readFile(join(directory, 'report/report.json'), 'utf8')).findings).toEqual([]);
});
