import { parseCheckedJson } from '../../scripts/validate-report.mjs';
import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { deterministicArchive } from '../../scripts/deterministic-tar.mjs';
const run = promisify(execFile);
it('keeps write authority in a small lookup job and never attests downloaded release assets (ana)', async () => {
  const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  expect(workflow.jobs.lookup.permissions.contents).toBe('write');
  expect(workflow.jobs.build.permissions.contents).toBe('read');
  expect(workflow.jobs.build.needs).toContain('lookup');
  expect(workflow.jobs.build.needs).toContain('verify');
  expect(workflow.jobs.attest.if).toContain('reused');
  const prepare = workflow.jobs.build.steps.find((step: { run?: string }) =>
    step.run?.includes('node scripts/release-build.mjs'),
  );
  expect(prepare.env?.GH_TOKEN).toBeUndefined();
  expect(workflow.jobs.lookup.steps.some((step: { run?: string }) => /npm|node scripts/.test(step.run ?? ''))).toBe(
    false,
  );
});
it('removes release credentials from npm subprocesses even if supplied by the parent (ana fakenpm)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m102-release-env-'));
  try {
    await mkdir(join(dir, 'bin'));
    await mkdir(join(dir, 'output/release'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.1.0', type: 'module' }));
    await writeFile(join(dir, 'output/release/release-metadata.json'), '{}');
    await writeFile(
      join(dir, 'bin/gh'),
      `#!${process.execPath}\nconsole.error('release not found');process.exitCode=1;`,
      { mode: 0o755 },
    );
    await writeFile(
      join(dir, 'bin/npm'),
      `#!${process.execPath}\nimport fs from 'node:fs';fs.appendFileSync(process.env.CALL_LOG,JSON.stringify({args:process.argv.slice(2),gh:process.env.GH_TOKEN,github:process.env.GITHUB_TOKEN,npm:process.env.NODE_AUTH_TOKEN})+'\\n');`,
      { mode: 0o755 },
    );
    const log = join(dir, 'calls.jsonl');
    await run(process.execPath, [resolve('scripts/release-build.mjs')], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: join(dir, 'bin') + ':' + process.env.PATH,
        TAG: 'v1.1.0',
        GH_TOKEN: 'synthetic-release-token',
        GITHUB_TOKEN: 'synthetic-github-token',
        NODE_AUTH_TOKEN: 'synthetic-npm-token',
        CALL_LOG: log,
      },
    });
    const calls = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => parseCheckedJson(line));
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.gh).toBeUndefined();
      expect(call.github).toBeUndefined();
      expect(call.npm).toBeUndefined();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('bumps only package identities and explicit install settings in a scratch 1.2.0 release (ana)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m102-bump-'));
  try {
    for (const folder of ['scripts', 'packages/core', 'packages/cli/src', 'apps', 'docs', 'templates'])
      await mkdir(join(dir, folder), { recursive: true });
    await cp('scripts/bump-version.mjs', join(dir, 'scripts/bump-version.mjs'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ version: '1.1.0', dependencies: { '@logiparity/core': '1.1.0' } }),
    );
    for (const name of ['core', 'cli'])
      await writeFile(
        join(dir, `packages/${name}/package.json`),
        JSON.stringify({ name: `@logiparity/${name}`, version: '1.1.0' }),
      );
    await writeFile(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        version: '1.1.0',
        packages: {
          '': { version: '1.1.0' },
          'packages/core': { version: '1.1.0' },
          'packages/cli': { version: '1.1.0' },
        },
      }),
    );
    const history = '1.0.1 was never published; its notes were folded into 1.1.0.\n';
    await writeFile(join(dir, 'README.md'), history + 'npm install --save-dev --save-exact logiparity@1.1.0\n');
    await writeFile(join(dir, 'docs/release.md'), history);
    for (const name of ['github-actions.yml', 'github-actions-container.yml', 'gitlab-ci.yml'])
      await writeFile(join(dir, 'templates', name), history + "LOGIPARITY_VERSION: '1.1.0'\n");
    await run(process.execPath, [join(dir, 'scripts/bump-version.mjs'), '1.2.0']);
    expect(await readFile(join(dir, 'docs/release.md'), 'utf8')).toBe(history);
    expect(await readFile(join(dir, 'README.md'), 'utf8')).toBe(
      history + 'npm install --save-dev --save-exact logiparity@1.2.0\n',
    );
    expect(parseCheckedJson(await readFile(join(dir, 'package.json'), 'utf8')).version).toBe('1.2.0');
    expect(
      parseCheckedJson(await readFile(join(dir, 'package-lock.json'), 'utf8')).packages['packages/core'].version,
    ).toBe('1.2.0');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('uses a platform-independent gzip OS header and rejects foreign GitLab image repositories (ana, sam)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m102-gzip-'));
  try {
    await mkdir(join(dir, 'kit'));
    await writeFile(join(dir, 'kit/file'), 'same bytes');
    await deterministicArchive(join(dir, 'kit'), 'kit', join(dir, 'kit.tgz'));
    expect((await readFile(join(dir, 'kit.tgz')))[9]).toBe(255);
    const template = await readFile('templates/gitlab-ci.yml', 'utf8');
    expect(template).toContain('^ghcr\\.io\\/nutts5796\\/logiparity:');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
