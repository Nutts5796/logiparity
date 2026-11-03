import { afterEach, describe, expect, it } from 'vitest';
import { sourceSchema, type RestConfig } from '@logiparity/core';
import { readRest } from '@logiparity/adapters';
import { collect, startServer } from '../helpers.js';

const servers: Awaited<ReturnType<typeof startServer>>[] = [];
async function server(handler: Parameters<typeof startServer>[0]) {
  const s = await startServer(handler);
  servers.push(s);
  return s;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
const context = { baseDir: '.', env: {} };
function config(baseUrl: string, extra: Record<string, unknown> = {}): RestConfig {
  const parsed = sourceSchema.parse({
    type: 'rest',
    baseUrl,
    path: '/data',
    fields: { id: '$.id' },
    retries: 0,
    ...extra,
  });
  if (parsed.type !== 'rest') throw new Error('Invalid test source.');
  return parsed;
}

describe('REST adapter with local servers', () => {
  it('paginates by page, keeps configured query parameters and reads bearer/header env values', async () => {
    const seen: string[] = [];
    const { url } = await server((req, res) => {
      expect(req.headers.authorization).toBe('Bearer private-token');
      expect(req.headers['x-tenant']).toBe('test-tenant');
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
      expect(query.get('date')).toBe('2026-11-02');
      seen.push(query.get('page') ?? '');
      res.end(JSON.stringify({ data: query.get('page') === '1' ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }] }));
    });
    const rows = await collect(
      readRest(
        config(url, {
          path: '/data?date=2026-11-02',
          pagination: { type: 'page', size: 2 },
          auth: { type: 'bearer', tokenEnv: 'TOKEN' },
          headersEnv: { 'x-tenant': 'TENANT' },
        }),
        { ...context, env: { TOKEN: 'private-token', TENANT: 'test-tenant' } },
      ),
    );
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(seen).toEqual(['1', '2']);
  });
  it('supports offset pagination, array extraction and basic authentication', async () => {
    const offsets: string[] = [];
    const { url } = await server((req, res) => {
      expect(req.headers.authorization).toBe(`Basic ${Buffer.from('demo:password').toString('base64')}`);
      const offset = new URL(req.url ?? '/', 'http://localhost').searchParams.get('offset') ?? '';
      offsets.push(offset);
      res.end(JSON.stringify({ data: offset === '0' ? [{ id: 1 }, { id: 2 }] : [] }));
    });
    const rows = await collect(
      readRest(
        config(url, {
          items: '$.data',
          auth: { type: 'basic', usernameEnv: 'USER', passwordEnv: 'PASS' },
          pagination: { type: 'offset', size: 2 },
        }),
        { ...context, env: { USER: 'demo', PASS: 'password' } },
      ),
    );
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(offsets).toEqual(['0', '2']);
  });
  it('supports cursor pagination and stops on null', async () => {
    const { url } = await server((req, res) => {
      const cursor = new URL(req.url ?? '/', 'http://localhost').searchParams.get('cursor');
      res.end(JSON.stringify({ data: [{ id: cursor ?? 'first' }], next: cursor ? null : 'second' }));
    });
    expect(await collect(readRest(config(url, { pagination: { type: 'cursor', next: '$.next' } }), context))).toEqual([
      { id: 'first' },
      { id: 'second' },
    ]);
  });
  it('follows same-origin Link headers', async () => {
    const { url } = await server((req, res) => {
      const second = req.url === '/next';
      if (!second) res.setHeader('link', '</prev>; rel="prev", </next>; rel="next"');
      res.end(JSON.stringify({ data: [{ id: second ? 2 : 1 }] }));
    });
    expect(await collect(readRest(config(url, { pagination: { type: 'link' } }), context))).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });
  it('retries 429 and 503 with bounded backoff', async () => {
    let calls = 0;
    const { url } = await server((_, res) => {
      calls++;
      res.statusCode = calls === 1 ? 429 : calls === 2 ? 503 : 200;
      res.setHeader('retry-after', '0');
      res.end(JSON.stringify({ data: [{ id: 'ok' }] }));
    });
    expect(await collect(readRest(config(url, { retries: 2, backoffMs: 1 }), context))).toEqual([{ id: 'ok' }]);
    expect(calls).toBe(3);
  });
  it('rejects cross-origin Link targets before making a request', async () => {
    const { url } = await server((_, res) => {
      res.setHeader('link', '<https://example.invalid/steal>; rel="next"');
      res.end('{"data":[]}');
    });
    await expect(collect(readRest(config(url, { pagination: { type: 'link' } }), context))).rejects.toThrow(
      'changes origin',
    );
    await expect(collect(readRest(config(url, { path: 'https://example.invalid/steal' }), context))).rejects.toThrow(
      'changes origin',
    );
  });
  it('does not follow redirects or leak authentication', async () => {
    const { url } = await server((_, res) => {
      res.writeHead(302, { location: 'https://example.invalid/' });
      res.end();
    });
    await expect(collect(readRest(config(url), context))).rejects.toThrow('failed or timed out');
  });
  it('reports HTTP, JSON and extraction failures with page and record', async () => {
    const { url } = await server((req, res) => {
      if (req.url === '/http') {
        res.statusCode = 401;
        res.end('private response');
      } else if (req.url === '/json') res.end('not json');
      else res.end('{"data":[{}]}');
    });
    await expect(collect(readRest(config(url, { path: '/http' }), context))).rejects.toThrow('HTTP 401');
    await expect(collect(readRest(config(url, { path: '/json' }), context))).rejects.toThrow('not valid JSON');
    await expect(collect(readRest(config(url), context))).rejects.toThrow('page 1, record 1');
    await expect(
      collect(readRest(config(url, { auth: { type: 'bearer', tokenEnv: 'MISSING_TOKEN' } }), context)),
    ).rejects.toThrow('MISSING_TOKEN');
  });
  it('aborts slow responses and bounds endless or repeated pagination', async () => {
    const slow = await server(() => {
      /* Intentionally no response, to test AbortSignal. */
    });
    await expect(collect(readRest(config(slow.url, { timeoutMs: 20 }), context))).rejects.toThrow('timed out');
    const repeated = await server((_, res) => res.end('{"data":[{"id":"x"}],"next":"same"}'));
    await expect(
      collect(readRest(config(repeated.url, { maxPages: 2, pagination: { type: 'page', size: 1 } }), context)),
    ).rejects.toThrow('maxPages=2');
    await expect(
      collect(readRest(config(repeated.url, { pagination: { type: 'cursor', next: '$.next' } }), context)),
    ).rejects.toThrow('repeated');
  });
  it('streams 100,000 records page by page', async () => {
    const { url } = await server((req, res) => {
      const page = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('page'));
      const offset = (page - 1) * 1000;
      res.end(
        JSON.stringify({ data: offset < 100000 ? Array.from({ length: 1000 }, (_, i) => ({ id: offset + i })) : [] }),
      );
    });
    let count = 0;
    for await (const row of readRest(config(url, { pagination: { type: 'page', size: 1000 } }), context)) {
      expect(row.id).toBe(count);
      count++;
    }
    expect(count).toBe(100000);
  });
});

