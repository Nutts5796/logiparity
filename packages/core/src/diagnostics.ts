const normalizedName = (name: string) => name.toLowerCase().replace(/[-_]/g, '');
export const isSecretName = (name: string): boolean => /token|secret|password|apikey|auth|cookie|session/.test(normalizedName(name));
export function secretValues(config: unknown, env: NodeJS.ProcessEnv = process.env): string[] {
  const values = new Set<string>();
  // Only variables the configuration actually uses are secrets. Scanning the whole
  // environment by name redacted unrelated values such as TERM_SESSION_ID or a flag "1".
  const add = (value: string | undefined) => {
    if (!value) return;
    values.add(value);
    if (/^Bearer\s+/i.test(value)) values.add(value.replace(/^Bearer\s+/i, ''));
    try { const url = new URL(value); if (url.password) values.add(decodeURIComponent(url.password)); for (const [key, item] of url.searchParams) if (isSecretName(key) && item) values.add(item); } catch { /* Not a URL. */ }
  };
  add(env.LOGIPARITY_AI_API_KEY);
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:tokenEnv|passwordEnv|usernameEnv|connectionEnv)$/.test(key) && typeof child === 'string') add(env[child]);
      else if (key === 'headersEnv' && child && typeof child === 'object') { for (const name of Object.values(child)) if (typeof name === 'string') add(env[name]); }
      else if (typeof child === 'string') { for (const [, name] of child.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) if (name && isSecretName(name)) add(env[name]); }
      else walk(child);
    }
  };
  walk(config); return [...values];
}
export function redactSecrets(text: string, secrets: readonly string[]): string {
  text = text.replace(/[^\s/\\?#"'<>:;()]+/g, (segment) => {
    let value = segment;
    for (let depth = 0; depth < 8; depth++) {
      if (secrets.includes(value)) return '[REDACTED]';
      try { const next = decodeURIComponent(value); if (next === value) break; value = next; } catch { break; }
    }
    return segment;
  });
  for (const secret of [...new Set(secrets.flatMap((value) => value ? [value, encodeURIComponent(value)] : []))].sort((a, b) => b.length - a.length)) text = text.replaceAll(secret, '[REDACTED]');
  return text;
}
export function safeConsole(text: string): string {
  return [...text].filter((char) => { const code = char.codePointAt(0)!; return code === 9 || code === 10 || code >= 32 && !(code >= 127 && code <= 159); }).join('');
}
