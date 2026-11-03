import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { ChatCompletionsProvider } from '@logiparity/ai';
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
async function mock(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>, timeoutMs = 1000) {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No mock address');
  return new ChatCompletionsProvider({
    endpoint: `http://127.0.0.1:${address.port}/custom/v1/chat/completions`,
    model: 'fixture-model',
    apiKey: 'fixture-key',
    timeoutMs,
  });
}
const messages = [{ role: 'user' as const, content: 'Synthetic request' }];
const response = (content: unknown, finish_reason = 'stop') => ({
  choices: [{ finish_reason, message: { role: 'assistant', content } }],
});
it('sends only the minimal compatible body to the configured endpoint with auth in its header', async () => {
  const provider = await mock(async (req, res) => {
    expect(req.url).toBe('/custom/v1/chat/completions');
    expect(req.method).toBe('POST');
    expect(req.headers.authorization).toBe('Bearer fixture-key');
    let body = '';
    for await (const part of req) body += String(part);
    expect(JSON.parse(body)).toEqual({ model: 'fixture-model', messages, stream: false });
    expect(body).not.toContain('fixture-key');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(response('Draft answer')));
  });
  expect(await provider.complete(messages)).toBe('Draft answer');
});
it.each([401, 429, 500])('reports HTTP %s once without echoing response content or secrets', async (status) => {
  let calls = 0;
  const provider = await mock((_, res) => {
    calls++;
    res.statusCode = status;
    res.end('fixture-key private provider error');
  });
  const error: unknown = await provider.complete(messages).catch((value: unknown) => value);
  expect(String(error)).toContain(`HTTP ${status}`);
  expect(calls).toBe(1);
  expect(String(error)).not.toContain('fixture-key');
  expect(String(error)).not.toContain('private provider error');
});
it('blocks provider redirects and does not forward credentials', async () => {
  const paths: string[] = [];
  const provider = await mock((req, res) => {
    paths.push(req.url ?? '');
    res.writeHead(302, { location: '/credential-trap' });
    res.end();
  });
  await expect(provider.complete(messages)).rejects.toThrow('redirect');
  expect(paths).toEqual(['/custom/v1/chat/completions']);
});
it('bounds response header and streaming-body waits', async () => {
  const provider = await mock(() => undefined, 30);
  await expect(provider.complete(messages)).rejects.toThrow('timeout');
  const bodyWait = await mock((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
  }, 30);
  await expect(bodyWait.complete(messages)).rejects.toThrow('timed out');
});
it.each([
  { name: 'invalid JSON', body: 'not JSON' },
  { name: 'missing choices', body: '{}' },
  { name: 'nontext content', body: JSON.stringify(response({ text: 'not scalar' })) },
  { name: 'empty content', body: JSON.stringify(response('')) },
  { name: 'whitespace content', body: JSON.stringify(response('  ')) },
  { name: 'truncated answer', body: JSON.stringify(response('partial', 'length')) },
  {
    name: 'refusal',
    body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Draft', refusal: 'No' } }] }),
  },
  {
    name: 'tool call',
    body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Draft', tool_calls: [{}] } }] }),
  },
])('rejects $name without returning an executable draft', async ({ body }) => {
  const provider = await mock((_, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(body);
  });
  await expect(provider.complete(messages)).rejects.toThrow(/AI provider|AI completion/);
});
it('caps streamed response size, including responses without Content-Length', async () => {
  const provider = await mock((_, res) => {
    res.writeHead(200);
    res.end('x'.repeat(1024 * 1024 + 1));
  });
  await expect(provider.complete(messages)).rejects.toThrow('1 MiB');
});
