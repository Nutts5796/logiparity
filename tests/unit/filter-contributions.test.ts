import { expect, it } from 'vitest';
import { compareEntities, entitySchema, reportExitCode, type DataRow, type EntityConfig } from '@logiparity/core';
const source = {
  type: 'csv',
  file: 'unused',
  fields: { id: 'id', amount: 'amount', status: 'status', stops: 'stops' },
};
function entity(options: Record<string, unknown> = {}): EntityConfig {
  return entitySchema.parse({
    name: 'order',
    key: 'id',
    sources: { reference: source, actual: source },
    compare: { amount: { type: 'money', currency: 'USD' } },
    ...options,
  });
}
async function compare(definition: EntityConfig, reference: DataRow[], actual: DataRow[]) {
  return compareEntities([definition], async function* (name) {
    yield* name === 'reference' ? reference : actual;
  });
}
it('matches numeric where values and numeric keys against canonical CSV text (raj/t1)', async () => {
  for (const where of [{ stops: 5 }, { id: 5 }]) {
    const definition = entity({ sources: { reference: { ...source, where }, actual: { ...source, where } } });
    const report = await compare(
      definition,
      [{ id: '5', stops: '5', amount: '100.00' }],
      [{ id: '5', stops: '5', amount: '115.00' }],
    );
    expect(report.entities[0]?.counts).toEqual({ reference: 1, actual: 1 });
    expect(reportExitCode(report)).toBe(1);
  }
});
it('matches text filters case-insensitively by default and supports an explicit case-sensitive filter (tom)', async () => {
  for (const caseSensitive of [false, true]) {
    const filtered = { ...source, where: { status: { not: ['void'] } }, caseSensitive };
    const report = await compare(
      entity({ sources: { reference: filtered, actual: filtered } }),
      [{ id: 'A', status: 'Void' }],
      [{ id: 'A', status: 'Void' }],
    );
    expect(report.entities[0]?.counts.reference).toBe(caseSensitive ? 1 : 0);
    if (!caseSensitive) expect(report.warnings?.[0]?.message).toContain('All');
  }
});
it('traces the delivered total to an extra row instead of unrelated fixed differences (raj/t2)', async () => {
  const reference = Array.from({ length: 6 }, (_, index) => ({
    id: `O${index + 1}`,
    amount: '100.00',
    status: index < 3 ? 'in_transit' : 'delivered',
  }));
  const actual = reference.map((row, index) => ({ ...row, amount: index < 3 ? '101.00' : row.amount }));
  actual.push({ id: 'O7', amount: '3.00', status: 'delivered' });
  const report = await compare(
    entity({ aggregates: [{ name: 'delivered_pay', type: 'sum', field: 'amount', where: { status: 'delivered' } }] }),
    reference,
    actual,
  );
  const parts = report.entities[0]?.aggregates?.[0]?.reconciliation?.actual;
  expect(parts).toMatchObject({ extraRows: { count: 1, amount: 300n }, patterns: [], remainder: 0n });
  expect(report.findings.find((finding) => finding.type === 'aggregate_mismatch')?.accounting?.causes).toEqual([
    'extra rows',
  ]);
});
it('traces a listed one-off amount difference and keeps that individual finding for review (tom/karen)', async () => {
  const report = await compare(
    entity({ aggregates: [{ name: 'pay', type: 'sum', field: 'amount' }] }),
    [{ id: 'L102', amount: '100.00' }],
    [{ id: 'L102', amount: '115.00' }],
  );
  expect(report.groups).toEqual([]);
  expect(report.entities[0]?.aggregates?.[0]?.reconciliation?.actual).toMatchObject({
    valueDifferences: { count: 1, amount: 1500n },
    remainder: 0n,
  });
  expect(report.coverage).toEqual({ explained: 1, needsReview: 1 });
});
it('keeps aggregate accounting equal to independently computed qualifying contributions for generated datasets', async () => {
  let seed = 537;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const money = (minor: number) => (minor / 100).toFixed(2);
  const definition = entity({
    compare: { amount: { type: 'money', currency: 'USD', tolerance: 1 } },
    aggregates: [{ name: 'pay', type: 'sum', field: 'amount', where: { status: ['delivered'] } }],
  });
  for (let sample = 0; sample < 120; sample++) {
    const reference: DataRow[] = [],
      actual: DataRow[] = [];
    let missing = 0n,
      extra = 0n,
      listed = 0n,
      unmatched = 0n;
    for (let index = 0; index < 8; index++) {
      const amount = 10000 + random(1000),
        delta = random(7) - 3;
      const status = random(2) ? 'delivered' : 'in_transit';
      const baseline = { id: `O${index}`, amount: money(amount), status };
      reference.push(baseline);
      if (random(5) === 0) {
        if (status === 'delivered') missing -= BigInt(amount);
        continue;
      }
      const actualStatus = random(3) === 0 ? (status === 'delivered' ? 'in_transit' : 'delivered') : status;
      actual.push({ ...baseline, status: actualStatus, amount: money(amount + delta) });
      if (actualStatus !== status)
        listed += BigInt((actualStatus === 'delivered' ? amount + delta : 0) - (status === 'delivered' ? amount : 0));
      else if (status === 'delivered') {
        if (Math.abs(delta) > 1) listed += BigInt(delta);
        else unmatched += BigInt(delta);
      }
    }
    if (random(2)) {
      actual.push({ id: 'extra', amount: '1.85', status: 'delivered' });
      extra = 185n;
    }
    const report = await compare(definition, reference, actual);
    const total = report.entities[0]?.aggregates?.[0];
    const parts = total?.reconciliation?.actual;
    expect(parts, `sample ${sample}`).toBeDefined();
    expect(parts?.missingRows.amount).toBe(missing);
    expect(parts?.extraRows?.amount ?? 0n).toBe(extra);
    const known = (parts?.patterns ?? []).reduce(
      (sum, part) => sum + BigInt(part.amount),
      BigInt(parts?.valueDifferences?.amount ?? 0),
    );
    expect(known, `sample ${sample}`).toBe(listed);
    expect(parts?.remainder, `sample ${sample}`).toBe(unmatched);
    expect(BigInt(total?.values.actual ?? 0) - BigInt(total?.values.reference ?? 0)).toBe(
      missing + extra + listed + unmatched,
    );
    if (report.findings.some((item) => item.accounting)) expect(unmatched).toBe(0n);
  }
});
