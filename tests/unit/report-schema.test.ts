import Ajv from 'ajv';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { compareEntities, entitySchema, jsonReport } from '@logiparity/core';
it('validates generated reports against the published additive version-1 JSON Schema', async () => {
  const schema = JSON.parse(await readFile('docs/report-schema.json', 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const source = { type: 'csv', file: 'unused', fields: { id: 'id', amount: 'amount' } };
  const entity = entitySchema.parse({
    name: 'order',
    key: 'id',
    sources: { a: source, b: source },
    compare: { amount: { type: 'money', currency: 'USD' } },
    aggregates: [{ name: 'pay', type: 'sum', field: 'amount' }],
  });
  const report = await compareEntities([entity], async function* (name) {
    for (let i = 0; i < 4; i++) yield { id: `O${i}`, amount: name === 'a' ? '1.00' : i === 3 ? 'bad' : '1.01' };
  });
  expect(validate(JSON.parse(jsonReport(report))), JSON.stringify(validate.errors)).toBe(true);
  expect(validate({ ...JSON.parse(jsonReport(report)), futureField: { optional: true } })).toBe(true);
  expect(
    validate({
      schemaVersion: 1,
      entities: [],
      findings: [],
      groups: [
        { entity: 'o', source: 'b', field: 'pay', kind: 'money_delta', count: 1, summary: 'Impossible pattern' },
      ],
    }),
  ).toBe(false);
});
