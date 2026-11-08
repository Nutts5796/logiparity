import { expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  consoleReport,
  markdownReport,
  htmlReport,
  junitReport,
  jsonReport,
} from '@logiparity/core';
import { adapters } from '@logiparity/adapters';
import { resolve } from 'node:path';

const base = resolve('tests/fixtures/m121/null-number');

it.each<[string, [string, string]]>([
  ['blank reference, numeric candidate', ['a', 'b']],
  ['numeric reference, blank candidate', ['b', 'a']],
])('renders repeated number differences against blank values (%s)', async (_, [reference, candidate]) => {
  const entity = entitySchema.parse({
    name: 'e',
    key: 'id',
    sources: {
      [reference]: { type: 'csv', file: `./${reference}.csv`, fields: { id: 'id', n: 'n' } },
      [candidate]: { type: 'csv', file: `./${candidate}.csv`, fields: { id: 'id', n: 'n' } },
    },
    compare: { n: { type: 'number' } },
  });
  const report = await compareEntities([entity], (_entity, source) =>
    adapters.read(source, { baseDir: base, env: {} }),
  );
  expect(report.findings.filter((finding) => finding.type === 'field_mismatch')).toHaveLength(3);
  const presentation = { entities: [entity] };
  expect(() => markdownReport(report, presentation)).not.toThrow();
  expect(() => htmlReport(report, presentation)).not.toThrow();
  expect(() => junitReport(report, new Date(0), presentation)).not.toThrow();
  expect(() => jsonReport(report)).not.toThrow();
  const text = consoleReport(report, presentation);
  expect(text).toContain('Difference: —');
  expect(text).not.toContain('null');
});
