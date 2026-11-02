import { isDeepStrictEqual } from 'node:util';
import { createJiti } from 'jiti';
import { selectJson } from '@logiparity/adapters';
import { z } from 'zod';
import { resolve } from 'node:path';
import type { DataRow } from '@logiparity/core';
import type { Invariant, ScenarioEvent } from './config.js';

export type Snapshot = Record<string, DataRow[]>;
export interface InvariantState { before: Snapshot; after: Snapshot; events: ScenarioEvent[]; affectedKeys: string[]; cancelledKeys: string[] }
export interface InvariantResult { name: string; passed: boolean; affectedKeys: string[]; explanation: string }
const id = z.string().min(1);
const instant = z.string().refine((v) => /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)), 'Use an ISO instant with an offset');
const quantity = z.preprocess((v) => typeof v === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) ? Number(v) : v, z.number().finite().nonnegative());
const boolean = z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean());
const order = z.object({ id, status: id, units: quantity, zone: id, eta: instant, delivery_end: instant });
const driver = z.object({ id, vehicle_id: id, available: boolean });
const vehicle = z.object({ id, capacity: quantity, operational: boolean });
const assignment = z.object({ id, order_id: id, driver_id: id });
const notification = z.object({ id, order_id: id, type: id, created_at: instant });
const meta = z.object({ id, replan_status: id, clock: instant });
export function canonical(snapshot: Snapshot) {
  const result = { orders: z.array(order).parse(snapshot.orders), drivers: z.array(driver).parse(snapshot.drivers), vehicles: z.array(vehicle).parse(snapshot.vehicles), assignments: z.array(assignment).parse(snapshot.assignments), notifications: z.array(notification).parse(snapshot.notifications), meta: z.array(meta).length(1).parse(snapshot.meta) };
  for (const [name, records] of Object.entries(result)) if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error(`Duplicate IDs in scenario state.${name}`);
  return result;
}
const active = (status: string) => status !== 'delivered' && status !== 'cancelled';
export function affectedBy(before: ReturnType<typeof canonical>, events: ScenarioEvent[]): { affectedKeys: string[]; cancelledKeys: string[] } {
  const keys = new Set<string>(); const cancelled = new Set<string>();
  for (const event of events) {
    const p = event.params;
    if (event.type === 'order_cancel') {
      if (!Array.isArray(p.orders) || !p.orders.every((v) => typeof v === 'string' && before.orders.some((o) => o.id === v))) throw new Error('order_cancel params.orders must list existing order IDs');
      for (const key of p.orders as string[]) { keys.add(key); cancelled.add(key); }
    } else if (event.type === 'http') {
      if (p.affectedKeys !== undefined && (!Array.isArray(p.affectedKeys) || !p.affectedKeys.every((v) => typeof v === 'string'))) throw new Error('http params.affectedKeys must be an array of order IDs');
      for (const key of (p.affectedKeys ?? []) as string[]) keys.add(key);
    } else {
      const drivers = event.type === 'capacity_change' && p.vehicle ? before.drivers.filter((d) => d.vehicle_id === p.vehicle).map((d) => d.id) : [p.driver];
      if (event.type === 'traffic_delay' ? !before.orders.some((o) => o.zone === p.zone) : !before.drivers.some((d) => drivers.includes(d.id))) throw new Error(`Unknown driver, vehicle or zone in ${event.type}`);
      for (const o of before.orders.filter((o) => active(o.status))) if (event.type === 'traffic_delay' ? o.zone === p.zone : before.assignments.some((a) => a.order_id === o.id && drivers.includes(a.driver_id))) keys.add(o.id);
    }
  }
  return { affectedKeys: [...keys].sort(), cancelledKeys: [...cancelled].sort() };
}
export function checkBuiltin(definition: Invariant, state: InvariantState): InvariantResult {
  const before = canonical(state.before); const after = canonical(state.after);
  const name = typeof definition === 'string' ? definition : 'sla_window_violations';
  const failed = new Set<string>(); const byId = new Map(after.orders.map((o) => [o.id, o]));
  switch (name) {
    case 'no_order_lost': for (const o of before.orders) if (!byId.has(o.id)) failed.add(o.id); break;
    case 'single_assignment': {
      for (const o of after.orders) if (after.assignments.filter((a) => a.order_id === o.id).length !== (o.status === 'cancelled' ? 0 : 1)) failed.add(o.id);
      for (const a of after.assignments) if (!byId.has(a.order_id) || !after.drivers.some((d) => d.id === a.driver_id)) failed.add(a.order_id);
      for (const key of state.cancelledKeys) if (byId.get(key)?.status !== 'cancelled') failed.add(key);
      break;
    }
    case 'capacity_respected': {
      const loads = new Map<string, { units: number; keys: string[] }>();
      for (const a of after.assignments) {
        const o = byId.get(a.order_id); if (!o || !active(o.status)) continue;
        const d = after.drivers.find((d) => d.id === a.driver_id); const v = after.vehicles.find((v) => v.id === d?.vehicle_id);
        if (!d?.available || !v?.operational) { failed.add(o.id); continue; }
        const load = loads.get(v.id) ?? { units: 0, keys: [] }; load.units += o.units; load.keys.push(o.id); loads.set(v.id, load);
      }
      for (const [id, load] of loads) if (load.units > (after.vehicles.find((v) => v.id === id)?.capacity ?? 0)) for (const key of load.keys) failed.add(key);
      break;
    }
    case 'eta_updated_for_affected': for (const key of state.affectedKeys) {
      const current = byId.get(key); if (current?.status === 'cancelled') continue;
      if (!current || Date.parse(current.eta) === Date.parse(before.orders.find((o) => o.id === key)?.eta ?? '')) failed.add(key);
    } break;
    case 'customer_notified_for_affected': {
      const old = new Set(before.notifications.map((n) => n.id)); const clock = Date.parse(before.meta[0]?.clock ?? '');
      for (const key of state.affectedKeys) if (!after.notifications.some((n) => n.order_id === key && !old.has(n.id) && Date.parse(n.created_at) >= clock)) failed.add(key);
      break;
    }
    case 'sla_window_violations': for (const o of after.orders) if (active(o.status) && Date.parse(o.eta) > Date.parse(o.delivery_end)) failed.add(o.id); break;
  }
  const max = typeof definition === 'object' && 'sla_window_violations' in definition ? definition.sla_window_violations.max : 0;
  return { name, passed: failed.size <= max, affectedKeys: [...failed].sort(), explanation: failed.size ? `${failed.size} order(s) violate ${name}; allowed ${max}.` : `${name}: all applicable orders satisfy the invariant.` };
}
export type Check = (state: InvariantState) => InvariantResult | Promise<InvariantResult>;
const resultSchema = z.object({ name: id, passed: z.boolean(), affectedKeys: z.array(id), explanation: id }).strict();
export async function prepareInvariant(definition: Invariant, baseDir: string): Promise<Check> {
  if (typeof definition === 'string' || 'sla_window_violations' in definition) return (state) => checkBuiltin(definition, state);
  if ('jsonPath' in definition) {
    // Parse the safe, non-evaluating JSONPath subset before the target is mutated.
    try { selectJson({}, definition.jsonPath); } catch (e) { if (e instanceof Error && !e.message.includes(' is missing') && !e.message.includes('requires an array')) throw e; }
    return (state) => {
      let actual: unknown; try { const values = selectJson(state, definition.jsonPath); actual = values.length === 1 ? values[0] : values; } catch { actual = undefined; }
      const passed = isDeepStrictEqual(actual, definition.expected);
      return { name: definition.name, passed, affectedKeys: passed ? [] : state.affectedKeys, explanation: passed ? 'JSONPath equals the configured expectation.' : 'JSONPath is missing or differs from the configured expectation.' };
    };
  }
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, interopDefault: false });
  const module = await jiti.import<{ default?: unknown }>(resolve(baseDir, definition.module));
  if (typeof module.default !== 'function') throw new Error(`Invariant ${definition.name} must export a default function`);
  const fn = module.default as (state: InvariantState) => unknown;
  return async (state) => {
    const result = resultSchema.parse(await fn(structuredClone(state)));
    return { ...result, name: definition.name, affectedKeys: [...new Set(result.affectedKeys)].sort() };
  };
}
