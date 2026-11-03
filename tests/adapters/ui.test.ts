import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { readUi } from '@logiparity/adapters';
import { sourceSchema, SourceError, type UiConfig } from '@logiparity/core';
import { createDemoServer } from '../../apps/demo-delivery/src/server.js';
import { collect, startServer } from '../helpers.js';

let dir: string;
let url: string;
let server: ReturnType<typeof createDemoServer>['server'];
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'logiparity-ui-'));
  const demo = createDemoServer();
  server = demo.server;
  demo.data.shipments.splice(201);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Demo has no TCP port.');
  url = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  try {
    const session = await browser.newContext();
    const page = await session.newPage();
    await page.goto(url + '/dispatcher');
    await page.getByLabel('Username', { exact: true }).fill('dispatcher');
    await page.getByLabel('Password', { exact: true }).fill('demo-password');
    await Promise.all([
      page.waitForURL('**/dispatcher*'),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await session.storageState({ path: join(dir, 'state.json') });
  } finally {
    await browser.close();
  }
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});
function config(extra: Record<string, unknown> = {}): UiConfig {
  return sourceSchema.parse({
    type: 'ui',
    url: url + '/dispatcher',
    storageState: 'state.json',
    table: 'table#shipments',
    nextPage: "button[aria-label='Next page']",
    fields: { id: { path: '[data-col=id]', label: 'Order' }, status: '[data-col=status]', payout: '[data-col=payout]' },
    ...extra,
  }) as UiConfig;
}
const context = () => ({ baseDir: dir, env: {}, reportDir: join(dir, 'report') });

describe('Playwright table adapter', () => {
  it('supports demo login, failed credentials, status/date filters and logout', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(url + '/dispatcher');
      expect(page.url()).toContain('/login');
      await page.getByLabel('Username', { exact: true }).fill('dispatcher');
      await page.getByLabel('Password', { exact: true }).fill('wrong');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      expect(await page.getByRole('alert').innerText()).toContain('Sign in failed');
      await page.getByLabel('Username', { exact: true }).fill('dispatcher');
      await page.getByLabel('Password', { exact: true }).fill('demo-password');
      await Promise.all([
        page.waitForURL('**/dispatcher*'),
        page.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
      await page.getByLabel('Status', { exact: true }).selectOption('in_transit');
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      expect((await page.locator('[data-col=status]').allInnerTexts()).every((s) => s === 'In transit')).toBe(true);
      await page.getByLabel('Date', { exact: true }).fill('1900-01-01');
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      expect(await page.locator('body').innerText()).toContain('Synthetic data exists only');
      await page.goto(url + '/dispatcher');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.goto(url + '/dispatcher');
      expect(page.url()).toContain('/login');
    } finally {
      await browser.close();
    }
    expect(
      (
        await fetch(url + '/login', {
          method: 'POST',
          headers: { origin: 'http://example.invalid' },
          body: 'username=dispatcher&password=demo-password',
        })
      ).status,
    ).toBe(403);
  });
  it('uses storageState, reads typed text cells and follows server-rendered pagination', async () => {
    const rows = await collect(readUi(config(), context()));
    expect(rows).toHaveLength(201);
    expect(rows[0]).toEqual({ id: 'S000001', status: 'In transit', payout: '$18.19' });
    expect(rows[200]?.id).toBe('S000201');
  });
  it('supports filters and snapshots without pagination', async () => {
    const options = config({ url: url + '/dispatcher?status=delivered' });
    delete options.nextPage;
    const rows = await collect(readUi(options, context()));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'Delivered')).toBe(true);
  });
  it('saves failure evidence and rejects missing table/cell selectors and pagination limits', async () => {
    for (const extra of [
      { table: 'table#missing', timeoutMs: 500 },
      { fields: { id: 'td[data-col=missing]' } },
      { maxPages: 1 },
    ]) {
      try {
        await collect(readUi(config(extra), context()));
        throw new Error('Expected a UI source error.');
      } catch (error) {
        expect(error).toBeInstanceOf(SourceError);
        const failure = error as SourceError;
        expect(failure.screenshot).toMatch(/^screenshots\/ui-/);
        expect((await readFile(join(dir, 'report', failure.screenshot ?? ''))).subarray(1, 4).toString()).toBe('PNG');
      }
    }
  });
  it('reports missing/expired auth state and keeps contexts isolated', async () => {
    await expect(collect(readUi(config({ storageState: 'absent.json' }), context()))).rejects.toThrow('storageState');
    const unauthenticated = config({ timeoutMs: 500 });
    delete unauthenticated.storageState;
    await expect(collect(readUi(unauthenticated, context()))).rejects.toThrow('login/storageState');
    expect((await collect(readUi(config(), context()))).length).toBe(201);
  });
  it('bounds non-advancing pagination and permits explicit asynchronous readiness', async () => {
    const fixture = await startServer((_, res) =>
      res.end('<table id="t"><tbody><tr><td>A</td></tr></tbody></table><button id="next">Next</button>'),
    );
    try {
      const options = config({
        url: fixture.url,
        table: '#t',
        readySelector: '#next',
        nextPage: '#next',
        fields: { id: 'td' },
        timeoutMs: 500,
      });
      delete options.storageState;
      await expect(collect(readUi(options, context()))).rejects.toThrow('rows to change');
    } finally {
      await fixture.close();
    }
  });
  it('blocks unconfigured asset origins and permits explicitly configured origins', async () => {
    let assets = 0;
    const other = await startServer((_, res) => {
      assets++;
      res.end('asset');
    });
    const fixture = await startServer((_, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(
        `<img src="${other.url}/tracking.png" onload="document.getElementById('ready').textContent='Ready'" onerror="document.getElementById('ready').textContent='Ready'"><span id="ready"></span><table id="t"><tbody><tr><td>A</td></tr></tbody></table>`,
      );
    });
    try {
      const options = config({ url: fixture.url, table: '#t', readySelector: '#ready', fields: { id: 'td' } });
      delete options.storageState;
      delete options.nextPage;
      expect(await collect(readUi(options, context()))).toEqual([{ id: 'A' }]);
      expect(assets).toBe(0);
      await collect(readUi({ ...options, allowedOrigins: [other.url] }, context()));
      expect(assets).toBe(1);
    } finally {
      await fixture.close();
      await other.close();
    }
  });
  it('does not expose saved authentication material in error messages', async () => {
    await writeFile(join(dir, 'invalid-state.json'), '{"private-token":');
    await expect(collect(readUi(config({ storageState: 'invalid-state.json' }), context()))).rejects.not.toThrow(
      'private-token',
    );
  });
  it('blocks WebSocket connections before the target server receives an upgrade', async () => {
    let upgrades = 0;
    const fixture = await startServer((_, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<table id="t"><tbody><tr><td>A</td></tr></tbody></table><span id="ready"></span><script>const socket=new WebSocket("ws://"+location.host+"/socket"); socket.onclose=()=>document.getElementById("ready").textContent="Ready";</script>',
      );
    });
    fixture.server.on('upgrade', (_, socket) => {
      upgrades++;
      socket.destroy();
    });
    try {
      const options = config({ url: fixture.url, table: '#t', readySelector: '#ready', fields: { id: 'td' } });
      delete options.nextPage;
      delete options.storageState;
      expect(await collect(readUi(options, context()))).toEqual([{ id: 'A' }]);
      expect(upgrades).toBe(0);
    } finally {
      await fixture.close();
    }
  });
});

