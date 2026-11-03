export function assertAllowedHost(
  input: string | URL,
  allowed: readonly string[] | undefined,
  operation = 'Connection',
): void {
  if (!allowed) return;
  const url = input instanceof URL ? input : new URL(input);
  const permitted = allowed.some((host) => {
    try {
      const candidate = new URL(`http://${host}`);
      return (
        candidate.username === '' &&
        candidate.password === '' &&
        candidate.pathname === '/' &&
        (host.includes(':') ? candidate.host === url.host : candidate.hostname === url.hostname)
      );
    } catch {
      return false;
    }
  });
  if (!permitted) throw new Error(`${operation}: host ${url.hostname} is not in allowedHosts. No request was sent.`);
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
