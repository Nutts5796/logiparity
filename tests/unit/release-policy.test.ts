import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
it('keeps release authority separate and only publishes npm on tag pushes', async () => {
  const release = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  expect(release.permissions).toEqual({});
  expect(release.concurrency.group).toBe('release-${{ inputs.tag || github.ref_name }}');
  expect(release.jobs.build.permissions).toEqual({});
  expect(release.jobs.npm.permissions).toEqual({ 'id-token': 'write' });
  expect(release.jobs.npm.if).toBe("github.event_name == 'push'");
  expect(release.jobs.notes.needs).toContain('images');
  for (const job of Object.values(release.jobs) as { steps: { uses?: string; with?: Record<string, unknown> }[] }[])
    for (const step of job.steps) {
      if (step.uses?.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials']).toBe(false);
      if (step.uses?.startsWith('actions/setup-node@')) {
        expect(step.with?.['node-version']).toMatch(/^\d+\.\d+\.\d+$/);
        expect(step.with?.cache).toBeUndefined();
      }
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    }
  const source = await readFile('scripts/release-build.mjs', 'utf8');
  expect(source.indexOf('if (release)')).toBeLessThan(source.indexOf("['ci', '--ignore-scripts']"));
});
it('runs all supported Node majors and leaves consuming GitLab stages intact', async () => {
  const ci = parse(await readFile('.github/workflows/ci.yml', 'utf8'));
  expect(ci.jobs.verify.strategy.matrix.node).toEqual([20, 22, 24]);
  expect(ci.on.push.branches).toEqual(['main']);
  const gitlab = parse(await readFile('templates/gitlab-ci.yml', 'utf8'));
  expect(gitlab.stages).toBeUndefined();
  expect(gitlab['.logiparity']).toBeTruthy();
  for (const file of ['templates/github-actions.yml', 'templates/github-actions-container.yml']) {
    const template = parse(await readFile(file, 'utf8'));
    expect(template.on.schedule).toEqual([{ cron: '0 3 * * *' }]);
    expect(template.jobs.parity.steps.some((step: { run?: string }) => step.run?.includes('GITHUB_STEP_SUMMARY'))).toBe(
      true,
    );
  }
});
