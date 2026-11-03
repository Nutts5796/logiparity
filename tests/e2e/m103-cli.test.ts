import { expect, it } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../helpers.js';
import { parseCheckedJson } from '../../scripts/validate-report.mjs';
const run = promisify(execFile),
  cli = resolve('packages/cli/dist/main.js');
it('locates bad URLs without a peer-install trailer and prints real report paths after writing (Crowd9)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-cli-'));
  try {
    const source = { type: 'csv', file: 'a.csv', fields: { id: 'ID' } };
    const config = {
      version: 1,
      entities: [
        {
          name: 'order',
          key: 'id',
          sources: { api: { type: 'rest', baseUrl: 'broken URL', path: '/', fields: { id: '$.id' } }, export: source },
        },
      ],
      report: { outputs: ['console', 'html', 'json'], dir: './report' },
    };
    const file = join(dir, 'parity.yaml');
    await writeFile(file, JSON.stringify(config));
    const invalid = await run(process.execPath, [cli, 'validate', '--config', file]).catch((error) => error);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain('entities[0].sources.api.baseUrl');
    expect(invalid.stderr).not.toContain('install the named optional');
    Object.assign(config.entities[0]!, { sources: { api: source, export: { ...source, file: 'b.csv' } } });
    await writeFile(file, JSON.stringify(config));
    await writeFile(join(dir, 'a.csv'), 'ID\n' + Array.from({ length: 15 }, (_, i) => 'O' + i).join('\n') + '\n');
    await writeFile(join(dir, 'b.csv'), 'ID\n');
    const checked = await run(process.execPath, [cli, 'check', '--config', file]).catch((error) => error);
    expect(checked.code).toBe(1);
    expect(checked.stdout).toContain('Full report:');
    expect(checked.stdout).toContain('report.html');
    expect(checked.stdout).not.toContain('Write the complete report with');
    expect(parseCheckedJson(await readFile(join(dir, 'report/report.json'), 'utf8')).findings).toHaveLength(15);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('names an unreachable scenario target and its configuration file (Crowd9 Maria E)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-unreachable-'));
  try {
    await cp('examples/demo/scenarios/02-vehicle-breakdown.yaml', join(dir, 'scenario.yaml'));
    await cp('examples/demo/scenarios/fixtures', join(dir, 'fixtures'), { recursive: true });
    const endpoint = await startServer((_, res) => res.end());
    await endpoint.close();
    let target = await readFile('examples/demo/target.yaml', 'utf8');
    target = target.replaceAll('${DEMO_API_URL}', endpoint.url);
    await writeFile(join(dir, 'stale-target.yaml'), target);
    await writeFile(
      join(dir, 'scenario.yaml'),
      (await readFile(join(dir, 'scenario.yaml'), 'utf8')).replace(/afterwards:[\s\S]*/, ''),
    );
    const result = await run(
      process.execPath,
      [cli, 'scenario', 'run', 'scenario.yaml', '--target', 'stale-target.yaml', '--report-dir', 'report'],
      { cwd: dir },
    ).catch((error) => error);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('Target unreachable');
    expect(result.stdout).toContain('Target demo is unreachable (stale-target.yaml)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('ai explain accepts the real demo --bugs report rather than only a static sample (Crowd9 Sam)', async () => {
  const { spawn } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-demo-ai-'));
  const child = spawn(process.execPath, [cli, 'demo', '--bugs'], {
    cwd: dir,
    env: { ...process.env, DEMO_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  child.stdout.on('data', (chunk) => {
    text += chunk;
  });
  try {
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(() => reject(Error('Demo startup timeout')), 10000);
      child.once('error', reject);
      child.stdout.on('data', () => {
        if (text.includes('npx logiparity check')) {
          clearTimeout(timer);
          accept();
        }
      });
    });
    const url = text.match(/http:\/\/127\.0\.0\.1:\d+/)![0],
      cwd = join(dir, 'logiparity-demo');
    for (const type of ['csv', 'xlsx']) {
      const response = await fetch(url + '/exports/shipments.' + type);
      expect(response.ok).toBe(true);
      await writeFile(join(cwd, 'shipments.' + type), new Uint8Array(await response.arrayBuffer()));
    }
    const check = await run(process.execPath, [cli, 'check', '--config', 'parity.yaml'], { cwd }).catch(
      (error) => error,
    );
    expect(check.code).toBe(1);
    const file = join(cwd, 'report/report.json');
    expect(parseCheckedJson(await readFile(file, 'utf8')).findings).toHaveLength(3741);
    const explanation = await run(process.execPath, [cli, 'ai', 'explain', file], { maxBuffer: 1024 * 1024 });
    expect(explanation.stdout).toContain('local only; nothing sent');
    expect(explanation.stdout).toContain('3741');
  } finally {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
