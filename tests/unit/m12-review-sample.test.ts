import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'csv-parse/sync';
const run = promisify(execFile);
it('reproduces the untouched 50-group sample, keeps verdicts empty and refuses overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m12-review-'));
  try {
    const file = join(dir, 'review.csv');
    await run(process.execPath, [resolve('scripts/sample-fmcsa-groups.mjs'), '--output', file]);
    expect(await readFile(file, 'utf8')).toBe(await readFile('docs/evaluation/fmcsa-sample-for-review.csv', 'utf8'));
    const rows = parse(await readFile(file, 'utf8'), { columns: true }) as Record<string, string>[];
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.reviewer_verdict === '' && r.reviewer_note === '')).toBe(true);
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(['IA', 'VT']));
    await expect(
      run(process.execPath, [resolve('scripts/sample-fmcsa-groups.mjs'), '--output', file]),
    ).rejects.toMatchObject({ code: 1 });
    const result = await run(process.execPath, [resolve('scripts/summarize-cause-review.mjs'), file]);
    expect(JSON.parse(result.stdout).realDataAccuracy).toContain('not measured');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('summarizes only human-entered verdicts and rejects unknown verdicts (synthetic test CSV)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m12-verdict-'));
  try {
    const file = join(dir, 'synthetic.csv');
    await writeFile(file, 'sample_id,reviewer_verdict,reviewer_note\n1,correct,test\n2,wrong,test\n');
    const result = JSON.parse(
      (await run(process.execPath, [resolve('scripts/summarize-cause-review.mjs'), file])).stdout,
    );
    expect(result).toMatchObject({ correct: 1, wrong: 1, realDataAccuracy: 0.5 });
    await writeFile(file, 'sample_id,reviewer_verdict\n1,probably\n');
    await expect(run(process.execPath, [resolve('scripts/summarize-cause-review.mjs'), file])).rejects.toMatchObject({
      code: 1,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
