import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { generateCase, evaluate, guardFailures } from '../evaluation/causes.js';
it('reproduces seeded truth independently and reports ambiguous mislabels and support limits', async () => {
  const c = generateCase(7, 96);
  expect(c).toEqual(generateCase(7, 96));
  const r = await evaluate([c]);
  expect(r.rows.every((row) => row.found === row.planted)).toBe(true);
  expect(r.rows.find((row) => row.category === 'stale_status')?.correctlyLabelled).toBeGreaterThan(0);
  expect(r.rows.find((row) => row.category === 'stale_without_anchor')?.mislabelled).toBeGreaterThan(0);
  expect(r.rows.find((row) => row.category === 'vocabulary_reused_codes')?.mislabelled).toBeGreaterThan(0);
  expect(r.rows.find((row) => row.category === 'numeric_below_support')?.ungrouped).toBe(2);
  expect(r.rows.find((row) => row.category === 'date_only')?.groupable).toBe(false);
  expect(r.groups.every((g) => g.members === g.correct + g.wrong + g.unplanted)).toBe(true);
});
it('counts a wrong label, rather than blessing observed output as expected truth', async () => {
  const c = generateCase(7, 96);
  const plant = c.truth.find((p) => p.category === 'case_only')!;
  plant.expected = 'deliberately-wrong-label';
  const result = await evaluate([c]);
  expect(result.correct[plant.id]).toBeUndefined();
  expect(result.rows.find((r) => r.category === 'case_only')?.mislabelled).toBe(1);
});

it('preserves every previously correct planted label without imposing an accuracy threshold', async () => {
  const guard = JSON.parse(await readFile('tests/fixtures/evaluation/correct-labels.json', 'utf8'));
  const result = await evaluate(
    [7, 42, 1203].flatMap((seed) => [96, 360, 1024].map((size) => generateCase(seed, size))),
  );
  expect(guardFailures(guard, result.correct)).toEqual([]);
});
