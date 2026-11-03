interface AllowedHost {
  hostname: string;
  port?: number;
}
function allowedHost(input: string): AllowedHost | undefined {
  if (/[\s/?#@*]/.test(input) || input.includes('://')) return undefined;
  const match = input.match(/^(\[[^\]]+\]|[^:]+)(?::([0-9]+))?$/);
  if (!match) return undefined;
  try {
    const url = new URL(`http://${input}`);
    const port = match[2] ? Number(match[2]) : undefined;
    if (
      !url.hostname ||
      url.pathname !== '/' ||
      url.username ||
      url.password ||
      (port !== undefined && (port < 1 || port > 65535))
    )
      return undefined;
    return { hostname: url.hostname.toLowerCase(), ...(port === undefined ? {} : { port }) };
  } catch {
    return undefined;
  }
}
export function validAllowedHost(host: string): boolean {
  return !!allowedHost(host);
}
export function effectivePort(url: URL): number | undefined {
  if (url.port) return Number(url.port);
  return ({ 'http:': 80, 'https:': 443, 'postgres:': 5432, 'postgresql:': 5432 } as Record<string, number>)[
    url.protocol
  ];
}
export function assertAllowedHost(
  input: string | URL,
  allowed: readonly string[] | undefined,
  operation = 'Connection',
): void {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new Error(`${operation}: invalid URL; supply a network URL with a host.`);
  }
  const port = effectivePort(url);
  if (!url.hostname || port === undefined) throw new Error(`${operation}: invalid network URL or empty host.`);
  if (!allowed) return;
  const permitted = allowed.some((value) => {
    const host = allowedHost(value);
    return host && host.hostname === url.hostname.toLowerCase() && (host.port === undefined || host.port === port);
  });
  if (!permitted) throw new Error(`${operation}: configured host:${port} is not in allowedHosts. No request was sent.`);
}
export function connectionCause(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError' || /tim(?:e|ed)\s*out/i.test(error.message))
      return 'timed out';
    const cause = error.cause;
    const code =
      Reflect.get(error, 'code') ?? (cause && typeof cause === 'object' ? Reflect.get(cause, 'code') : undefined);
    if (code === 'ECONNREFUSED') return 'connection refused';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host could not be resolved';
    if (cause instanceof AggregateError) {
      const reasons = cause.errors.map(connectionCause);
      if (reasons.includes('connection refused')) return 'connection refused';
    }
    if (cause instanceof Error) return connectionCause(cause);
  }
  return 'connection failed';
}
