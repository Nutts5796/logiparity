import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
const file = process.argv[2] ?? 'docs/evaluation/fmcsa-sample-for-review.csv';
const rows = parse(await readFile(file, 'utf8'), { columns: true, skip_empty_lines: true });
const counts = { correct: 0, misleading: 0, wrong: 0, unreviewed: 0 };
const ids = new Set();
for (const row of rows) {
  if (!row.sample_id || ids.has(row.sample_id)) throw new Error('Review sample IDs must be present and unique.');
  ids.add(row.sample_id);
  const verdict = row.reviewer_verdict.trim();
  if (!verdict) {
    counts.unreviewed++;
    continue;
  }
  if (!['correct', 'misleading', 'wrong'].includes(verdict))
    throw new Error(`Unknown verdict on sample ${row.sample_id}; choose correct / misleading / wrong.`);
  counts[verdict]++;
}
console.log(
  JSON.stringify(
    {
      sample: rows.length,
      ...counts,
      realDataAccuracy:
        counts.unreviewed === 0 && rows.length
          ? counts.correct / rows.length
          : 'not measured (human review incomplete)',
      denominator: 'only this sampled population; not all FMCSA findings',
    },
    null,
    2,
  ),
);
