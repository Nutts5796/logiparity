import { checkedReport } from '../../scripts/validate-report.mjs';
import { expect, it } from 'vitest';
import {
  scenarioConsole,
  scenarioHtml,
  scenarioJunit,
  scenarioMarkdown,
  type ScenarioReport,
} from '../../packages/scenarios/src/report.js';
import { compareEntities, entitySchema, type DataRow } from '@logiparity/core';
import { patternCards } from '../../packages/core/src/html-patterns.js';
it('counts post-scenario parity consistently and prints its result and runtime reason (maria N2, sam)', () => {
  const report: ScenarioReport = {
    schemaVersion: 1,
    kind: 'scenario',
    name: 'Breakdown',
    target: 'demo',
    environment: 'test',
    events: [],
    invariants: [{ name: 'no_order_lost', passed: false, affectedKeys: ['O1'], explanation: 'One lost order' }],
    parity: {
      schemaVersion: 1,
      entities: [],
      findings: [
        { type: 'field_mismatch', entity: 'order', source: 'export', key: 'O1', field: 'pay', message: 'differs' },
      ],
    },
    exitCode: 1,
  };
  expect(scenarioJunit(report)).toContain('failures="2"');
  for (const text of [scenarioConsole(report), scenarioHtml(report), scenarioMarkdown(report)]) {
    expect(text).toContain('2 checks need attention');
    expect(text).toMatch(/Post-scenario parity/i);
  }
  report.parity!.findings = [
    { type: 'source_error', entity: 'order', source: 'export', key: '', field: '', message: 'connection refused' },
  ];
  report.exitCode = 2;
  expect(scenarioConsole(report)).toContain('connection refused');
});
it('groups a page stride across an unrelated lost key and counts every missing tile row (maria N1)', async () => {
  const source = { type: 'csv', file: 'unused', fields: { id: 'id' } };
  const entity = entitySchema.parse({
    name: 'order',
    key: 'id',
    sources: {
      api: {
        type: 'rest',
        baseUrl: 'http://test.invalid',
        path: '/',
        fields: { id: '$.id' },
        pagination: { type: 'page', size: 200 },
      },
      xlsx: source,
    },
  });
  // The lost order is absent from both surfaces after the scenario, between two runs of page-boundary gaps.
  const rows: DataRow[] = Array.from({ length: 2750 }, (_, i) => ({ id: `S${String(i + 1).padStart(6, '0')}` }));
  const report = await checkedReport(
    compareEntities([entity], async function* (name) {
      yield* name === 'api'
        ? rows
        : rows.filter((r) => Number(String(r.id).slice(1)) % 200 !== 0 && r.id !== 'S002750' && r.id !== 'S000801');
    }),
  );
  expect(report.groups).toHaveLength(1);
  expect(report.groups?.[0]?.count).toBe(14);
  const card = patternCards(report, { entities: [entity] })[0];
  expect(card?.chart.match(/199\/200/g)?.length).toBe(12);
});
