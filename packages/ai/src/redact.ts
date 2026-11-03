import { isSecretName, normalizedSecretName } from '@logiparity/core';
export const redacted = '[REDACTED]';
export const defaultRedactFields = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'access_token',
  'refresh_token',
  'client_secret',
];
type Token = string | '*';
function pathTokens(path: string): Token[] {
  if (!path.startsWith('$')) throw new Error('Redaction path must start with $');
  const tokens: Token[] = [];
  const suffix = path.slice(1);
  let index = 0;
  const pattern = /\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+|\*)\]|\['([^']+)'\]|\["([^"]+)"\]/gy;
  while (index < suffix.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(suffix);
    if (!match)
      throw new Error(
        `Unsupported redactFields path ${path}; use properties, indexes and [*], without expressions or filters.`,
      );
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4]!);
    index = pattern.lastIndex;
  }
  if (!tokens.length) throw new Error('redactFields cannot mask the entire $ payload; select a field or subtree.');
  return tokens;
}
function redactCredentials(text: string, collect: (...values: string[]) => void): string {
  const decoded = (value: string) => {
    try {
      return decodeURIComponent(value.replaceAll('+', ' '));
    } catch {
      return value;
    }
  };
  text = text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s@]*)@/gi, (_, scheme: string, userinfo: string) => {
    const separator = userinfo.indexOf(':');
    if (separator >= 0) {
      const user = userinfo.slice(0, separator);
      const password = userinfo.slice(separator + 1);
      collect(password, decoded(password));
      if (user) collect(user, decoded(user));
      return `${scheme}${redacted}:${redacted}@`;
    }
    collect(userinfo, decoded(userinfo));
    return `${scheme}${redacted}@`;
  });
  text = text.replace(
    /\b((?:proxy-)?authorization)[ \t]*[=:][ \t]*(\S+)[ \t]+([^\r\n,;]+)/gi,
    (_, name: string, scheme: string, credentials: string) => {
      collect(credentials, decoded(credentials));
      return `${name}: ${scheme} ${redacted}`;
    },
  );
  text = text.replace(
    /\b([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*([=:])[ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,&#?<>]+))/g,
    (
      match,
      name: string,
      separator: string,
      quoted: string | undefined,
      single: string | undefined,
      plain: string | undefined,
    ) => {
      if (!isSecretName(name) || /^(?:proxy-)?authorization$/i.test(name)) return match;
      const value = quoted ?? single ?? plain ?? '';
      if (value === redacted) return match;
      collect(value, decoded(value));
      return `${name}${separator}${redacted}`;
    },
  );
  text = text.replace(/([?&#])([^=&#\s?]+)=([^&#\s?]*)/g, (match, separator: string, key: string, value: string) => {
    const name = normalizedSecretName(decoded(key));
    if (!isSecretName(name) && name !== 'key' && name !== 'sig') return match;
    collect(value, decoded(value));
    return `${separator}${key}=${redacted}`;
  });
  return text.replace(/\bBearer[ \t]+([^\s"'<>`,;]+)/gi, (_, token: string) => {
    collect(token);
    return `Bearer ${redacted}`;
  });
}
export interface Redaction {
  data: unknown;
  count: number;
  scrub: (text: string) => string;
}
export function redactInput(
  input: unknown,
  fields: readonly string[] = [],
  secrets: readonly string[] = [],
): Redaction {
  const normalized = normalizedSecretName;
  const names = new Set([...defaultRedactFields, ...fields.filter((f) => !f.startsWith('$'))].map(normalized));
  const sensitive = (name: string) => isSecretName(name) || names.has(normalized(name));
  const paths = fields.filter((f) => f.startsWith('$')).map(pathTokens);
  const values = new Set(secrets.filter((value) => value.length >= 8));
  let count = 0;
  const literal = (...items: string[]) => {
    for (const item of items) if (item.length >= 8 && item !== redacted) values.add(item);
  };
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      literal(value);
      redactCredentials(value, literal);
    } else if (Array.isArray(value)) for (const child of value) collect(child);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) collect(child);
  };
  const matches = (path: string[]) =>
    paths.some(
      (tokens) => tokens.length === path.length && tokens.every((token, i) => token === '*' || token === path[i]),
    );
  const mask = (value: unknown): string => {
    count++;
    collect(value);
    return redacted;
  };
  const walk = (value: unknown, path: string[]): unknown => {
    if (matches(path)) return mask(value);
    if (Array.isArray(value)) return value.map((child, i) => walk(child, [...path, String(i)]));
    if (value && typeof value === 'object') {
      const finding =
        Object.hasOwn(value, 'field') &&
        typeof Reflect.get(value, 'field') === 'string' &&
        sensitive(String(Reflect.get(value, 'field')));
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          sensitive(key) || (finding && ['expected', 'actual', 'values'].includes(key))
            ? mask(child)
            : walk(child, [...path, key]),
        ]),
      );
    }
    if (typeof value === 'string')
      return redactCredentials(value, (...items) => {
        count++;
        literal(...items);
      });
    return value;
  };
  const masked = walk(input, []);
  if (values.size > 5000 || [...values].reduce((n, v) => n + v.length, 0) > 1024 * 1024)
    throw new Error(
      'Too many sensitive values for AI redaction; reduce the input or maxFindings before previewing again. Nothing was sent.',
    );
  const literals = [...values].sort((a, b) => b.length - a.length).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = literals.length ? new RegExp(literals.join('|'), 'g') : undefined;
  const scrub = (text: string): string => redactCredentials(pattern ? text.replace(pattern, redacted) : text, () => {});
  const scrubTree = (value: unknown): unknown => {
    if (typeof value === 'string') return value === redacted ? value : scrub(value);
    if (Array.isArray(value)) return value.map(scrubTree);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [scrub(key), scrubTree(child)]));
    return value;
  };
  return { data: scrubTree(masked), count, scrub };
}
