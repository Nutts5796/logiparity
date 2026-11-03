import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { deterministicArchive } from '../../scripts/deterministic-tar.mjs';
it('makes byte-identical offline archives despite different source mtimes and creation order (ana)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-deterministic-'));
  try {
    for (const variant of ['a', 'b']) {
      const root = join(directory, variant);
      await mkdir(join(root, 'tarballs'), { recursive: true });
      for (const file of variant === 'a' ? ['x', 'y'] : ['y', 'x']) {
        await writeFile(join(root, 'tarballs', file), file);
        await utimes(join(root, 'tarballs', file), variant === 'a' ? 1 : 1234567, variant === 'a' ? 1 : 1234567);
      }
      await deterministicArchive(root, 'kit', join(directory, variant + '.tgz'));
    }
    expect(await readFile(join(directory, 'a.tgz'))).toEqual(await readFile(join(directory, 'b.tgz')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('gates tag preparation on reusable CI, grants draft lookup access and binds the npm environment (ana)', async () => {
  const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  expect(workflow.jobs.verify.uses).toBe('./.github/workflows/ci.yml');
  expect(workflow.jobs.build.needs).toContain('verify');
  expect(workflow.jobs.build.needs).toContain('lookup');
  expect(workflow.jobs.build.permissions.contents).toBe('read');
  expect(workflow.jobs.lookup.permissions.contents).toBe('write');
  expect(workflow.jobs.npm.environment).toBe('npm');
  expect(
    workflow.jobs.images.steps.find((step: { with?: Record<string, unknown> }) => step.with?.['subject-name'])?.if,
  ).toContain('needs-attestation');
});
it('pins the expected image repository and Dockerfile frontend without a build', async () => {
  const template = await readFile('templates/github-actions-container.yml', 'utf8');
  expect(template).toContain('^ghcr\\.io\\/nutts5796\\/logiparity:');
  expect(template).toContain('if-no-files-found: warn');
  expect((await readFile('Dockerfile', 'utf8')).split('\n')[0]).toMatch(
    /^# syntax=docker\/dockerfile:1@sha256:[a-f0-9]{64}$/,
  );
});
