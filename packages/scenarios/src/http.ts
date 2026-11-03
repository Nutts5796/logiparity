import { ConfigError } from '@logiparity/core';
import type { RequestTemplate, Target } from './config.js';

function lookup(path: string, context: Record<string, unknown>): unknown {
  let value: unknown = context;
  for (const key of path.split('.')) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new ConfigError(`Unknown request placeholder: ${path}`);
    value = Reflect.get(value, key);
  }
  return value;
}
export function renderTemplate(value: unknown, context: Record<string, unknown>, path = false): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{([\w.]+)\}\}$/);
    if (exact?.[1]) return lookup(exact[1], context);
    const result = value.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
      const item = lookup(key, context);
      if (!['string', 'number', 'boolean'].includes(typeof item)) throw new ConfigError(`Placeholder ${key} must be scalar inside a string`);
      return path ? encodeURIComponent(String(item)) : String(item);
    });
    if (result.includes('{{')) throw new ConfigError('Malformed request placeholder');
    return result;
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, context)]));
  return value;
}
export function requestPlan(target: Target, template: RequestTemplate, context: Record<string, unknown>) {
  const path = renderTemplate(template.path, context, true);
  if (typeof path !== 'string') throw new ConfigError('Request path must render to a string');
  let decoded = path.split(/[?#]/, 1)[0]!;
  for (let depth = 0; depth < 8; depth++) {
    if (decoded.replaceAll('\\', '/').split('/').some((part) => part === '.' || part === '..' || part.startsWith('..;'))) throw new ConfigError('Scenario request paths cannot contain dot-segments, including encoded forms');
    let next: string; try { next = decodeURIComponent(decoded); } catch { throw new ConfigError('Scenario request path contains invalid percent encoding'); }
    if (next === decoded) break;
    if (depth === 7) throw new ConfigError('Scenario request path has excessive percent encoding');
    decoded = next;
  }
  const url = new URL(path, target.baseUrl);
  if (url.origin !== new URL(target.baseUrl).origin || url.username || url.password || url.hash) throw new ConfigError('Scenario requests must stay on the configured target origin, without credentials or fragments');
  const body = template.body === undefined ? undefined : JSON.stringify(renderTemplate(template.body, context));
  if (template.method === 'GET' && body !== undefined) throw new ConfigError('GET templates cannot contain a body');
  return { method: template.method, url, body };
}
export type RequestPlan = ReturnType<typeof requestPlan>;
export function targetHeaders(target: Target, env: NodeJS.ProcessEnv): Headers {
  const headers = new Headers({ ...target.headers, 'content-type': 'application/json' });
  for (const [header, reference] of Object.entries(target.headersEnv)) {
    const key = typeof reference === 'string' ? reference : reference.env;
    if (!env[key]) throw new ConfigError(`Missing target header environment variable ${key}`);
    headers.set(header, (typeof reference === 'string' ? '' : reference.prefix) + env[key]);
  }
  return headers;
}
export async function sendRequest(plan: RequestPlan, target: Target, headers: Headers, signal?: AbortSignal): Promise<Response> {
  try {
    const response = await fetch(plan.url, { method: plan.method, headers, ...(plan.body === undefined ? {} : { body: plan.body }), redirect: 'error', signal: signal ?? AbortSignal.timeout(target.timeoutMs) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    return response;
  } catch (error) {
    const status = error instanceof Error && /^HTTP \d+$/.test(error.message) ? error.message : 'connection, redirect or timeout error';
    // Paths and response bodies can contain credentials; expose only the operation and status.
    throw new Error(`Target ${plan.method} request failed: ${status}. Check target mappings and service logs.`);
  }
}
