import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { expect, it } from 'vitest';
it('starts the CLI demo, writes a safe example and prints export and check commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-installed-demo-'));
  const child = spawn(process.execPath, [resolve('packages/cli/dist/main.js'), 'demo', '--bugs'], {
    cwd: directory,
    env: { ...process.env, DEMO_PORT: '0' },
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  try {
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('Demo startup timed out: ' + output)), 10000);
      child.stdout.on('data', () => {
        if (output.includes('npx logiparity check')) {
          clearTimeout(timer);
          accept();
        }
      });
      child.once('error', reject);
    });
    expect(output).toContain('curl --max-time 60 --retry 3');
    expect(output).toContain('Enabled demo bugs:');
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    expect(url).toBeTruthy();
    expect((await (await fetch(url + '/health')).json()).synthetic).toBe(true);
    expect(await readFile(join(directory, 'logiparity-demo/parity.yaml'), 'utf8')).toContain(
      'allowedHosts: [127.0.0.1]',
    );
  } finally {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
    await rm(directory, { recursive: true, force: true });
  }
});
