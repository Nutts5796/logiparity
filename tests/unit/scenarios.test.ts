import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import {
  affectedBy,
  canonical,
  checkBuiltin,
  requiredStateSources,
  validateState,
  prepareInvariant,
  scenarioSchema,
  targetSchema,
  scenarioHtml,
  scenarioJunit,
  type InvariantState,
  type ScenarioReport,
} from '@logiparity/scenarios';
import { renderTemplate, requestPlan, targetHeaders } from '../../packages/scenarios/src/http.js';
const at = '2026-11-02T08:00:00Z';
function state(): InvariantState {
  const before = {
    orders: [
      {
        id: 'S1',
        status: 'in_transit',
        units: 1,
        zone: 'Z1',
        eta: '2026-11-02T10:00:00Z',
        delivery_end: '2026-11-02T20:00:00Z',
      },
    ],
    drivers: [{ id: 'D1', vehicle_id: 'V1', available: true }],
    vehicles: [{ id: 'V1', capacity: 2, operational: true }],
    assignments: [{ id: 'A1', order_id: 'S1', driver_id: 'D1' }],
    notifications: [],
    meta: [{ id: 'state', replan_status: 'completed', clock: at }],
  };
  const after = structuredClone(before) as InvariantState['after'];
  after.orders![0]!.eta = '2026-11-02T11:00:00Z';
  after.notifications = [{ id: 'N1', order_id: 'S1', type: 'replanned', created_at: at }];
  return {
    before,
    after,
    events: [{ step: 1, type: 'vehicle_breakdown', params: { driver: 'D1' } }],
    affectedKeys: ['S1'],
    cancelledKeys: [],
  };
}
it('passes every healthy builtin and derives affected orders from the original assignment', () => {
  const s = state();
  expect(affectedBy(canonical(s.before), s.events)).toEqual({ affectedKeys: ['S1'], cancelledKeys: [] });
  for (const name of [
    'no_order_lost',
    'single_assignment',
    'capacity_respected',
    'eta_updated_for_affected',
    'customer_notified_for_affected',
  ] as const)
    expect(checkBuiltin(name, s).passed).toBe(true);
  expect(checkBuiltin({ sla_window_violations: { max: 0 } }, s).passed).toBe(true);
});
it('finds a lost order even if its assignment and notification disappear too', () => {
  const s = state();
  s.after.orders = [];
  s.after.assignments = [];
  s.after.notifications = [];
  expect(checkBuiltin('no_order_lost', s)).toMatchObject({ passed: false, affectedKeys: ['S1'] });
  expect(checkBuiltin('eta_updated_for_affected', s).passed).toBe(false);
  expect(checkBuiltin('customer_notified_for_affected', s).passed).toBe(false);
});
it('detects double assignment, orphan assignment, invalid resources and overloaded shared vehicles', () => {
  const s = state();
  s.after.assignments!.push({ id: 'A2', order_id: 'S1', driver_id: 'D1' });
  expect(checkBuiltin('single_assignment', s).affectedKeys).toEqual(['S1']);
  s.after.vehicles![0]!.capacity = 1;
  expect(checkBuiltin('capacity_respected', s).affectedKeys).toEqual(['S1']);
  s.after.vehicles![0]!.capacity = 10;
  s.after.drivers![0]!.available = false;
  expect(checkBuiltin('capacity_respected', s).passed).toBe(false);
  s.after.assignments!.push({ id: 'A3', order_id: 'missing', driver_id: 'D1' });
  expect(checkBuiltin('single_assignment', s).affectedKeys).toEqual(['S1', 'missing']);
});
it('requires cancellation retention with zero assignments and a fresh notification', () => {
  const s = state();
  s.cancelledKeys = ['S1'];
  s.after.orders![0]!.status = 'cancelled';
  s.after.assignments = [];
  expect(checkBuiltin('no_order_lost', s).passed).toBe(true);
  expect(checkBuiltin('single_assignment', s).passed).toBe(true);
  expect(checkBuiltin('eta_updated_for_affected', s).passed).toBe(true);
  s.before.notifications = structuredClone(s.after.notifications!);
  expect(checkBuiltin('customer_notified_for_affected', s).passed).toBe(false);
  s.after.orders![0]!.status = 'in_transit';
  expect(checkBuiltin('single_assignment', s).passed).toBe(false);
});
it('counts SLA violations against the configured maximum and compares ETA instants', () => {
  const s = state();
  s.after.orders![0]!.eta = '2026-11-02T21:00:00Z';
  expect(checkBuiltin({ sla_window_violations: { max: 0 } }, s).passed).toBe(false);
  expect(checkBuiltin({ sla_window_violations: { max: 1 } }, s).passed).toBe(true);
  s.after.orders![0]!.eta = '2026-11-02T12:00:00+02:00';
  expect(checkBuiltin('eta_updated_for_affected', s).passed).toBe(false);
});
it('rejects duplicate IDs and unknown event references before event injection', () => {
  const s = state();
  expect(() =>
    affectedBy(canonical(s.before), [{ step: 1, type: 'driver_no_show', params: { driver: 'missing' } }]),
  ).toThrow('Unknown');
  s.before.orders!.push(s.before.orders![0]!);
  expect(() => canonical(s.before)).toThrow('Duplicate');
});
it('supports expected JSONPath values and trusted TypeScript custom invariants without mutating state', async () => {
  const s = state();
  const check = await prepareInvariant(
    { name: 'completed', jsonPath: '$.after.meta[0].replan_status', expected: 'completed' },
    '.',
  );
  expect((await check(s)).passed).toBe(true);
  const absent = await prepareInvariant({ name: 'absent', jsonPath: '$.after.missing', expected: true }, '.');
  expect((await absent(s)).passed).toBe(false);
  await expect(prepareInvariant({ name: 'unsafe', jsonPath: '$..orders', expected: [] }, '.')).rejects.toThrow(
    'Unsupported',
  );
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-invariant-'));
  try {
    await writeFile(
      join(dir, 'check.ts'),
      `export default (state: { affectedKeys: string[] }) => { state.affectedKeys.push('MUTATED'); return {name:'custom',passed:true,affectedKeys:[],explanation:'TypeScript loaded'}; }`,
    );
    const custom = await prepareInvariant({ name: 'typed', module: './check.ts' }, dir, true);
    expect(await custom(s)).toMatchObject({ name: 'typed', passed: true });
    expect(s.affectedKeys).toEqual(['S1']);
    await writeFile(join(dir, 'invalid.ts'), 'export default 42');
    await expect(prepareInvariant({ name: 'invalid', module: './invalid.ts' }, dir, true)).rejects.toThrow(
      'default function',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('validates explicit mutation consent, step uniqueness, artifact paths and request destinations', () => {
  const input = {
    version: 1,
    name: 'test',
    target: 'demo',
    events: [
      { step: 1, type: 'http' },
      { step: 1, type: 'http' },
    ],
    wait: { until: { done: true } },
    invariants: ['no_order_lost'],
  };
  expect(scenarioSchema.safeParse(input).success).toBe(false);
  const raw = {
    version: 1,
    name: 'demo',
    baseUrl: 'http://127.0.0.1:3010',
    events: {},
    state: { meta: { type: 'rest', baseUrl: 'http://127.0.0.1:3010', path: '/state', fields: { id: '$.id' } } },
  };
  expect(targetSchema.safeParse(raw).success).toBe(false);
  const target = targetSchema.parse({ ...raw, environment: 'test', allowMutations: true, allowedHosts: ['127.0.0.1'] });
  expect(
    requestPlan(target, { method: 'POST', path: '{{params.path}}' }, { params: { path: 'https://elsewhere.test/' } })
      .url.origin,
  ).toBe('http://127.0.0.1:3010');
  expect(() => requestPlan(target, { method: 'GET', path: '/', body: {} }, {})).toThrow('GET');
  expect(renderTemplate('/driver/{{params.id}}', { params: { id: 'a/b' } }, true)).toBe('/driver/a%2Fb');
  expect(renderTemplate({ capacity: '{{params.capacity}}' }, { params: { capacity: 25 } })).toEqual({ capacity: 25 });
  expect(() => renderTemplate('{{constructor}}', {})).toThrow('placeholder');
  expect(() => targetHeaders({ ...target, headersEnv: { authorization: 'TOKEN' } }, {})).toThrow('TOKEN');
  expect(targetSchema.safeParse({ ...target, artifacts: [{ path: '/', file: '../escape.csv' }] }).success).toBe(false);
});
it('escapes scenario reports and retains affected keys in JUnit', () => {
  const report: ScenarioReport = {
    schemaVersion: 1,
    kind: 'scenario',
    name: '<script>',
    target: 'demo',
    environment: 'test',
    events: [],
    invariants: [{ name: 'lost', passed: false, affectedKeys: ['S1'], explanation: '<missing>' }],
    exitCode: 1,
  };
  expect(scenarioHtml(report).match(/<script>/g)).toHaveLength(1);
  expect(scenarioHtml(report)).not.toContain('<script></');
  expect(scenarioHtml(report)).toContain('&lt;missing&gt;');
  expect(scenarioJunit(report)).toContain('Affected keys: S1');
});
it('accepts exact CSV scalar encodings without treating false as truthy', () => {
  const s = state();
  s.before.drivers![0]!.available = 'false';
  s.before.vehicles![0]!.capacity = '25';
  s.before.orders![0]!.units = '1';
  expect(canonical(s.before).drivers[0]?.available).toBe(false);
  expect(canonical(s.before).vehicles[0]?.capacity).toBe(25);
  s.before.drivers![0]!.available = 'yes';
  expect(() => canonical(s.before)).toThrow();
});

it('validates only the state and fields needed by selected invariants', () => {
  const minimal = {
    orders: [{ id: 'S1', status: 'in_transit' }],
    assignments: [{ id: 'A1', order_id: 'S1', driver_id: 'D1' }],
  };
  const selected = ['no_order_lost', 'single_assignment'] as const;
  expect(requiredStateSources(selected)).toEqual(['assignments', 'orders']);
  expect(() => validateState(minimal, selected)).not.toThrow();
  const context = { before: minimal, after: structuredClone(minimal), events: [], affectedKeys: [], cancelledKeys: [] };
  expect(checkBuiltin('single_assignment', context).passed).toBe(true);
  expect(checkBuiltin('no_order_lost', context).passed).toBe(true);
  expect(() => validateState(minimal, ['capacity_respected'])).toThrow();
  expect(
    requiredStateSources(
      ['eta_updated_for_affected'],
      [{ step: 1, type: 'capacity_change', params: { vehicle: 'V1', capacity: 25 } }],
    ),
  ).toContain('drivers');
  const lost = { ...context, after: { orders: [], assignments: [] } };
  expect(checkBuiltin('no_order_lost', lost).affectedKeys).toEqual(['S1']);
});
it('permits an ID-only lost-order check and an order-only SLA check', () => {
  expect(() => validateState({ orders: [{ id: 'S1' }] }, ['no_order_lost'])).not.toThrow();
  expect(() =>
    validateState(
      {
        orders: [{ id: 'S1', status: 'in_transit', eta: '2026-11-02T10:00:00Z', delivery_end: '2026-11-02T20:00:00Z' }],
      },
      [{ sla_window_violations: { max: 0 } }],
    ),
  ).not.toThrow();
});
