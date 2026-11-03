import { expect, it } from 'vitest';
import { compareEntities, entitySchema, humanFinding } from '@logiparity/core';
import { seedData } from '../../apps/demo-delivery/src/seed.js';
import { checkedReport } from '../../scripts/validate-report.mjs';
it('suggests an unmapped charge code only for a unique equal-amount pair on the same load (tom)', async () => {
  const config = entitySchema.parse({
    name: 'charge',
    key: ['load', 'code'],
    sources: {
      a: { type: 'csv', file: 'a', fields: { load: 'load', code: 'code', amount: 'amount' } },
      b: { type: 'csv', file: 'b', fields: { load: 'load', code: 'code', amount: 'amount' } },
    },
    compare: { amount: { type: 'money', currency: 'USD' } },
  });
  const report = await checkedReport(
    compareEntities([config], async function* (name) {
      yield { load: 'L1', code: name === 'a' ? 'FSC' : 'fuel_sc', amount: '10.00' };
      yield { load: 'L2', code: name === 'a' ? 'STP' : 'stop', amount: name === 'a' ? '10.00' : '11.00' };
    }),
  );
  expect(report.findings.filter((f) => f.hint)).toHaveLength(2);
  expect(report.findings.filter((f) => f.hint).every((f) => f.keyParts?.[0] === 'L1')).toBe(true);
});
it('displays each freight finding in its mapped facility zone without changing UTC normalization', async () => {
  const source = { type: 'csv', file: 'unused', fields: { id: 'id', at: 'at', zone: 'zone' } };
  const config = entitySchema.parse({
    name: 'load',
    key: 'id',
    sources: { a: source, b: source },
    compare: { at: { type: 'datetime', displayTimezoneField: 'zone' } },
  });
  const report = await checkedReport(
    compareEntities([config], async function* (name) {
      yield {
        id: 'L1',
        at: name === 'a' ? '2026-11-02T15:00:00Z' : '2026-11-02T16:00:00Z',
        zone: 'America/Los_Angeles',
      };
    }),
  );
  const finding = report.findings[0]!;
  expect(finding.expected).toBe(Date.parse('2026-11-02T15:00:00Z'));
  expect(humanFinding(finding, { entities: [config] }).reference).toContain('7:00 AM PST');
});
it('reports an invalid demo day before formatting it', () => {
  expect(() => seedData('2026-99-99')).toThrow('valid ISO date');
});
it('keeps TONU loads cancelled with a sole charge and varies commercial accessorial amounts (karen, tom)', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = async (name: string) =>
    (await readFile(new URL('../../examples/freight/' + name, import.meta.url), 'utf8'))
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','));
  const loads = await read('tms-loads.csv'),
    confirmed = await read('rate-confirmation-lines.csv'),
    settlement = await read('carrier-settlement-lines.csv');
  expect(loads).toHaveLength(120);
  for (const id of ['L144', 'L155', 'L166']) {
    expect(loads.find((r) => r[0] === id)?.slice(2, 5)).toEqual(['250.00', 'cancelled', '']);
    expect(confirmed.filter((r) => r[0] === id).map((r) => r[2])).toEqual(['tonu']);
    expect(settlement.filter((r) => r[0] === id).map((r) => r[2])).toEqual(id === 'L155' ? [] : ['tonu']);
  }
  for (const code of ['detention', 'lumper', 'layover', 'claim_deduction'])
    expect(new Set(confirmed.filter((r) => r[2] === code).map((r) => r[3])).size).toBeGreaterThan(2);
});
