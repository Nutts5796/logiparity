import { isSecretName } from '@logiparity/core';
export const redacted = '[REDACTED]';
export const defaultRedactFields = ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'password', 'secret', 'token', 'apiKey', 'api_key', 'access_token', 'refresh_token', 'client_secret'];
type Token = string | '*';
function pathTokens(path: string): Token[] {
  if (!path.startsWith('$')) throw new Error('Redaction path must start with $');
  const tokens: Token[] = []; const suffix = path.slice(1); let index = 0;
  const pattern = /\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+|\*)\]|\['([^']+)'\]|\["([^"]+)"\]/gy;
  while (index < suffix.length) {
    pattern.lastIndex = index; const match = pattern.exec(suffix);
    if (!match) throw new Error(`Unsupported redactFields path ${path}; use properties, indexes and [*], without expressions or filters.`);
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4]!); index = pattern.lastIndex;
  }
  if (!tokens.length) throw new Error('redactFields cannot mask the entire $ payload; select a field or subtree.');
  return tokens;
}
export interface Redaction { data: unknown; count: number; scrub: (text: string) => string }
export function redactInput(input: unknown, fields: readonly string[] = [], secrets: readonly string[] = []): Redaction {
  const normalized = (value: string) => value.toLowerCase().replace(/[-_]/g, '');
  const names = new Set([...defaultRedactFields, ...fields.filter((f) => !f.startsWith('$'))].map(normalized));
  const sensitive = (name: string) => isSecretName(name) || names.has(normalized(name));
  const paths = fields.filter((f) => f.startsWith('$')).map(pathTokens);
  const values = new Set(secrets.filter(Boolean)); let count = 0;
  const collect = (value: unknown): void => {
    if (typeof value === 'string' && value && value !== redacted) values.add(value);
    else if (typeof value === 'number' || typeof value === 'boolean') values.add(String(value));
    else if (Array.isArray(value)) for (const child of value) collect(child);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) collect(child);
  };
  const matches = (path: string[]) => paths.some((tokens) => tokens.length === path.length && tokens.every((token, i) => token === '*' || token === path[i]));
  const mask = (value: unknown): string => { count++; collect(value); return redacted; };
  const walk = (value: unknown, path: string[]): unknown => {
    if (matches(path)) return mask(value);
    if (Array.isArray(value)) return value.map((child, i) => walk(child, [...path, String(i)]));
    if (value && typeof value === 'object') {
      const finding = Object.hasOwn(value, 'field') && typeof Reflect.get(value, 'field') === 'string' && sensitive(String(Reflect.get(value, 'field')));
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitive(key) || finding && ['expected', 'actual', 'values'].includes(key) ? mask(child) : walk(child, [...path, key])]));
    }
    if (typeof value === 'string') {
      // URL fragments, relative URLs and URLs embedded in descriptions use the same query-key rule.
      return value.replace(/([?&])([^=&#\s?]+)=([^&#\s?]*)/g, (match, separator: string, key: string, item: string) => {
        let decoded: string; let queryKey: string;
        try { decoded = decodeURIComponent(item.replaceAll('+', ' ')); queryKey = decodeURIComponent(key.replaceAll('+', ' ')); } catch { return match; }
        if (!sensitive(queryKey)) return match;
        count++; collect(decoded); collect(item); return `${separator}${key}=${redacted}`;
      });
    }
    return value;
  };
  const masked = walk(input, []);
  if (values.size > 5000 || [...values].reduce((n, v) => n + v.length, 0) > 1024 * 1024) throw new Error('Too many sensitive values for AI redaction; reduce the input or maxFindings before previewing again. Nothing was sent.');
  const literals = [...values].sort((a, b) => b.length - a.length).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = literals.length ? new RegExp(literals.join('|'), 'g') : undefined;
  const scrub = (text: string): string => pattern ? text.replace(pattern, redacted) : text;
  const scrubTree = (value: unknown): unknown => {
    if (typeof value === 'string') return value === redacted ? value : scrub(value);
    if (Array.isArray(value)) return value.map(scrubTree);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [scrub(key), scrubTree(child)]));
    return value;
  };
  return { data: scrubTree(masked), count, scrub };
}
