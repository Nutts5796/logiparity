import { expect, it } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm, cp, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
const run = promisify(execFile);
it('runs downstream publication jobs when the optional attest job was skipped on reuse (Crowd9 Ana)', async () => {
  const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  for (const name of ['draft', 'npm', 'images', 'notes'])
    expect(workflow.jobs[name].if).toMatch(/cancelled\(\)|always\(\)/);
  const condition = workflow.jobs.npm.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const evaluate = new Function('needs', 'github', 'cancelled', `return (${condition})`);
  expect(
    evaluate(
      {
        build: { result: 'success', outputs: { reused: 'true' } },
        attest: { result: 'skipped' },
        draft: { result: 'success' },
      },
      { event_name: 'push' },
      () => false,
    ),
  ).toBe(true);
  expect(
    evaluate({ build: { result: 'failure' }, draft: { result: 'success' } }, { event_name: 'push' }, () => false),
  ).toBe(false);
});
it('names the missing draft asset before aborting lookup (Crowd9 Ana)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-lookup-'));
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(
      join(dir, 'bin/gh'),
      '#!/bin/sh\nif [ "$1 $2" = "release view" ]; then printf \'{"assets":[]}\\n\'; else exit 99; fi\n',
      { mode: 0o755 },
    );
    const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
    const step = workflow.jobs.lookup.steps.find((s: { id?: string }) => s.id === 'release');
    const result = await run('/bin/bash', ['--noprofile', '-c', step.run], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: join(dir, 'bin') + ':' + process.env.PATH,
        TAG: 'v1.1.0',
        REPOSITORY: 'fixture/repo',
        GITHUB_OUTPUT: join(dir, 'output'),
      },
    }).catch((error) => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('missing asset: logiparity-1.1.0.tgz');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('stops the pasted zsh tag recipe before any git call on a prerelease version (Crowd9 Ana tagsim3)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-tag-'));
  try {
    await run('git', ['init', '--quiet'], { cwd: dir });
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.2.0-rc.1' }));
    await writeFile(join(dir, 'bin/git'), '#!/bin/sh\nprintf called >> "$CALL_LOG"\n', { mode: 0o755 });
    const docs = await readFile('docs/release.md', 'utf8');
    const block = [...docs.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) => m[1]!).find((s) => s.includes('git tag -a'))!;
    const log = join(dir, 'git-calls');
    const result = await run('/bin/zsh', ['-f', '-c', block], {
      cwd: dir,
      env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, CALL_LOG: log },
    }).catch((error) => error);
    expect(result.code).toBe(2);
    await expect(access(log)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('bumps both schema identities and the nested parity reference in a scratch release (Crowd9 Ana)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-bump-'));
  try {
    for (const name of ['packages', 'apps', 'scripts', 'docs', 'templates', 'packages/cli/src'])
      await mkdir(join(dir, name), { recursive: true });
    for (const file of [
      'package.json',
      'package-lock.json',
      'README.md',
      'scripts/bump-version.mjs',
      'docs/report-schema.json',
      'docs/scenario-report-schema.json',
      'templates/github-actions.yml',
      'templates/github-actions-container.yml',
      'templates/gitlab-ci.yml',
    ])
      await cp(file, join(dir, file));
    await cp('packages/cli/package.json', join(dir, 'packages/cli/package.json'));
    await run(process.execPath, [join(dir, 'scripts/bump-version.mjs'), '1.2.0']);
    for (const file of ['report-schema.json', 'scenario-report-schema.json']) {
      const schema = JSON.parse(await readFile(join(dir, 'docs', file), 'utf8'));
      expect(schema.$id).toContain('/v1.2.0/docs/');
      expect(JSON.stringify(schema)).not.toContain('/v1.1.0/');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('blocks pre-publication phrases and HEAD compare links only in shipped files (Crowd9 Linda/David)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-release-text-'));
  try {
    await mkdir(join(dir, 'docs/development'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.1.0', files: ['README.md', 'docs/*.md'] }));
    await writeFile(join(dir, 'README.md'), 'Published on 2026-11-04');
    await writeFile(join(dir, 'docs/development/review.md'), 'Unreleased, under review');
    const script = resolve('scripts/check-release-text.mjs');
    await run(process.execPath, [script, dir]);
    for (const text of [
      'Unreleased',
      'under review',
      'not published',
      'https://github.com/a/b/compare/v1.0.0...HEAD',
    ]) {
      await writeFile(join(dir, 'README.md'), text);
      const result = await run(process.execPath, [script, dir]).catch((error) => error);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('README.md:1');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
