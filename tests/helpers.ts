import { createServer, type RequestListener, type Server } from 'node:http';
import { once } from 'node:events';

export async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

export async function startServer(handler: RequestListener): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not get a TCP port.');
  return { server, url: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); server.close(); await once(server, 'close'); } };
}