describe('pagination completion signals', () => {
  it.each(['page', 'offset'] as const)(
    'rejects a capped %s page with every supported completion signal',
    async (type) => {
      const { url } = await server((_, res) =>
        res.end(JSON.stringify({ data: [{ id: 'a' }], total: 3, pages: 3, more: true })),
      );
      for (const signal of [{ totalPath: '$.total' }, { totalPagesPath: '$.pages' }, { hasMorePath: '$.more' }]) {
        await expect(
          collect(readRest(config(url, { pagination: { type, size: 2, ...signal } }), context)),
        ).rejects.toThrow(/page 1.*requested size 2, received 1.*more pages/);
      }
    },
  );
  it.each(['page', 'offset'] as const)('stops a full final %s page without probing an extra page', async (type) => {
    let calls = 0;
    const { url } = await server((_, res) => {
      calls++;
      res.end(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }], total: 2, pages: 1, more: false }));
    });
    expect(
      await collect(
        readRest(
          config(url, {
            pagination: { type, size: 2, totalPath: '$.total', totalPagesPath: '$.pages', hasMorePath: '$.more' },
          }),
          context,
        ),
      ),
    ).toHaveLength(2);
    expect(calls).toBe(1);
  });
  it.each(['page', 'offset'] as const)(
    'allows a short final %s page when metadata confirms completion',
    async (type) => {
      let calls = 0;
      const { url } = await server((_, res) => {
        calls++;
        res.end(JSON.stringify({ data: calls === 1 ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }], total: 3 }));
      });
      expect(
        await collect(readRest(config(url, { pagination: { type, size: 2, totalPath: '$.total' } }), context)),
      ).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      expect(calls).toBe(2);
    },
  );
  it('supports zero-based pages and flags a later short page that still advertises more', async () => {
    const seen: string[] = [];
    const { url } = await server((req, res) => {
      const page = new URL(req.url!, 'http://localhost').searchParams.get('page')!;
      seen.push(page);
      res.end(JSON.stringify({ data: page === '0' ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }], total: 5 }));
    });
    await expect(
      collect(
        readRest(config(url, { pagination: { type: 'page', start: 0, size: 2, totalPath: '$.total' } }), context),
      ),
    ).rejects.toThrow(/page 2.*requested size 2, received 1/);
    expect(seen).toEqual(['0', '1']);
  });
  it('rejects oversized pages, invalid counts, missing paths and inconsistent signals', async () => {
    const { url } = await server((_, res) =>
      res.end(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }], total: 3, pages: 1, text: '3', more: 'true' })),
    );
    await expect(collect(readRest(config(url, { pagination: { type: 'page', size: 1 } }), context))).rejects.toThrow(
      /requested size 1, received 2/,
    );
    for (const signal of [
      { totalPath: '$.text' },
      { hasMorePath: '$.more' },
      { totalPagesPath: '$.missing' },
      { totalPath: '$.total', totalPagesPath: '$.pages' },
    ])
      await expect(
        collect(readRest(config(url, { pagination: { type: 'offset', size: 2, ...signal } }), context)),
      ).rejects.toThrow();
    await expect(
      collect(readRest(config(url, { pagination: { type: 'page', size: 2, totalPath: '$.pages' } }), context)),
    ).rejects.toThrow('exceed advertised');
  });
  it('keeps an unverified short first page and emits exactly one actionable warning', async () => {
    const messages: string[] = [];
    const { url } = await server((_, res) => res.end('{"data":[{"id":"a"}]}'));
    expect(
      await collect(
        readRest(config(url, { pagination: { type: 'page', size: 200, allowShortFirstPage: true } }), {
          ...context,
          warn: (message) => messages.push(message),
        }),
      ),
    ).toEqual([{ id: 'a' }]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('totalPath, totalPagesPath or hasMorePath');
  });
});

it.each(['page', 'offset'] as const)('rejects an unverified short first %s page by default', async (type) => {
  const { url } = await server((_, res) => res.end('{"data":[{"id":"a"}]}'));
  await expect(collect(readRest(config(url, { pagination: { type, size: 200 } }), context))).rejects.toThrow(
    'totalPath, totalPagesPath or hasMorePath',
  );
});
it.each(['full', 'prefix'] as const)('reads an environment header using the %s form', async (mode) => {
  const { url } = await server((req, res) => {
    expect(req.headers.authorization).toBe('Bearer shared-header-token');
    res.end('{"data":[{"id":"L1"}]}');
  });
  const authorization = mode === 'prefix' ? { env: 'TOKEN', prefix: 'Bearer ' } : 'TOKEN';
  const rows = await collect(
    readRest(config(url, { headersEnv: { Authorization: authorization } }), {
      ...context,
      env: { TOKEN: mode === 'prefix' ? 'shared-header-token' : 'Bearer shared-header-token' },
    }),
  );
  expect(rows).toEqual([{ id: 'L1' }]);
});
