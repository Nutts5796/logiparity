import { createJiti } from 'jiti';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const jiti = createJiti(import.meta.url, { alias: { '@logiparity/core': resolve('packages/core/src/index.ts') } });
const { generateCase, evaluate, table, compactGuard, guardFailures } = await jiti.import(
  '../tests/evaluation/causes.ts',
);
const result = await evaluate([7, 42, 1203].flatMap((seed) => [96, 360, 1024].map((size) => generateCase(seed, size))));
console.log(
  'Synthetic cause evaluation: 3 fixed seeds × 3 sizes; mixed defects, not real-data accuracy.\n' + table(result.rows),
);
console.log(
  '\nNo group is expected for duplicate/date-only/blank/individual findings. Numeric below-support plants intentionally have two members (minimum group support is three).',
);
console.log(
  'Mislabels: ' +
    JSON.stringify(result.rows.filter((r) => r.mislabelled).map((r) => ({ category: r.category, as: r.as }))),
);
const output = resolve('output/evaluation');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'causes.json'), JSON.stringify(result, null, 2) + '\n');
const guard = 'tests/fixtures/evaluation/correct-labels.json';
if (process.argv.includes('--record-correct')) {
  await mkdir('tests/fixtures/evaluation', { recursive: true });
  const selected = compactGuard(result.correct);
  await writeFile(guard, JSON.stringify(selected, null, 2) + '\n');
  console.log('Recorded only observed labels that match independently planted truth; review the diff.');
}
if (process.argv.includes('--check')) {
  const old = JSON.parse(await readFile(guard, 'utf8'));
  const failures = guardFailures(old, result.correct);
  if (failures.length)
    throw new Error('Previously correct planted labels changed: ' + JSON.stringify(failures.slice(0, 10)));
  console.log(
    `Correct-label regression guard passed for ${old.reduce((sum, group) => sum + group.keys.length, 0)} planted findings; no accuracy threshold is applied.`,
  );
}