it.each(['direct', 'chain', 'next'] as const)(
  'blocks %s UI redirects before contacting a second origin',
  async (mode) => {
    let hits = 0;
    const foreign = await startServer((_, res) => {
      hits++;
      res.setHeader('content-type', 'text/html');
      res.end('<table id="t"><tbody><tr><td>FOREIGN</td></tr></tbody></table>');
    });
    const local = await startServer((req, res) => {
      if (mode === 'next' && req.url === '/') {
        res.setHeader('content-type', 'text/html');
        res.end('<table id="t"><tbody><tr><td>A</td></tr></tbody></table><a id="next" href="/redirect">Next</a>');
        return;
      }
      res.writeHead(302, { location: mode === 'chain' && req.url === '/' ? '/redirect' : foreign.url });
      res.end();
    });
    try {
      const options = config({
        url: local.url,
        table: '#t',
        fields: { id: 'td' },
        timeoutMs: 1000,
        ...(mode === 'next' ? { nextPage: '#next' } : {}),
      });
      delete options.storageState;
      if (mode !== 'next') delete options.nextPage;
      await expect(collect(readUi(options, context()))).rejects.toThrow('allowedOrigins');
      expect(hits).toBe(0);
    } finally {
      await local.close();
      await foreign.close();
    }
  },
);
it('follows each redirect only when its destination origin is explicitly allowed', async () => {
  const foreign = await startServer((_, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<table id="t"><tbody><tr><td>ALLOWED</td></tr></tbody></table>');
  });
  const local = await startServer((_, res) => {
    res.writeHead(302, { location: foreign.url });
    res.end();
  });
  try {
    const options = config({ url: local.url, allowedOrigins: [foreign.url], table: '#t', fields: { id: 'td' } });
    delete options.storageState;
    delete options.nextPage;
    expect(await collect(readUi(options, context()))).toEqual([{ id: 'ALLOWED' }]);
  } finally {
    await local.close();
    await foreign.close();
  }
});
