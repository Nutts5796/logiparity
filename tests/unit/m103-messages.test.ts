import { expect, it } from 'vitest';
import {
  compareEntities,
  entitySchema,
  consoleReport,
  markdownReport,
  htmlReport,
  humanFinding,
  type DataRow,
} from '@logiparity/core';
import { checkedReport } from '../../scripts/validate-report.mjs';
const source = { type: 'csv', file: 'unused', fields: { id: 'id', value: { path: 'value', label: 'At' } } };
it.each([
  ['02134', 2134],
  ['0.3', 0.30000000000000004],
])('shows untyped inputs exactly, with no numeric difference: %s', async (a, b) => {
  const entity = entitySchema.parse({ name: 'row', key: 'id', sources: { a: source, b: source } });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield { id: 'O1', value: name === 'a' ? a : b };
    }),
  );
  const human = humanFinding(report.findings[0]!, { entities: [entity] });
  expect(human.reference).toBe(String(a));
  expect(human.sourceValue).toBe(String(b));
  expect(human.difference).toBe('—');
});
it('prints actual written paths and retains instructions only for console-only output (Crowd9 all reviewers)', async () => {
  const entity = entitySchema.parse({ name: 'row', key: 'id', sources: { a: source, b: source } });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      for (let i = 0; i < 15; i++) yield { id: String(i), value: name };
    }),
  );
  const written = consoleReport(report, { entities: [entity], reportFiles: ['logiparity-demo/report/report.html'] });
  expect(written).toContain('Full report: logiparity-demo/report/report.html');
  expect(written).not.toContain('Write the complete report with');
  expect(consoleReport(report)).toContain('Write the complete report with');
});
it('uses facility zones in Markdown and neutral zero differences in HTML (Crowd9 Tom/Maria)', async () => {
  const fields = { id: 'id', value: 'value', zone: 'zone' };
  const entity = entitySchema.parse({
    name: 'row',
    key: 'id',
    sources: { a: { ...source, fields }, b: { ...source, fields } },
    compare: { value: { type: 'datetime', displayTimezoneField: 'zone' } },
    aggregates: [{ name: 'count', type: 'count' }],
  });
  const rows: DataRow[] = [{ id: 'O1', value: '2026-11-03T12:00:00Z', zone: 'America/Chicago' }];
  const report = await checkedReport(
    compareEntities([entity], async function* () {
      yield* rows;
    }),
  );
  expect(markdownReport(report, { entities: [entity] })).toContain('Dates use each facility');
  expect(htmlReport(report, { entities: [entity] })).not.toContain('sub-l neg">0');
});
it.each(['At', 'V'])('keeps short field display labels in cause sentences: %s', async (label) => {
  const fields = { id: 'id', value: { path: 'value', label } };
  const entity = entitySchema.parse({
    name: 'row',
    key: 'id',
    sources: {
      a: { type: 'csv', label: 'Reference API', file: 'a', fields },
      b: { type: 'csv', label: 'Export file', file: 'b', fields },
    },
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      for (let i = 0; i < 3; i++) yield { id: String(i), value: name };
    }),
  );
  expect(report.groups?.[0]?.summary).toContain(`3 ${label} values in Export file`);
});
it('uses configured labels in rollup diagnostics and currency sentences (Crowd9 Tom/Raj/Karen)', async () => {
  const fields = {
    id: { path: 'ID', label: 'Load' },
    pay: { path: 'Pay', label: 'Carrier pay' },
    status: { path: 'Status', label: 'Delivery status' },
    code: { path: 'Code', label: 'Charge' },
    cur: 'cur',
  };
  const entity = entitySchema.parse({
    name: 'load',
    key: 'id',
    sources: {
      a: { type: 'csv', label: 'TMS', file: 'a', fields, currencyField: 'cur' },
      b: {
        type: 'csv',
        label: 'Portal',
        file: 'b',
        fields,
        currencyField: 'cur',
        rollup: { by: 'id', sum: ['pay'], first: ['status', 'cur'], duplicates: { by: ['id', 'code'] } },
      },
    },
    compare: { pay: { type: 'money', currency: 'USD' }, status: { type: 'enum' } },
  });
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      if (name === 'a') {
        yield { id: 'L1', pay: '10.00', status: 'delivered', cur: 'USD' };
        yield { id: 'L2', pay: '1.00', status: 'delivered', cur: 'USD' };
      } else {
        yield { id: 'L1', code: 'fuel', pay: '', status: 'delivered', cur: 'USD' };
        yield { id: 'L1', code: 'linehaul', pay: '10.00', status: 'in_transit', cur: 'USD' };
        yield { id: 'L2', code: 'fuel', pay: '1.00', status: 'delivered', cur: 'CAD' };
      }
    }),
  );
  const messages = report.findings.map((f) => f.message).join('\n');
  expect(messages).toContain('Carrier pay is (blank)');
  expect(messages).toContain('Delivery status has conflicting values');
  expect(messages).toContain('Currency differs: USD on TMS, CAD on Portal');
});
