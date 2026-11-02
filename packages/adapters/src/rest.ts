import { safeConsole } from '@logiparity/core';
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
    let more: boolean | undefined;
    if (pagination && 'size' in pagination && items.length > pagination.size) throw new Error(`REST page ${page + 1}: requested size ${pagination.size}, received ${items.length}; server returned more items than requested. Check pagination size and endpoint behavior.`);
    if (pagination?.type === 'page' || pagination?.type === 'offset') {
      const signals: boolean[] = [];
      const location = `REST page ${page + 1} (${pagination.type}=${position}): requested size ${pagination.size}, received ${items.length}`;
      const count = (path: string) => { const value = selectOne(body, path); if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${location}; ${path} must select a nonnegative safe integer completion count.`); return value; };
      const completedPage = pagination.type === 'page' ? position + (pagination.start === 0 ? 1 : 0) : page + 1;
      const consumed = (pagination.type === 'offset' ? position : (completedPage - 1) * pagination.size) + items.length;
      if (pagination.totalPath) { const total = count(pagination.totalPath); if (consumed > total) throw new Error(`${location}; items exceed advertised totalPath count ${total}.`); signals.push(consumed < total); }
      if (pagination.totalPagesPath) signals.push(completedPage < count(pagination.totalPagesPath));
      if (pagination.hasMorePath) { const value = selectOne(body, pagination.hasMorePath); if (typeof value !== 'boolean') throw new Error(`${location}; hasMorePath must select a boolean.`); signals.push(value); }
      if (signals.some(Boolean) && items.length < pagination.size) throw new Error(`${location}; a completion signal says more pages exist. Match the server's page-size cap before comparing.`);
      if (signals.some((value) => value !== signals[0])) throw new Error(`${location}; completion signals disagree. Correct the response metadata or pagination paths.`);
      more = signals[0];
      if (more === undefined && page === 0 && items.length < pagination.size) {
        const message = `${location}; no completion signal is configured. Set totalPath, totalPagesPath or hasMorePath to verify completeness.`;
        if (!pagination.allowShortFirstPage) throw new Error(`${message} Set allowShortFirstPage: true only to explicitly accept an unverified short first page.`);
        (context.warn ?? console.warn)(safeConsole(message));
      }
    }
    for (let index = 0; index < items.length; index++) {
      try { yield Object.fromEntries(Object.entries(config.fields).map(([field, path]) => [field, selectOne(items[index], path)])); }
      catch (error) { throw new Error(`REST page ${page + 1}, record ${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!pagination) return;
    if (pagination.type === 'page' || pagination.type === 'offset') {
      if (more === false || more === undefined && items.length < pagination.size) return;
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
