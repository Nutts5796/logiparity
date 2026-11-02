import { afterEach, describe, expect, it } from 'vitest';
import { sourceSchema, type RestConfig } from '@logiparity/core';
import { readRest } from '@logiparity/adapters';
import { collect, startServer } from '../helpers.js';

const servers: Awaited<ReturnType<typeof startServer>>[] = [];
async function server(handler: Parameters<typeof startServer>[0]) { const s = await startServer(handler); servers.push(s); return s; }
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())); });
const context = { baseDir: '.', env: {} };
function config(baseUrl: string, extra: Record<string, unknown> = {}): RestConfig {
  const parsed = sourceSchema.parse({ type: 'rest', baseUrl, path: '/data', fields: { id: '$.id' }, retries: 0, ...extra });
  if (parsed.type !== 'rest') throw new Error('Invalid test source.');
  return parsed;
}

describe('REST adapter with local servers', () => {
  it('paginates by page, keeps configured query parameters and reads bearer/header env values', async () => {
    const seen: string[] = [];
    const { url } = await server((req, res) => {
      expect(req.headers.authorization).toBe('Bearer private-token'); expect(req.headers['x-tenant']).toBe('test-tenant');
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
      expect(query.get('date')).toBe('2026-11-02'); seen.push(query.get('page') ?? '');
      res.end(JSON.stringify({ data: query.get('page') === '1' ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }] }));
    });
    const rows = await collect(readRest(config(url, { path: '/data?date=2026-11-02', pagination: { type: 'page', size: 2 }, auth: { type: 'bearer', tokenEnv: 'TOKEN' }, headersEnv: { 'x-tenant': 'TENANT' } }), { ...context, env: { TOKEN: 'private-token', TENANT: 'test-tenant' } }));
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]); expect(seen).toEqual(['1', '2']);
  });
  it('supports offset pagination, array extraction and basic authentication', async () => {
    const offsets: string[] = [];
    const { url } = await server((req, res) => {
      expect(req.headers.authorization).toBe(`Basic ${Buffer.from('demo:password').toString('base64')}`);
      const offset = new URL(req.url ?? '/', 'http://localhost').searchParams.get('offset') ?? ''; offsets.push(offset);
      res.end(JSON.stringify({ data: offset === '0' ? [{ id: 1 }, { id: 2 }] : [] }));
    });
    const rows = await collect(readRest(config(url, { items: '$.data', auth: { type: 'basic', usernameEnv: 'USER', passwordEnv: 'PASS' }, pagination: { type: 'offset', size: 2 } }), { ...context, env: { USER: 'demo', PASS: 'password' } }));
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]); expect(offsets).toEqual(['0', '2']);
  });
  it('supports cursor pagination and stops on null', async () => {
    const { url } = await server((req, res) => {
      const cursor = new URL(req.url ?? '/', 'http://localhost').searchParams.get('cursor');
      res.end(JSON.stringify({ data: [{ id: cursor ?? 'first' }], next: cursor ? null : 'second' }));
    });
    expect(await collect(readRest(config(url, { pagination: { type: 'cursor', next: '$.next' } }), context))).toEqual([{ id: 'first' }, { id: 'second' }]);
  });
  it('follows same-origin Link headers', async () => {
    const { url } = await server((req, res) => {
      const second = req.url === '/next';
      if (!second) res.setHeader('link', '</prev>; rel="prev", </next>; rel="next"');
      res.end(JSON.stringify({ data: [{ id: second ? 2 : 1 }] }));
    });
    expect(await collect(readRest(config(url, { pagination: { type: 'link' } }), context))).toEqual([{ id: 1 }, { id: 2 }]);
  });
  it('retries 429 and 503 with bounded backoff', async () => {
    let calls = 0;
    const { url } = await server((_, res) => { calls++; res.statusCode = calls === 1 ? 429 : calls === 2 ? 503 : 200; res.setHeader('retry-after', '0'); res.end(JSON.stringify({ data: [{ id: 'ok' }] })); });
    expect(await collect(readRest(config(url, { retries: 2, backoffMs: 1 }), context))).toEqual([{ id: 'ok' }]); expect(calls).toBe(3);
  });
  it('rejects cross-origin Link targets before making a request', async () => {
    const { url } = await server((_, res) => { res.setHeader('link', '<https://example.invalid/steal>; rel="next"'); res.end('{"data":[]}'); });
    await expect(collect(readRest(config(url, { pagination: { type: 'link' } }), context))).rejects.toThrow('changes origin');
    await expect(collect(readRest(config(url, { path: 'https://example.invalid/steal' }), context))).rejects.toThrow('changes origin');
  });
  it('does not follow redirects or leak authentication', async () => {
    const { url } = await server((_, res) => { res.writeHead(302, { location: 'https://example.invalid/' }); res.end(); });
    await expect(collect(readRest(config(url), context))).rejects.toThrow('failed or timed out');
  });
  it('reports HTTP, JSON and extraction failures with page and record', async () => {
    const { url } = await server((req, res) => {
      if (req.url === '/http') { res.statusCode = 401; res.end('private response'); }
      else if (req.url === '/json') res.end('not json');
      else res.end('{"data":[{}]}');
    });
    await expect(collect(readRest(config(url, { path: '/http' }), context))).rejects.toThrow('HTTP 401');
    await expect(collect(readRest(config(url, { path: '/json' }), context))).rejects.toThrow('not valid JSON');
    await expect(collect(readRest(config(url), context))).rejects.toThrow('page 1, record 1');
    await expect(collect(readRest(config(url, { auth: { type: 'bearer', tokenEnv: 'MISSING_TOKEN' } }), context))).rejects.toThrow('MISSING_TOKEN');
  });
  it('aborts slow responses and bounds endless or repeated pagination', async () => {
    const slow = await server(() => { /* Intentionally no response, to test AbortSignal. */ });
    await expect(collect(readRest(config(slow.url, { timeoutMs: 20 }), context))).rejects.toThrow('timed out');
    const repeated = await server((_, res) => res.end('{"data":[{"id":"x"}],"next":"same"}'));
    await expect(collect(readRest(config(repeated.url, { maxPages: 2, pagination: { type: 'page', size: 1 } }), context))).rejects.toThrow('maxPages=2');
    await expect(collect(readRest(config(repeated.url, { pagination: { type: 'cursor', next: '$.next' } }), context))).rejects.toThrow('repeated');
  });
  it('streams 100,000 records page by page', async () => {
    const { url } = await server((req, res) => {
      const page = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('page'));
      const offset = (page - 1) * 1000;
      res.end(JSON.stringify({ data: offset < 100000 ? Array.from({ length: 1000 }, (_, i) => ({ id: offset + i })) : [] }));
    });
    let count = 0;
    for await (const row of readRest(config(url, { pagination: { type: 'page', size: 1000 } }), context)) { expect(row.id).toBe(count); count++; }
    expect(count).toBe(100000);
  });
});
