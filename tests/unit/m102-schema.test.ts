import Ajv from 'ajv';
import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseCheckedJson, assertReport } from '../../scripts/validate-report.mjs';
const require = createRequire(import.meta.url);
it('exports both schemas through public package paths and uses versioned raw IDs (david)', async () => {
  for (const file of ['report-schema.json', 'scenario-report-schema.json']) {
    const schema = parseCheckedJson(await readFile(require.resolve('logiparity/' + file), 'utf8'));
    expect(schema.$id).toMatch(/^https:\/\/raw\.githubusercontent\.com\/Nutts5796\/logiparity\/v1\.1\.0\/docs\//);
  }
});
it('checks the emitted accounting, location, evidence, currency and group contracts (david)', async () => {
  const schema = parseCheckedJson(await readFile('docs/report-schema.json', 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const finding = { type: 'field_mismatch', entity: 'load', source: 'b', key: 'L1', field: 'pay', message: 'differs' };
  for (const patch of [
    { accounting: { causes: ['rounding'], remainder: 'not an integer' } },
    { referencePosition: 0 },
    { amounts: [{ field: 'pay', amount: '1.25' }] },
    { evidence: { pageSizes: [0] } },
    { relatedKeys: [1] },
  ])
    expect(
      validate({ schemaVersion: 1, entities: [], findings: [{ ...finding, ...patch }] }),
      JSON.stringify(patch),
    ).toBe(false);
  const group = {
    entity: 'load',
    source: 'b',
    field: 'pay',
    kind: 'money_delta',
    count: 3,
    summary: 'Three differences',
  };
  for (const patch of [{ cause: 3 }, { stride: '0' }, { keys: [42] }])
    expect(validate({ schemaVersion: 1, entities: [], findings: [], groups: [{ ...group, ...patch }] })).toBe(false);
  expect(
    validate({
      schemaVersion: 1,
      findings: [],
      entities: [
        {
          entity: 'load',
          reference: 'a',
          counts: {},
          aggregates: [{ name: 'total', type: 'sum', values: {}, skippedSources: [], uncertainKeys: { a: [42] } }],
        },
      ],
    }),
  ).toBe(false);
});
it('validates complete and partial-error scenario reports, including nested parity (david)', () => {
  const report = {
    schemaVersion: 1,
    kind: 'scenario',
    name: 'Breakdown',
    target: 'demo',
    environment: 'test',
    events: [],
    invariants: [],
    exitCode: 2,
    error: 'connection refused',
    parity: { schemaVersion: 1, entities: [], findings: [] },
  };
  expect(() => assertReport(report)).not.toThrow();
  expect(() =>
    assertReport({
      ...report,
      invariants: [{ name: 'no_order_lost', passed: 'yes', affectedKeys: [], explanation: 'bad type' }],
    }),
  ).toThrow('published schema');
});
