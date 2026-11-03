import type { IncomingMessage } from 'node:http';
import { seedData, type DemoData } from './seed.js';
import type { DemoBugs } from './server.js';

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    length += bytes.length;
    if (length > 65536) throw new Error('Demo event body exceeds 64 KiB');
    chunks.push(bytes);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use a JSON object body');
  return value as Record<string, unknown>;
}
export function createOperations(data: DemoData, bugs: DemoBugs) {
  const affected = new Set<string>();
  let breakdown = false;
  let delay = 15;
  let completeAt: number | undefined;
  let revision = 0;
  function replan() {
    revision++;
    const previous = data.assignments;
    const assignments: DemoData['assignments'] = [];
    const loads = new Map<string, number>();
    const drivers = data.drivers.filter(
      (d) => d.available && data.vehicles.some((v) => v.id === d.vehicle_id && v.operational),
    );
    const capacity = (id: string) =>
      data.vehicles.find((v) => v.id === drivers.find((d) => d.id === id)?.vehicle_id)?.capacity ?? 0;
    const ordered = [...data.shipments].sort(
      (a, b) => Number(affected.has(a.id)) - Number(affected.has(b.id)) || a.id.localeCompare(b.id),
    );
    for (const order of ordered) {
      if (order.status === 'cancelled') continue;
      const old = previous.find((a) => a.order_id === order.id)?.driver_id;
      const eligible = (id: string) =>
        drivers.some((d) => d.id === id) && (loads.get(id) ?? 0) + order.units <= capacity(id);
      const selected =
        order.status === 'delivered' ? old : old && eligible(old) ? old : drivers.find((d) => eligible(d.id))?.id;
      if (!selected) continue;
      assignments.push({ id: `A${order.id}`, order_id: order.id, driver_id: selected });
      order.driver_id = selected;
      order.vehicle_id = data.drivers.find((d) => d.id === selected)!.vehicle_id;
      if (order.status !== 'delivered') loads.set(selected, (loads.get(selected) ?? 0) + order.units);
    }
    data.assignments = assignments;
    if (bugs.loseOrder && breakdown) {
      const key = [...affected].sort()[0];
      data.shipments = data.shipments.filter((o) => o.id !== key);
      data.assignments = data.assignments.filter((a) => a.order_id !== key);
    }
    if (bugs.doubleAssign && breakdown) {
      const order = data.shipments.find((o) => affected.has(o.id) && o.status !== 'cancelled');
      const second = [...drivers]
        .reverse()
        .find((d) => d.id !== order?.driver_id && (loads.get(d.id) ?? 0) + (order?.units ?? 0) <= capacity(d.id));
      if (order && second) data.assignments.push({ id: `DUP${order.id}`, order_id: order.id, driver_id: second.id });
    }
    for (const order of data.shipments)
      if (affected.has(order.id)) {
        if (order.status !== 'cancelled' && order.status !== 'delivered')
          order.eta = new Date(Math.max(Date.parse(order.eta), Date.parse(data.clock)) + delay * 60000)
            .toISOString()
            .replace('.000Z', 'Z');
        data.notifications.push({
          id: `N${revision}-${order.id}`,
          order_id: order.id,
          customer_id: order.customer_id,
          type: order.status === 'cancelled' ? 'cancelled' : 'replanned',
          created_at: data.clock,
        });
      }
    data.routes = data.drivers.map((d) => ({
      id: `R${d.id.slice(1)}`,
      driver_id: d.id,
      order_ids: data.assignments.filter((a) => a.driver_id === d.id).map((a) => a.order_id),
    }));
    data.replan_status = 'completed';
    completeAt = undefined;
    affected.clear();
    breakdown = false;
    delay = 15;
  }
  return async (request: IncomingMessage, path: string): Promise<boolean> => {
    if (!['/api/test/reset', '/api/replan', '/api/clock/advance'].includes(path) && !path.startsWith('/api/events/'))
      return false;
    if (request.method !== 'POST' || request.headers['x-logiparity-environment'] !== 'test')
      throw new Error('Demo mutations require POST and x-logiparity-environment: test');
    const p = await body(request);
    if (path === '/api/test/reset') {
      if (
        p.version !== 1 ||
        p.synthetic !== true ||
        p.profile !== 'operations' ||
        p.drivers !== 55 ||
        p.ordersPerDriver !== 50 ||
        p.capacity !== 60 ||
        typeof p.date !== 'string' ||
        typeof p.clock !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(p.clock) ||
        !Number.isFinite(Date.parse(p.clock)) ||
        !p.clock.startsWith(p.date)
      )
        throw new Error('Use the documented synthetic 55-driver operations fixture');
      const fresh = seedData(p.date);
      fresh.clock = p.clock;
      for (const v of fresh.vehicles) v.capacity = 60;
      for (const o of fresh.shipments) {
        o.status = 'in_transit';
        o.delivered_at = null;
      }
      fresh.notifications = [];
      Object.assign(data, fresh);
      affected.clear();
      breakdown = false;
      delay = 15;
      completeAt = undefined;
      revision = 0;
      return true;
    }
    if (path === '/api/clock/advance') {
      if (typeof p.seconds !== 'number' || !Number.isFinite(p.seconds) || p.seconds <= 0 || p.seconds > 3600)
        throw new Error('Clock seconds must be >0 and <=3600');
      data.clock = new Date(Date.parse(data.clock) + p.seconds * 1000).toISOString().replace('.000Z', 'Z');
      if (completeAt !== undefined && Date.parse(data.clock) >= completeAt) replan();
      return true;
    }
    if (path === '/api/replan') {
      if (completeAt !== undefined) throw new Error('Replanning is already pending');
      data.replan_status = 'pending';
      completeAt = Date.parse(data.clock) + 2000;
      return true;
    }
    if (completeAt !== undefined) throw new Error('Wait for the pending replan before injecting another event');
    const type = path.slice('/api/events/'.length);
    if (!['driver-no-show', 'vehicle-breakdown', 'traffic-delay', 'order-cancel', 'capacity-change'].includes(type))
      throw new Error('Unknown synthetic event type');
    const driver = data.drivers.find((d) => d.id === p.driver || d.vehicle_id === p.vehicle);
    if (['driver-no-show', 'vehicle-breakdown', 'capacity-change'].includes(type) && !driver)
      throw new Error('Specify an existing driver or vehicle');
    if (
      type === 'traffic-delay' &&
      (!data.shipments.some((o) => o.zone === p.zone) ||
        typeof p.minutes !== 'number' ||
        !Number.isFinite(p.minutes) ||
        p.minutes <= 0 ||
        p.minutes > 240)
    )
      throw new Error('Traffic delay requires a known zone and minutes in (0,240]');
    if (
      type === 'capacity-change' &&
      (typeof p.capacity !== 'number' || !Number.isSafeInteger(p.capacity) || p.capacity < 0 || p.capacity > 1000)
    )
      throw new Error('Capacity must be an integer from 0 to 1000');
    if (
      type === 'order-cancel' &&
      (!Array.isArray(p.orders) ||
        !p.orders.length ||
        !p.orders.every((id) => data.shipments.some((o) => o.id === id && o.status === 'in_transit')))
    )
      throw new Error('Cancel existing active orders using params.orders');
    let at = data.clock;
    if (p.at !== undefined) {
      if (typeof p.at !== 'string') throw new Error('Event at must be UTC HH:mm or an ISO UTC instant');
      at = /^\d{2}:\d{2}$/.test(p.at) ? `${data.date}T${p.at}:00Z` : p.at;
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at) ||
        !Number.isFinite(Date.parse(at)) ||
        Date.parse(at) < Date.parse(data.clock)
      )
        throw new Error('Event time must be a valid UTC instant at or after the virtual clock');
    }
    data.clock = at;
    for (const o of data.shipments.filter((o) => o.status === 'in_transit')) {
      if (
        type === 'traffic-delay'
          ? o.zone === p.zone
          : type === 'order-cancel'
            ? (p.orders as string[]).includes(o.id)
            : o.driver_id === driver?.id
      )
        affected.add(o.id);
    }
    if (type === 'driver-no-show') driver!.available = false;
    if (type === 'vehicle-breakdown') {
      data.vehicles.find((v) => v.id === driver!.vehicle_id)!.operational = false;
      breakdown = true;
    }
    if (type === 'traffic-delay') delay = Math.max(delay, p.minutes as number);
    if (type === 'capacity-change')
      data.vehicles.find((v) => v.id === driver!.vehicle_id)!.capacity = p.capacity as number;
    if (type === 'order-cancel')
      for (const o of data.shipments)
        if ((p.orders as string[]).includes(o.id)) {
          o.status = 'cancelled';
          o.driver_payout = '0.00';
          o.payout_basis = '0.000';
        }
    data.replan_status = 'required';
    return true;
  };
}
