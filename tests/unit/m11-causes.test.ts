import { expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  consoleReport,
  markdownReport,
  htmlReport,
  junitReport,
  jsonReport,
  type DataRow,
} from '@logiparity/core';
import { checkedReport } from '../../scripts/validate-report.mjs';

const fields = {
  id: 'id',
  status: { path: 'status', label: 'Hazmat flag' },
  units: { path: 'units', label: 'Power units' },
};
const source = { type: 'csv', file: 'unused', fields };
const config = () =>
  entitySchema.parse({
    name: 'carrier',
    pluralLabel: 'carriers',
    key: 'id',
    sources: { a: { ...source, label: 'SMS' }, b: { ...source, label: 'Company Census' } },
    compare: { status: { type: 'enum' }, units: { type: 'number' } },
  });
async function run(a: DataRow[], b: DataRow[]) {
  const entity = config();
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield* name === 'a' ? a : b;
    }),
  );
  return {
    report,
    texts: [
      consoleReport(report, { entities: [entity] }),
      markdownReport(report, { entities: [entity] }),
      htmlReport(report, { entities: [entity] }),
      junitReport(report, new Date(), { entities: [entity] }),
      jsonReport(report),
    ],
  };
}
it.each([
  ['Delivered', 'delivered', 'case_only', 'letter case'],
  ['In transit', 'In  transit', 'whitespace_only', 'whitespace'],
  ['In transit', 'in  transit', 'case_whitespace', 'letter case and whitespace'],
])('classifies %s vs %s as formatting before a stale or vocabulary cause', async (expected, actual, cause, phrase) => {
  const a = Array.from({ length: 8 }, (_, i) => ({ id: String(i), status: expected }));
  const { report, texts } = await run(
    a,
    a.map((row, i) => ({ ...row, status: i < 3 ? actual : expected })),
  );
  expect(report.groups?.[0]).toMatchObject({ kind: 'formatting_difference', cause, expected, actual, count: 3 });
  for (const text of texts) {
    expect(text).toContain(phrase);
    expect(text).toContain(actual);
    expect(text).not.toContain('stale or lagging');
    expect(text).not.toContain('different vocabulary');
  }
  expect(texts[0]).toContain(cause === 'whitespace_only' ? 'whitespaceFold: true' : 'caseFold: true');
});
it('reports repeated numeric values neutrally, including signed decimals', async () => {
  const a = Array.from({ length: 4 }, (_, i) => ({ id: String(i), units: i < 3 ? 1 : 5 }));
  const { report, texts } = await run(
    a,
    a.map((row, i) => ({ ...row, units: i < 3 ? 2 : 5 })),
  );
  expect(report.groups?.[0]).toMatchObject({ kind: 'number_change', count: 3, expected: 1, actual: 2 });
  for (const text of texts) {
    expect(text).not.toContain('vocabulary');
    expect(text).not.toContain('mapping');
  }
  expect(texts[0]).toContain('3 power units values in Company Census are 2 where SMS has 1');
  expect(texts[0]).toContain('derived or updated in each source');
});
it('describes consistent enum changes with a field noun and compares both sources without assigning blame', async () => {
  const a = Array.from({ length: 10 }, (_, i) => ({ id: String(i), status: 'N' }));
  const { report, texts } = await run(
    a,
    a.map((row, i) => ({ ...row, status: i < 3 ? 'Y' : 'N' })),
  );
  expect(report.groups?.[0]).toMatchObject({ cause: 'stale_value', referenceCount: 10, matchingCount: 7 });
  for (const text of texts) {
    expect(text).toContain('lagging update or a different definition');
    expect(text).not.toContain('N carriers');
    expect(text).not.toContain('synchronization in Company Census');
  }
  expect(texts[0]).toContain('carriers with hazmat flag N in SMS show Y in Company Census');
  expect(texts[0]).toContain('Compare refresh timing in both sources and the field definitions');
});
it('keeps a true vocabulary mapping when the reference value is never observed', async () => {
  const { report, texts } = await run(
    Array.from({ length: 3 }, (_, i) => ({ id: String(i), status: 'delivered' })),
    Array.from({ length: 3 }, (_, i) => ({ id: String(i), status: 'done' })),
  );
  expect(report.groups?.[0]?.kind).toBe('value_mapping');
  expect(texts[0]).toContain('different vocabulary');
});
it('separates mixed planted causes over seeded permutations', async () => {
  let seed = 1108;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let trial = 0; trial < 12; trial++) {
    const a = Array.from({ length: 24 }, (_, i) => ({
      id: String(i),
      status: i < 6 ? 'Delivered' : i < 12 ? 'In transit' : 'N',
      units: 1,
    }));
    const b = a.map((row, i) => ({
      ...row,
      status: i < 3 ? 'delivered' : i >= 6 && i < 9 ? 'In  transit' : i >= 12 && i < 15 ? 'Y' : row.status,
      units: i >= 18 && i < 21 ? 2 : 1,
    }));
    for (let i = b.length - 1; i > 0; i--) {
      const j = random() % (i + 1);
      [b[i], b[j]] = [b[j]!, b[i]!];
    }
    const { report } = await run(a, b);
    expect(report.groups?.map((g) => [g.kind, g.cause ?? null, g.count]).sort()).toEqual(
      [
        ['formatting_difference', 'case_only', 3],
        ['formatting_difference', 'whitespace_only', 3],
        ['value_mapping', 'stale_value', 3],
        ['number_change', null, 3],
      ].sort(),
    );
    expect(report.groups?.flatMap((g) => g.findingIndexes ?? []).length).toBe(12);
  }
});
