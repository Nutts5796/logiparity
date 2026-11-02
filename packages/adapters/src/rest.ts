import { setTimeout as delay } from 'node:timers/promises';
import type { AdapterContext, DataRow, RestConfig } from '@logiparity/core';
import { selectJson, selectOne } from './jsonpath.js';

function environment(name: string, env: NodeJS.ProcessEnv): string {
  const value = Object.hasOwn(env, name) ? env[name] : undefined;
  if (!value) throw new Error(`Environment variable ${name} is missing or empty; set it for this source.`);
  return value;
}

function safeUrl(input: string, base: URL): URL {
  const url = new URL(input, base);
  if (url.origin !== base.origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('Request URL changes origin or contains credentials; use a same-origin path and environment-based auth.');
  return url;
}

async function getPage(url: URL, config: RestConfig, headers: Headers): Promise<{ body: unknown; link: string | null }> {
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs) });
    } catch {
      if (attempt < config.retries) { await delay(config.backoffMs * 2 ** attempt); continue; }
      throw new Error(`GET ${url.origin}${url.pathname} failed or timed out after ${config.retries + 1} attempts; check connectivity, redirects and timeoutMs.`);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < config.retries) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const waitMs = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
      await response.body?.cancel();
      await delay(Math.min(30000, Math.max(0, waitMs, config.backoffMs * 2 ** attempt)));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GET ${url.origin}${url.pathname} returned HTTP ${response.status}; check authentication, path and server health.`);
    }
    try { return { body: await response.json() as unknown, link: response.headers.get('link') }; }
    catch { throw new Error(`GET ${url.origin}${url.pathname}: response is not valid JSON or body read timed out; check the endpoint and timeoutMs.`); }
  }
  throw new Error('REST retry limit exhausted; check server availability.');
}

export async function* readRest(config: RestConfig, context: AdapterContext): AsyncIterable<DataRow> {
  const base = new URL(config.baseUrl);
  let url = safeUrl(config.path, base);
  const headers = new Headers({ accept: 'application/json', ...config.headers });
  for (const [header, name] of Object.entries(config.headersEnv)) headers.set(header, environment(name, context.env));
  if (config.auth?.type === 'bearer') headers.set('authorization', `Bearer ${environment(config.auth.tokenEnv, context.env)}`);
  if (config.auth?.type === 'basic') headers.set('authorization', `Basic ${Buffer.from(`${environment(config.auth.usernameEnv, context.env)}:${environment(config.auth.passwordEnv, context.env)}`).toString('base64')}`);
  const pagination = config.pagination;
  let position = pagination?.type === 'page' ? pagination.start : 0;
  const visited = new Set<string>();
  for (let page = 0; page < config.maxPages; page++) {
    if (pagination && pagination.type !== 'link') url.searchParams.set(pagination.sizeParam, String(pagination.size));
    if (pagination?.type === 'page') url.searchParams.set(pagination.pageParam, String(position));
    if (pagination?.type === 'offset') url.searchParams.set(pagination.offsetParam, String(position));
    if (visited.has(url.href)) throw new Error('Pagination repeated a URL or cursor; fix the next-page configuration.');
    visited.add(url.href);
    const { body, link } = await getPage(url, config, headers);
    const selected = selectJson(body, config.items);
    const items: unknown[] = selected.length === 1 && Array.isArray(selected[0]) ? selected[0] as unknown[] : selected;
    for (let index = 0; index < items.length; index++) {
      try { yield Object.fromEntries(Object.entries(config.fields).map(([field, path]) => [field, selectOne(items[index], path)])); }
      catch (error) { throw new Error(`REST page ${page + 1}, record ${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!pagination) return;
    if (pagination.type === 'page' || pagination.type === 'offset') {
      if (items.length < pagination.size) return;
      position += pagination.type === 'page' ? 1 : pagination.size;
    } else if (pagination.type === 'cursor') {
      const cursor = selectOne(body, pagination.next);
      if (cursor === null || cursor === undefined || cursor === '') return;
      if (typeof cursor !== 'string' && typeof cursor !== 'number') throw new Error('Next cursor must be a scalar or null; correct pagination.next.');
      url.searchParams.set(pagination.cursorParam, String(cursor));
    } else {
      const next = link?.split(',').find((part) => /;\s*rel=["']?next["']?(?:\s|;|$)/.test(part))?.match(/<([^>]+)>/)?.[1];
      if (!next) return;
      url = safeUrl(next, url);
    }
  }
  throw new Error(`Reached maxPages=${config.maxPages}; fix pagination or explicitly increase the limit.`);
}
