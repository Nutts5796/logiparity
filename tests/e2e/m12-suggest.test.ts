import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
const execute = promisify(execFile),
  cli = resolve('packages/cli/dist/main.js'),
  fixture = resolve('tests/fixtures/suggest');
const run = (args: string[], cwd = process.cwd()) =>
  execute(process.execPath, [cli, ...args], { cwd }).then(
    (r) => ({ ...r, code: 0 }),
    (error: { stdout: string; stderr: string; code: number }) => error,
  );
it('prints a blocked draft for local CSV/JSON with evidence and preserves every column', async () => {
  const draft = await run([
    'suggest',
    '--source',
    `reference=${join(fixture, 'reference.csv')}`,
    '--source',
    `candidate=${join(fixture, 'candidate.json')}`,
  ]);
  expect(draft.code).toBe(0);
  expect(draft.stderr).toBe('');
  expect(draft.stdout).toContain('starting point');
  expect(draft.stdout).toContain('nonempty sample values');
  const config = parse(draft.stdout);
  expect(config.TODO_REVIEW_REQUIRED).toBeTruthy();
  expect(config.entities[0].sources.candidate.baseUrl).toBe('TODO_API_BASE_URL');
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m12-suggest-'));
  try {
    const file = join(dir, 'draft.yaml');
    await writeFile(file, draft.stdout);
    const validation = await run(['validate', '--config', file]);
    expect(validation.code).toBe(2);
    expect(validation.stderr).toContain('TODO_REVIEW_REQUIRED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('writes a private new draft, rebases local paths, supports XLSX and refuses overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m12-draft-'));
  try {
    const file = join(dir, 'parity.yaml'),
      args = [
        'suggest',
        '--source',
        `ref=${join(fixture, 'reference.csv')}`,
        '--source',
        `excel=${join(fixture, 'candidate.xlsx')}`,
        '--sheet',
        'excel=Records',
        '--output',
        file,
      ];
    expect((await run(args)).code).toBe(0);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const original = await readFile(file, 'utf8');
    expect(resolve(dir, parse(original).entities[0].sources.ref.file)).toBe(join(fixture, 'reference.csv'));
    expect((await run(args)).code).toBe(2);
    expect(await readFile(file, 'utf8')).toBe(original);
    expect((await run(['check', '--source', 'a=x.csv'])).code).toBe(2);
    expect((await run(['suggest', '--source', 'a=x.csv', '--source', 'a=y.csv'])).stderr).toContain('specified twice');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
