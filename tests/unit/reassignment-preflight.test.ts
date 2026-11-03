import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { checkBuiltin, type InvariantState } from '@logiparity/scenarios';
import { scenarioFixture } from '../../packages/scenarios/src/preflight.js';
function state(): InvariantState {
  const before = {
    orders: [
      { id: 'L1', status: 'in_transit' },
      { id: 'done', status: 'delivered' },
    ],
    assignments: [
      { id: 'a', order_id: 'L1', driver_id: 'D1' },
      { id: 'b', order_id: 'done', driver_id: 'D1' },
    ],
    drivers: [
      { id: 'D1', vehicle_id: 'V1' },
      { id: 'D2', vehicle_id: 'V2' },
    ],
  };
  return {
    before,
    after: structuredClone(before),
    events: [{ step: 1, type: 'driver_no_show', params: { driver: 'D1' } }],
    affectedKeys: ['L1'],
    cancelledKeys: [],
  };
}
it('fails reassignment when the replan never ran, then passes a changed assignee', () => {
  const input = state();
  expect(checkBuiltin('affected_reassigned', input)).toMatchObject({
    passed: false,
    affectedKeys: ['L1'],
    assignments: [{ key: 'L1', before: ['D1'], after: ['D1'] }],
  });
  input.after.assignments![0]!.driver_id = 'D2';
  expect(checkBuiltin('affected_reassigned', input).passed).toBe(true);
});
it('handles a breakdown identified by vehicle and fails lost or multiply assigned affected orders', () => {
  const input = state();
  input.events = [{ step: 1, type: 'vehicle_breakdown', params: { vehicle: 'V1' } }];
  input.after.assignments = [];
  expect(checkBuiltin('affected_reassigned', input).affectedKeys).toEqual(['L1']);
  input.after.assignments = [
    { id: 'a', order_id: 'L1', driver_id: 'D2' },
    { id: 'b', order_id: 'L1', driver_id: 'D2' },
  ];
  expect(checkBuiltin('affected_reassigned', input).passed).toBe(false);
});
it('confines setup fixtures using realpath, including symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logiparity-fixture-'));
  try {
    await mkdir(join(root, 'scenario'));
    await writeFile(join(root, 'outside.json'), '{}');
    await writeFile(join(root, 'scenario/inside.json'), '{}');
    await symlink(join(root, 'outside.json'), join(root, 'scenario/link.json'));
    await expect(scenarioFixture(join(root, 'scenario'), 'inside.json')).resolves.toEqual({});
    await expect(scenarioFixture(join(root, 'scenario'), '../outside.json')).rejects.toThrow('stay within');
    await expect(scenarioFixture(join(root, 'scenario'), 'link.json')).rejects.toThrow('stay within');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
