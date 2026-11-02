import { z } from 'zod';
import type { Invariant, ScenarioEvent } from './config.js';
import type { Snapshot } from './invariants.js';

const id = z.string().min(1);
const instant = z.string().refine((v) => /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)), 'Use an ISO instant with an offset');
const quantity = z.preprocess((v) => typeof v === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) ? Number(v) : v, z.number().finite().nonnegative());
const boolean = z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean());
export const stateSchemas = {
  orders: z.object({ id, status: id, units: quantity, zone: id, eta: instant, delivery_end: instant }),
  drivers: z.object({ id, vehicle_id: id, available: boolean }),
  vehicles: z.object({ id, capacity: quantity, operational: boolean }),
  assignments: z.object({ id, order_id: id, driver_id: id }),
  notifications: z.object({ id, order_id: id, type: id, created_at: instant }),
  meta: z.object({ id, replan_status: id, clock: instant }),
};
export type CanonicalState = { [K in keyof typeof stateSchemas]: z.infer<(typeof stateSchemas)[K]>[] };
type Requirements = Partial<Record<keyof typeof stateSchemas, string[]>>;
const requirements: Record<string, Requirements> = {
  no_order_lost: { orders: ['id'] },
  single_assignment: { orders: ['id', 'status'], assignments: ['id', 'order_id', 'driver_id'] },
  capacity_respected: { orders: ['id', 'status', 'units'], assignments: ['id', 'order_id', 'driver_id'], drivers: ['id', 'vehicle_id', 'available'], vehicles: ['id', 'capacity', 'operational'] },
  eta_updated_for_affected: { orders: ['id', 'status', 'eta'], assignments: ['id', 'order_id', 'driver_id'] },
  customer_notified_for_affected: { orders: ['id', 'status'], assignments: ['id', 'order_id', 'driver_id'], notifications: ['id', 'order_id', 'created_at'], meta: ['id', 'clock'] },
  sla_window_violations: { orders: ['id', 'status', 'eta', 'delivery_end'] },
};
export const needsAffected = (definitions: readonly Invariant[]) => definitions.some((i) => i === 'eta_updated_for_affected' || i === 'customer_notified_for_affected');
function selectedFields(definitions: readonly Invariant[], events: readonly ScenarioEvent[]): Requirements {
  const fields: Requirements = {};
  const add = (source: keyof typeof stateSchemas, names: string[]) => { fields[source] = [...new Set([...(fields[source] ?? []), ...names])]; };
  for (const definition of definitions) {
    const name = typeof definition === 'string' ? definition : 'sla_window_violations' in definition ? 'sla_window_violations' : undefined;
    if (name) for (const [source, names] of Object.entries(requirements[name]!)) add(source as keyof typeof stateSchemas, names!);
  }
  if (needsAffected(definitions)) {
    if (events.some((e) => e.type === 'traffic_delay')) add('orders', ['zone']);
    if (events.some((e) => e.type === 'capacity_change' && e.params.vehicle)) add('drivers', ['id', 'vehicle_id']);
  }
  return fields;
}
export function requiredStateSources(definitions: readonly Invariant[], events: readonly ScenarioEvent[] = []): string[] { return Object.keys(selectedFields(definitions, events)).sort(); }
export function validateState(snapshot: Snapshot, definitions: readonly Invariant[], events: readonly ScenarioEvent[] = []): void { canonicalSelection(snapshot, selectedFields(definitions, events)); }
export function canonical(snapshot: Snapshot): CanonicalState {
  return canonicalSelection(snapshot, Object.fromEntries(Object.entries(stateSchemas).map(([name, schema]) => [name, Object.keys(schema.shape)])));
}
/** Only selected fields are read by the requesting invariant; unrelated collections stay empty. */
export function canonicalFor(snapshot: Snapshot, definitions: readonly Invariant[], events: readonly ScenarioEvent[] = []): CanonicalState {
  return canonicalSelection(snapshot, selectedFields(definitions, events));
}
function canonicalSelection(snapshot: Snapshot, fields: Requirements): CanonicalState {
  const result: Record<string, unknown[]> = Object.fromEntries(Object.keys(stateSchemas).map((name) => [name, []]));
  for (const [name, required] of Object.entries(fields)) {
    const shape = stateSchemas[name as keyof typeof stateSchemas].shape;
    const schema = z.object(Object.fromEntries(required!.map((field) => [field, shape[field as keyof typeof shape]])));
    const records = z.array(schema).parse(snapshot[name]);
    if (name === 'meta' && records.length !== 1) throw new Error('Scenario state.meta must contain one clock record');
    if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error(`Duplicate IDs in scenario state.${name}`);
    result[name] = records;
  }
  return result as CanonicalState;
}
export function cancelledBy(orders: readonly { id: string }[], events: readonly ScenarioEvent[]): string[] {
  const keys = new Set<string>();
  for (const event of events.filter((e) => e.type === 'order_cancel')) {
    const values = event.params.orders;
    if (!Array.isArray(values) || !values.length || !values.every((v) => typeof v === 'string' && orders.some((o) => o.id === v))) throw new Error('order_cancel params.orders must list existing order IDs');
    for (const key of values as string[]) keys.add(key);
  }
  return [...keys].sort();
}
