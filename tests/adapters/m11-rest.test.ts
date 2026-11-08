import { expect, it, afterEach } from 'vitest';
import {
  sourceSchema,
  compareEntities,
  entitySchema,
  consoleReport,
  markdownReport,
  htmlReport,
  junitReport,
  jsonReport,
} from '@logiparity/core';
import { readRest } from '@logiparity/adapters';
import { readFile } from 'node:fs/promises';
import { startServer, collect } from '../helpers.js';
const servers: Awaited<ReturnType<typeof startServer>>[] = [];
async function serve(handler: Parameters<typeof startServer>[0]) {
  const s = await startServer(handler);
  servers.push(s);
  return s;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
const context = { baseDir: '.', env: {} };
function config(baseUrl: string, extra: Record<string, unknown> = {}) {
  const value = sourceSchema.parse({
    type: 'rest',
    baseUrl,
    path: '/',
    items: '$[*]',
    retries: 0,
    fields: { id: '$.id', name: '$.name' },
    ...extra,
  });
  if (value.type !== 'rest') throw Error('REST expected');
  return value;
}
it('keeps the synthetic absent-property repro strict with an actionable opt-in', async () => {
  const body = await readFile('tests/fixtures/m11/1-missing-json-property/www/items.json', 'utf8');
  const s = await serve((_, res) => res.end(body));
  await expect(collect(readRest(config(s.url), context))).rejects.toThrow(/property name is missing.*absentAsNull/);
});
it.each(['source', 'field'])('reads omitted properties as null with the %s opt-in', async (mode) => {
  const body = await readFile('tests/fixtures/m11/1-missing-json-property/www/items.json', 'utf8');
  const s = await serve((_, res) => res.end(body));
  const extra =
    mode === 'source' ? { absentAsNull: true } : { fields: { id: '$.id', name: { path: '$.name', missing: null } } };
  expect(await collect(readRest(config(s.url, extra), context))).toEqual([
    { id: '1', name: 'Acme' },
    { id: '2', name: null },
  ]);
});
it('does not hide a wrong shape, wildcard cardinality or a strict sibling mapping', async () => {
  const s = await serve((_, res) => res.end(JSON.stringify([{ id: 1, name: 7, list: [{ x: 1 }, { x: 2 }] }])));
  for (const path of ['$.name.x', '$.name[*]', '$.list[*].x'])
    await expect(
      collect(readRest(config(s.url, { absentAsNull: true, fields: { id: '$.id', name: path } }), context)),
    ).rejects.toThrow();
  await expect(
    collect(
      readRest(
        config(s.url, { fields: { id: '$.id', optional: { path: '$.missing', missing: null }, strict: '$.strict' } }),
        context,
      ),
    ),
  ).rejects.toThrow(/property strict is missing/);
});
it.each(['page', 'offset'] as const)(
  'warns once when a later short %s page has no completion metadata in every format',
  async (type) => {
    const s = await serve((req, res) => {
      const q = new URL(req.url!, 'http://localhost').searchParams;
      const first = type === 'page' ? q.get('page') === '1' : q.get('offset') === '0';
      res.end(JSON.stringify(first ? [{ id: '1' }, { id: '2' }] : [{ id: '3' }]));
    });
    const rest = config(s.url, { fields: { id: '$.id' }, pagination: { type, size: 2 } });
    const entity = entitySchema.parse({
      name: 'row',
      key: 'id',
      sources: { a: rest, b: { type: 'csv', file: 'x', fields: { id: 'id' } } },
    });
    const report = await compareEntities([entity], (name, source, ctx) =>
      name === 'a' && source.type === 'rest'
        ? readRest(source, { ...context, warn: ctx.warn })
        : (async function* () {
            yield* [{ id: '1' }, { id: '2' }, { id: '3' }];
          })(),
    );
    expect(report.findings).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    for (const text of [
      consoleReport(report),
      markdownReport(report),
      htmlReport(report),
      junitReport(report),
      jsonReport(report),
    ]) {
      expect(text).toContain('completeness is not verified');
      expect(text).toContain('separate count request');
    }
  },
);
it('does not warn for verified completion or a non-paginated endpoint', async () => {
  const s = await serve((_, res) => res.end('{"data":[{"id":"1"}],"total":1}'));
  for (const pagination of [undefined, { type: 'offset', size: 2, totalPath: '$.total' }]) {
    const messages: string[] = [];
    await collect(
      readRest(config(s.url, { items: '$.data[*]', fields: { id: '$.id' }, pagination }), {
        ...context,
        warn: (m) => messages.push(m),
      }),
    );
    expect(messages).toEqual([]);
  }
});
