import { isDeepStrictEqual } from 'node:util';
import { selectJson } from '@logiparity/adapters';
import { z } from 'zod';
import { resolve, relative, isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { canonical, canonicalFor } from './state.js';
import type { DataRow } from '@logiparity/core';
import type { Invariant, ScenarioEvent } from './config.js';

export type Snapshot = Record<string, DataRow[]>;
export interface InvariantState {
  before: Snapshot;
  after: Snapshot;
  events: ScenarioEvent[];
  affectedKeys: string[];
  cancelledKeys: string[];
}
export interface InvariantResult {
  name: string;
  passed: boolean;
  affectedKeys: string[];
  explanation: string;
  assignments?: { key: string; before: string[]; after: string[] }[];
}
const id = z.string().min(1);
const active = (status: string) => status !== 'delivered' && status !== 'cancelled';
export function affectedBy(
  before: ReturnType<typeof canonical>,
  events: ScenarioEvent[],
): { affectedKeys: string[]; cancelledKeys: string[] } {
  const keys = new Set<string>();
  const cancelled = new Set<string>();
  for (const event of events) {
    const p = event.params;
    if (event.type === 'order_cancel') {
      if (
        !Array.isArray(p.orders) ||
        !p.orders.every((v) => typeof v === 'string' && before.orders.some((o) => o.id === v))
      )
        throw new Error('order_cancel params.orders must list existing order IDs');
      for (const key of p.orders as string[]) {
        keys.add(key);
        cancelled.add(key);
      }
    } else if (event.type === 'http') {
      if (
        p.affectedKeys !== undefined &&
        (!Array.isArray(p.affectedKeys) || !p.affectedKeys.every((v) => typeof v === 'string'))
      )
        throw new Error('http params.affectedKeys must be an array of order IDs');
      for (const key of (p.affectedKeys ?? []) as string[]) keys.add(key);
    } else {
      const drivers =
        (event.type === 'capacity_change' || event.type === 'vehicle_breakdown') && p.vehicle
          ? before.drivers.filter((d) => d.vehicle_id === p.vehicle).map((d) => d.id)
          : [p.driver];
      if (
        event.type === 'traffic_delay'
          ? !before.orders.some((o) => o.zone === p.zone)
          : !before.drivers.some((d) => drivers.includes(d.id)) &&
            !before.assignments.some((a) => drivers.includes(a.driver_id))
      )
        throw new Error(`Unknown driver, vehicle or zone in ${event.type}`);
      for (const o of before.orders.filter((o) => active(o.status)))
        if (
          event.type === 'traffic_delay'
            ? o.zone === p.zone
            : before.assignments.some((a) => a.order_id === o.id && drivers.includes(a.driver_id))
        )
          keys.add(o.id);
    }
  }
  return { affectedKeys: [...keys].sort(), cancelledKeys: [...cancelled].sort() };
}
export function checkBuiltin(definition: Invariant, state: InvariantState): InvariantResult {
  const before = canonicalFor(state.before, [definition], state.events);
  const after = canonicalFor(state.after, [definition], state.events);
  const name = typeof definition === 'string' ? definition : 'sla_window_violations';
  const failed = new Set<string>();
  const byId = new Map(after.orders.map((o) => [o.id, o]));
  switch (name) {
    case 'no_order_lost':
      for (const o of before.orders) if (!byId.has(o.id)) failed.add(o.id);
      break;
    case 'single_assignment': {
      for (const o of after.orders)
        if (after.assignments.filter((a) => a.order_id === o.id).length !== (o.status === 'cancelled' ? 0 : 1))
          failed.add(o.id);
      for (const a of after.assignments) if (!byId.has(a.order_id)) failed.add(a.order_id);
      for (const key of state.cancelledKeys) if (byId.get(key)?.status !== 'cancelled') failed.add(key);
      break;
    }
    case 'affected_reassigned': {
      const affected = affectedBy(
        before,
        state.events.filter((event) => event.type === 'driver_no_show' || event.type === 'vehicle_breakdown'),
      ).affectedKeys;
      for (const key of affected) {
        if (byId.get(key)?.status === 'cancelled' && !after.assignments.some((item) => item.order_id === key)) continue;
        const prior = before.assignments.filter((item) => item.order_id === key).map((item) => item.driver_id);
        const current = after.assignments.filter((item) => item.order_id === key).map((item) => item.driver_id);
        if (!byId.has(key) || current.length !== 1 || current.some((driver) => prior.includes(driver))) failed.add(key);
      }
      break;
    }
    case 'capacity_respected': {
      const loads = new Map<string, { units: number; keys: string[] }>();
      for (const a of after.assignments) {
        const o = byId.get(a.order_id);
        if (!o || !active(o.status)) continue;
        const d = after.drivers.find((d) => d.id === a.driver_id);
        const v = after.vehicles.find((v) => v.id === d?.vehicle_id);
        if (!d?.available || !v?.operational) {
          failed.add(o.id);
          continue;
        }
        const load = loads.get(v.id) ?? { units: 0, keys: [] };
        load.units += o.units;
        load.keys.push(o.id);
        loads.set(v.id, load);
      }
      for (const [id, load] of loads)
        if (load.units > (after.vehicles.find((v) => v.id === id)?.capacity ?? 0))
          for (const key of load.keys) failed.add(key);
      break;
    }
    case 'eta_updated_for_affected':
      for (const key of state.affectedKeys) {
        const current = byId.get(key);
        if (current?.status === 'cancelled') continue;
        if (!current || Date.parse(current.eta) === Date.parse(before.orders.find((o) => o.id === key)?.eta ?? ''))
          failed.add(key);
      }
      break;
    case 'customer_notified_for_affected': {
      const old = new Set(before.notifications.map((n) => n.id));
      const clock = Date.parse(before.meta[0]?.clock ?? '');
      for (const key of state.affectedKeys)
        if (!after.notifications.some((n) => n.order_id === key && !old.has(n.id) && Date.parse(n.created_at) >= clock))
          failed.add(key);
      break;
    }
    case 'sla_window_violations':
      for (const o of after.orders)
        if (active(o.status) && Date.parse(o.eta) > Date.parse(o.delivery_end)) failed.add(o.id);
      break;
  }
  const max =
    typeof definition === 'object' && 'sla_window_violations' in definition ? definition.sla_window_violations.max : 0;
  return {
    name,
    passed: failed.size <= max,
    affectedKeys: [...failed].sort(),
    explanation: invariantExplanation(name, failed.size, max),
    ...(['single_assignment', 'affected_reassigned'].includes(name)
      ? {
          assignments: [...failed].sort().map((key) => ({
            key,
            before: before.assignments
              .filter((item) => item.order_id === key)
              .map((item) => item.driver_id)
              .sort(),
            after: after.assignments
              .filter((item) => item.order_id === key)
              .map((item) => item.driver_id)
              .sort(),
          })),
        }
      : {}),
  };
}

export const invariantLabels: Record<string, string> = {
  no_order_lost: 'Orders lost after the disruption',
  single_assignment: 'Orders with incorrect assignments',
  affected_reassigned: 'Affected orders not reassigned',
  capacity_respected: 'Orders exceeding available capacity',
  eta_updated_for_affected: 'Affected orders with unchanged ETAs',
  customer_notified_for_affected: 'Affected customers not notified',
  sla_window_violations: 'Orders outside the delivery window',
};
function invariantExplanation(name: string, count: number, max: number): string {
  const explanations: Record<string, string> = {
    no_order_lost: 'Every baseline order must still exist after the disruption.',
    single_assignment: 'Each active order needs exactly one assignee; cancelled orders need none.',
    affected_reassigned:
      'Each active order on the absent driver or broken vehicle needs a different assignee after replanning.',
    capacity_respected: 'Assigned drivers and vehicles must be available and within capacity.',
    eta_updated_for_affected: 'Replanning must update the ETA of every affected active order.',
    customer_notified_for_affected: 'Every affected customer needs a new notification after the baseline snapshot.',
    sla_window_violations:
      max === 0
        ? 'No order may exceed its delivery window.'
        : `At most ${max.toLocaleString('en-US')} orders may exceed their delivery window.`,
  };
  return explanations[name] ?? `${count.toLocaleString('en-US')} checks require review.`;
}
export type Check = (state: InvariantState) => InvariantResult | Promise<InvariantResult>;
const resultSchema = z.object({ name: id, passed: z.boolean(), affectedKeys: z.array(id), explanation: id }).strict();
export async function prepareInvariant(definition: Invariant, baseDir: string, allowModules = false): Promise<Check> {
  if (typeof definition === 'string' || 'sla_window_violations' in definition)
    return (state) => checkBuiltin(definition, state);
  if ('jsonPath' in definition) {
    // Parse the safe, non-evaluating JSONPath subset before the target is mutated.
    try {
      selectJson({}, definition.jsonPath);
    } catch (e) {
      if (e instanceof Error && !e.message.includes(' is missing') && !e.message.includes('requires an array')) throw e;
    }
    return (state) => {
      let actual: unknown;
      try {
        const values = selectJson(state, definition.jsonPath);
        actual = values.length === 1 ? values[0] : values;
      } catch {
        actual = undefined;
      }
      const passed = isDeepStrictEqual(actual, definition.expected);
      return {
        name: definition.name,
        passed,
        affectedKeys: passed ? [] : state.affectedKeys,
        explanation: passed
          ? 'JSONPath equals the configured expectation.'
          : 'JSONPath is missing or differs from the configured expectation.',
      };
    };
  }
  if (!allowModules) throw new Error('Module invariants require scenario run --allow-modules');
  const root = await realpath(baseDir);
  const entry = await realpath(resolve(root, definition.module));
  const local = relative(root, entry);
  if (isAbsolute(definition.module) || local === '..' || local.startsWith('../') || isAbsolute(local))
    throw new Error('Invariant module must stay within the scenario directory');
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, interopDefault: false });
  const module = await jiti.import<{ default?: unknown }>(entry);
  if (typeof module.default !== 'function')
    throw new Error(`Invariant ${definition.name} must export a default function`);
  const fn = module.default as (state: InvariantState) => unknown;
  return async (state) => {
    const result = resultSchema.parse(await fn(structuredClone(state)));
    return { ...result, name: definition.name, affectedKeys: [...new Set(result.affectedKeys)].sort() };
  };
}
