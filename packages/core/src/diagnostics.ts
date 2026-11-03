export const normalizedSecretName = (name: string) =>
  name
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/[-_.]/g, '');
export const isSecretName = (name: string): boolean =>
  /token|secret|password|passwd|pwd|apikey|auth|cookie|session|credential|privatekey|jwt|signature|subscriptionkey|^pass$/.test(
    normalizedSecretName(name),
  ) || /[-_.](?:pass|key|sig)$/i.test(name);
export interface EnvironmentContext {
  secrets: readonly string[];
  references: readonly string[];
}
const environments = new WeakMap<object, EnvironmentContext>();
export function rememberEnvironment(value: unknown, context: EnvironmentContext): void {
  const seen = new WeakSet<object>();
  const walk = (item: unknown): void => {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    environments.set(item, context);
    for (const child of Object.values(item)) walk(child);
  };
  walk(value);
}
export function referencedEnvironment(config: unknown): string[] {
  const names = new Set<string>();
  const seen = new WeakSet<object>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) names.add(value);
  };
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const [, name] of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) add(name);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const name of environments.get(value)?.references ?? []) names.add(name);
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:tokenEnv|passwordEnv|usernameEnv|connectionEnv)$/.test(key)) add(child);
      if (key === 'headersEnv' && child && typeof child === 'object')
        for (const reference of Object.values(child))
          add(
            typeof reference === 'string'
              ? reference
              : reference && typeof reference === 'object'
                ? Reflect.get(reference, 'env')
                : undefined,
          );
      walk(child);
    }
  };
  walk(config);
  return [...names].sort();
}
export function secretValues(config: unknown, env: NodeJS.ProcessEnv = process.env): string[] {
  const values = new Set<string>();
  const publicNames = new Set(
    config && typeof config === 'object' && Array.isArray(Reflect.get(config, 'publicEnv'))
      ? (Reflect.get(config, 'publicEnv') as string[])
      : [],
  );
  const addEnvironment = (name: string) => {
    if (!publicNames.has(name)) add(env[name]);
  };
  // Only variables the configuration actually uses are secrets. Scanning the whole
  // environment by name redacted unrelated values such as TERM_SESSION_ID or a flag "1".
  const add = (value: string | undefined) => {
    if (!value) return;
    values.add(value);
    if (/^Bearer\s+/i.test(value)) values.add(value.replace(/^Bearer\s+/i, ''));
    try {
      const url = new URL(value);
      if (url.password) values.add(decodeURIComponent(url.password));
      for (const [key, item] of url.searchParams) if (isSecretName(key) && item) values.add(item);
    } catch {
      /* Not a URL. */
    }
  };
  add(env.LOGIPARITY_AI_API_KEY);
  if (config && typeof config === 'object' && Array.isArray(Reflect.get(config, 'secretEnv')))
    for (const name of Reflect.get(config, 'secretEnv') as string[]) add(env[name]);
  const seen = new WeakSet<object>();
  const walk = (value: unknown, sensitive = false): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const secret of environments.get(value)?.secrets ?? []) add(secret);
    const auth = Reflect.get(value, 'auth');
    if (auth && typeof auth === 'object' && Reflect.get(auth, 'type') === 'basic') {
      const username = env[String(Reflect.get(auth, 'usernameEnv'))],
        password = env[String(Reflect.get(auth, 'passwordEnv'))];
      if (username !== undefined && password !== undefined)
        add(Buffer.from(`${username}:${password}`).toString('base64'));
    }
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:tokenEnv|passwordEnv|connectionEnv)$/.test(key) && typeof child === 'string') addEnvironment(child);
      else if (key === 'headersEnv' && child && typeof child === 'object') {
        for (const name of Object.values(child)) {
          const reference =
            typeof name === 'string' ? name : name && typeof name === 'object' ? Reflect.get(name, 'env') : undefined;
          if (typeof reference === 'string') addEnvironment(reference);
        }
      } else if (typeof child === 'string') {
        for (const [, name] of child.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) if (name) addEnvironment(name);
      } else
        walk(
          child,
          sensitive || /^(?:url|baseUrl|path|headers|headersEnv|auth|connection|connectionString)$/i.test(key),
        );
    }
  };
  walk(config);
  return [...values];
}
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function credentialEncodings(value: string): string[] {
  const path = new URL('https://redaction.invalid');
  path.pathname = '/' + value;
  const query = new URL('https://redaction.invalid');
  query.search = '?value=' + value;
  return [
    ...new Set([
      value,
      encodeURIComponent(value),
      encodeURI(value),
      path.pathname.slice(1),
      query.search.slice(7),
      new URLSearchParams({ value }).toString().slice(6),
    ]),
  ];
}
function replaceCredential(text: string, value: string, short: boolean, mode: 'diagnostic' | 'data'): string {
  if (!value) return text;
  if (!short) return text.replace(new RegExp(escaped(value), 'g'), '[REDACTED]');
  if (mode === 'data') return text.trim() === value ? '[REDACTED]' : text;
  const token = new RegExp(`(?<=[/=?#:@&;])${escaped(value)}(?=$|[/?:#@&;])`, 'g');
  text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (url) => url.replace(token, '[REDACTED]'));
  const header = new RegExp(
    `((?:^|[\\r\\n])[^:\\r\\n]+:[ \\t]*(?:[A-Za-z-]+[ \\t]+)?)${escaped(value)}(?=$|[\\r\\n])`,
    'g',
  );
  return text.replace(header, '$1[REDACTED]');
}
export function redactSecrets(
  text: string,
  secrets: readonly string[],
  mode: 'diagnostic' | 'data' = 'diagnostic',
): string {
  text = text.replace(/\p{Cf}/gu, '');
  const values = [...new Set(secrets.map((secret) => secret.replace(/\p{Cf}/gu, '')).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const secret of values)
    for (const encoding of credentialEncodings(secret).sort((a, b) => b.length - a.length))
      text = replaceCredential(text, encoding, secret.length < 8, mode);
  return text.replace(/[^\s\\?#"'<>()[\]]*%[^\s\\?#"'<>()[\]]*/g, (segment) => {
    let decoded = segment;
    for (let depth = 0; depth < 8; depth++) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
      let masked = decoded;
      for (const secret of values) masked = replaceCredential(masked, secret, secret.length < 8, mode);
      if (masked !== decoded) return masked;
    }
    return segment;
  });
}
export function shortSecretWarnings(config: unknown, env: NodeJS.ProcessEnv = process.env): string[] {
  const secrets = new Set(secretValues(config, env));
  return referencedEnvironment(config)
    .filter((name) => env[name] && env[name]!.length < 8 && secrets.has(env[name]!))
    .map(
      (name) =>
        `Environment variable ${name} contains a secret shorter than 8 characters. Only whole data values, URL components and header values can be redacted safely; use a longer secret.`,
    );
}
export function safeConsole(text: string): string {
  return [...text.replace(/\p{Cf}/gu, '')]
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return (
        (code === 9 || code === 10 || (code >= 32 && !(code >= 127 && code <= 159))) &&
        ![
          0x061c,
          0x200b,
          0xfeff,
          0x200e,
          0x200f,
          0x2028,
          0x2029,
          ...Array.from({ length: 5 }, (_, i) => 0x202a + i),
          ...Array.from({ length: 4 }, (_, i) => 0x2066 + i),
        ].includes(code)
      );
    })
    .join('');
}

export function redactTree<T>(input: T, secrets: readonly string[]): T {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return redactSecrets(value, secrets, 'data');
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [redactSecrets(key, secrets, 'data'), visit(item)]),
      );
    return value;
  };
  return visit(input) as T;
}
