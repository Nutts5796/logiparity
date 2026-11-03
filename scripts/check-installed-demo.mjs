import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile);
export async function checkInstalledDemo(bin, directory) {
  await mkdir(directory, { recursive: true });
  const child = spawn(process.execPath, [bin, 'demo'], {
    cwd: directory,
    env: { ...process.env, DEMO_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  child.stdout.on('data', (chunk) => {
    text += chunk;
  });
  try {
    await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('Installed demo startup timeout: ' + text)), 10000);
      child.once('error', reject);
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Installed demo exited early'));
      });
      child.stdout.on('data', () => {
        if (text.includes('npx logiparity check')) {
          clearTimeout(timer);
          accept();
        }
      });
    });
    assert(text.includes('curl --max-time 60 --retry 3'));
    const url = text.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert(url);
    const cwd = join(directory, 'logiparity-demo');
    for (const kind of ['csv', 'xlsx']) {
      const response = await fetch(`${url}/exports/shipments.${kind}`);
      assert(response.ok);
      await writeFile(join(cwd, `shipments.${kind}`), new Uint8Array(await response.arrayBuffer()));
    }
    await run(process.execPath, [bin, 'validate', '--config', 'parity.yaml'], { cwd });
    await run(process.execPath, [bin, 'check', '--config', 'parity.yaml'], { cwd });
    const report = JSON.parse(await readFile(join(cwd, 'report/report.json'), 'utf8'));
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.entities[0].counts, { api: 2750, export: 2750, csv: 2750 });
  } finally {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  }
}
