import { expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  consoleReport,
  markdownReport,
  htmlReport,
  junitReport,
  type DataRow,
} from '@logiparity/core';
import { checkedReport } from '../../scripts/validate-report.mjs';
import { patternCards } from '../../packages/core/src/html-patterns.js';
const source = {
  type: 'csv',
  file: 'unused',
  fields: { id: 'id', pay: { path: 'pay', label: 'Driver payout' }, eta: { path: 'eta', label: 'ETA' }, cur: 'cur' },
};
function entity(options: Record<string, unknown> = {}) {
  return entitySchema.parse({
    name: 'order',
    key: 'id',
    pluralLabel: 'orders',
    sources: { api: { ...source, label: 'API' }, csv: { ...source, label: 'CSV export' } },
    compare: { pay: { type: 'money', currency: 'USD' } },
    ...options,
  });
}
async function run(config: ReturnType<typeof entity>, a: DataRow[], b: DataRow[]) {
  return checkedReport(
    compareEntities([config], async function* (name) {
      yield* name === 'api' ? a : b;
    }),
  );
}
it('gives clean console, Markdown and HTML runs the same matching headline without an empty donut (karen, maria)', async () => {
  const config = entity(),
    rows = [
      { id: 'O1', pay: '1.00' },
      { id: 'O2', pay: '2.00' },
    ],
    report = await run(config, rows, rows);
  for (const render of [consoleReport, markdownReport, htmlReport])
    expect(render(report, { entities: [config] })).toContain('All 2 orders match');
  const html = htmlReport(report, { entities: [config] });
  expect(html).not.toContain('See All (0)');
  expect(html).not.toContain('aria-label="100% of findings accounted for"');
});
it('keeps configured labels and acronyms in JSON cause summaries, and uses a singular hour (raj, maria)', async () => {
  const config = entity({ compare: { eta: { type: 'datetime', sourceTimezones: { api: 'UTC', csv: 'UTC' } } } });
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: String(i), eta: '2026-11-02T12:00:00' }));
  const report = await run(
    config,
    rows,
    rows.map((row) => ({ ...row, eta: '2026-11-02T13:00:00' })),
  );
  expect(report.groups?.[0]?.summary).toContain('ETA values in CSV export');
  const card = patternCards(report, { entities: [config] })[0];
  expect(card?.headline).toBe('1 hour later');
  expect(card?.nextStep).not.toContain('Set sourceTimezones');
});
it('shows a real Markdown detail sentence and the invalid reference input instead of a blank placeholder (tom, raj)', async () => {
  const config = entity();
  const report = await run(config, [{ id: 'O1', pay: 'bad' }], [{ id: 'O1', pay: 'also bad' }]);
  const md = markdownReport(report, { entities: [config] });
  expect(md).toContain('Invalid: bad');
  const mismatch = await run(config, [{ id: 'O2', pay: '1.00' }], [{ id: 'O2', pay: '2.00' }]);
  expect(
    markdownReport(mismatch, { entities: [config] })
      .split('\n')
      .find((line) => line.startsWith('| O2')),
  ).toContain('Driver payout differs from API');
});
it('names the entity and source on filtered-out warnings and does not call numeric predicates case-insensitive (raj)', async () => {
  const config = entity({ sources: { api: { ...source, where: { id: 7 } }, csv: { ...source, where: { id: 7 } } } });
  const report = await run(config, [{ id: 'O1' }], [{ id: 'O1' }]);
  expect(report.warnings?.[0]?.message).toContain('Order · API:');
  expect(htmlReport(report, { entities: [config] })).not.toContain('(case-insensitive)');
});
it('keeps currencies case-insensitive in composite keys and supplies parts on simple-key currency findings (raj c1)', async () => {
  const sources = { api: { ...source, currencyField: 'cur' }, csv: { ...source, currencyField: 'cur' } };
  const keyed = entity({ key: ['id', 'cur'], sources });
  expect(
    (await run(keyed, [{ id: 'L1', cur: 'USD', pay: '1.00' }], [{ id: 'L1', cur: 'usd', pay: '1.00' }])).findings,
  ).toEqual([]);
  const report = await run(
    entity({ sources }),
    [{ id: 'L1', cur: 'USD', pay: '1.00' }],
    [{ id: 'L1', cur: 'CAD', pay: '1.00' }],
  );
  expect(report.findings.find((f) => f.reason === 'currency_mismatch')?.keyParts).toEqual(['L1']);
});
it('tells JUnit readers when category evidence is truncated (maria)', async () => {
  const config = entity({ compare: {} }),
    rows = Array.from({ length: 14 }, (_, i) => ({ id: String(i) }));
  const report = await run(config, rows, []);
  expect(junitReport(report)).toContain('+4 more; see report.html or report.json');
});
