import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
it('accepts only the current development changelog heading locally and blocks it before publication', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m11-release-'));
  const script = resolve('scripts/check-release-text.mjs');
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.2.0', files: ['CHANGELOG.md'] }));
    await writeFile(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.0] - Unreleased\n');
    await expect(run(process.execPath, [script, dir])).resolves.toBeDefined();
    await expect(run(process.execPath, [script, dir, '--publication'])).rejects.toMatchObject({ code: 1 });
    for (const text of ['## [1.3.0] - Unreleased', 'Unreleased', '## [1.2.0] - Unreleased extra', 'under review']) {
      await writeFile(join(dir, 'CHANGELOG.md'), text);
      await expect(run(process.execPath, [script, dir])).rejects.toMatchObject({ code: 1 });
    }
    await writeFile(join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-11-08\n');
    await expect(run(process.execPath, [script, dir, '--publication'])).resolves.toBeDefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
