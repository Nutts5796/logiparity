import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { startServer } from '../helpers.js';
import { parseCheckedJson } from '../../scripts/validate-report.mjs';
const execute = promisify(execFile),
  cli = resolve('packages/cli/dist/main.js');
it('runs every offline FMCSA repro through validate/check with strict and feature configurations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m11-cli-'));
  const server = await startServer(async (_, res) =>
    res.end(await readFile(join(dir, '1-missing-json-property/www/items.json'))),
  );
  const run = (command: string, config: string) =>
    execute(process.execPath, [cli, command, '--config', config], { maxBuffer: 1024 * 1024 }).then(
      (r) => ({ ...r, code: 0 }),
      (error: { stdout: string; stderr: string; code: number }) => error,
    );
  try {
    await cp('tests/fixtures/m11', dir, { recursive: true });
    for (const name of ['1-missing-json-property', '2-date-only', '3-number-as-vocabulary']) {
      const file = join(dir, name, 'parity.yaml');
      const config = parse(await readFile(file, 'utf8'));
      config.report = { outputs: ['console', 'json', 'html', 'markdown', 'junit'], dir: './out' };
      if (name.startsWith('1-')) {
        config.entities[0].sources.api.baseUrl = server.url;
        await writeFile(file, JSON.stringify(config));
        expect((await run('validate', file)).code).toBe(0);
        const strict = await run('check', file);
        expect(strict.code).toBe(2);
        expect(strict.stdout + strict.stderr).toContain('absentAsNull');
        config.entities[0].sources.api.fields.name = { path: '$.name', missing: null };
      } else if (name.startsWith('2-')) {
        await writeFile(file, JSON.stringify(config));
        const invalid = await run('validate', file);
        expect(invalid.code).toBe(2);
        expect(invalid.stderr).toContain('type: date');
        config.entities[0].compare.d = { type: 'date', format: { a: 'yyyyMMdd', b: 'dd-MMM-yy' } };
      } else {
        config.entities[0].aggregates = [{ name: 'total_units', type: 'sum', field: 'units' }];
      }
      await writeFile(file, JSON.stringify(config));
      expect((await run('validate', file)).code).toBe(0);
      const checked = await run('check', file);
      expect(checked.code).toBe(name.startsWith('3-') ? 1 : 0);
      const report = parseCheckedJson(await readFile(join(dir, name, 'out/report.json'), 'utf8'));
      if (name.startsWith('3-')) {
        expect(report.groups[0]).toMatchObject({ kind: 'number_change', expected: 1, actual: 2, count: 3 });
        expect(report.entities[0].aggregates[0].reconciliation.b.remainder).toBe('0');
        expect(checked.stdout).not.toContain('Likely a different vocabulary');
      } else expect(report.findings).toEqual([]);
    }
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
