import { afterEach, expect, it, vi } from 'vitest';
import { sourceSchema } from '@logiparity/core';
import { readRest, readSql } from '@logiparity/adapters';
import { collect } from '../helpers.js';
afterEach(() => vi.unstubAllGlobals());
it('refuses redirects once, naming status and destination host (sam)', async () => {
  const fetch = vi.fn(
    async () => new Response('', { status: 302, headers: { location: 'http://blocked.test/private' } }),
  );
  vi.stubGlobal('fetch', fetch);
  const config = sourceSchema.parse({
    type: 'rest',
    baseUrl: 'http://allowed.test',
    path: '/x',
    fields: { id: '$.id' },
    backoffMs: 1,
  });
  if (config.type !== 'rest') throw new Error('fixture');
  await expect(collect(readRest(config, { baseDir: '.', env: {} }))).rejects.toThrow(
    'redirect refused: 302 to blocked.test',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('stops reading a streamed REST body at maxResponseBytes (sam)', async () => {
  let reads = 0;
  const body = new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(1024));
      if (reads === 100) controller.close();
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body)),
  );
  const config = sourceSchema.parse({
    type: 'rest',
    baseUrl: 'http://allowed.test',
    path: '/x',
    fields: { id: '$.id' },
    maxResponseBytes: 2048,
  });
  if (config.type !== 'rest') throw new Error('fixture');
  await expect(collect(readRest(config, { baseDir: '.', env: {} }))).rejects.toThrow('maxResponseBytes');
  expect(reads).toBeLessThan(10);
});
it.each(['host', 'hostaddr', 'port'])(
  'refuses a PostgreSQL %s query override before connecting (sam)',
  async (name) => {
    const config = sourceSchema.parse({
      type: 'sql',
      connectionEnv: 'DB',
      query: 'SELECT id FROM orders',
      fields: { id: 'id' },
      timeoutMs: 1,
    });
    if (config.type !== 'sql') throw new Error('fixture');
    await expect(
      collect(
        readSql(config, {
          baseDir: '.',
          env: { DB: `postgres://qa:pw@allowed.test/db?${name}=127.0.0.1` },
          allowedHosts: ['allowed.test'],
        }),
      ),
    ).rejects.toThrow('cannot override');
  },
);
