import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUi } from '@logiparity/adapters';
import { sourceSchema, type UiConfig, SourceError } from '@logiparity/core';
import { loginDemo } from '../../packages/cli/src/browser.js';
import { startServer, collect } from '../helpers.js';
it('applies report.fileMode to UI failure evidence (Crowd9 Sam N7)', async () => {
  const server = await startServer((_, res) => res.end('<p>No table</p>'));
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-ui-'));
  try {
    const config = sourceSchema.parse({
      type: 'ui',
      url: server.url,
      table: '#missing',
      fields: { id: 'td' },
      timeoutMs: 100,
    }) as UiConfig;
    try {
      await collect(readUi(config, { baseDir: dir, env: {}, reportDir: dir, fileMode: 0o640 }));
      throw Error('expected missing table');
    } catch (error) {
      expect(error).toBeInstanceOf(SourceError);
      const screenshot = (error as SourceError).screenshot;
      expect(screenshot).toBeTruthy();
      expect((await stat(join(dir, screenshot!))).mode & 0o777).toBe(0o640);
    }
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
it('gives an actionable renewal hint after a login redirect (Crowd9 Karen/Maria)', async () => {
  const server = await startServer((req, res) => {
    if (req.url !== '/login') {
      res.writeHead(302, { location: '/login' });
      res.end();
    } else res.end('<h1>Sign in</h1>');
  });
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-login-'));
  try {
    await writeFile(join(dir, 'state.json'), '{}');
    const config = sourceSchema.parse({
      type: 'ui',
      url: server.url + '/dispatcher',
      storageState: 'state.json',
      table: '#shipments',
      fields: { id: 'td' },
      timeoutMs: 100,
    }) as UiConfig;
    await expect(collect(readUi(config, { baseDir: dir, env: {}, reportDir: dir }))).rejects.toThrow(
      'Run npx logiparity demo login again',
    );
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
it('asks to start the demo instead of printing raw Playwright navigation text (Crowd9 Maria)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-stopped-'));
  await mkdir(join(dir, 'logiparity-demo'));
  await writeFile(join(dir, 'logiparity-demo/.service.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:9' }));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  try {
    await expect(loginDemo()).rejects.toThrow(/Start.*demo|start.*demo/);
  } finally {
    cwd.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
