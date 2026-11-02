export const DEMO_DATE = '2026-11-02';
export interface Shipment {
  id: string; driver_id: string; vehicle_id: string; customer_id: string;
  status: 'delivered' | 'in_transit' | 'cancelled'; driver_payout: string; delivered_at: string | null;
  units: number; zone: string; eta: string;
  delivery_window: { start: string; end: string }; payout_basis: string;
}
export interface Driver { id: string; name: string; vehicle_id: string; available: boolean }
export interface Vehicle { id: string; capacity: number; operational: boolean }
export interface DemoData {
  synthetic: true; date: string; drivers: Driver[]; vehicles: Vehicle[]; shipments: Shipment[];
  routes: { id: string; driver_id: string; order_ids: string[] }[];
  clock: string; replan_status: string;
  assignments: { id: string; order_id: string; driver_id: string }[];
  notifications: { id: string; created_at: string; order_id: string; customer_id: string; type: string }[];
}

export function majorUnits(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function seedData(date = DEMO_DATE): DemoData {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Demo date must be a valid ISO date (YYYY-MM-DD).');
  const drivers = Array.from({ length: 55 }, (_, i) => ({ id: `D${String(i + 1).padStart(2, '0')}`, name: `Synthetic driver ${i + 1}`, vehicle_id: `V${String(i + 1).padStart(2, '0')}`, available: true }));
  const vehicles = drivers.map((d) => ({ id: d.vehicle_id, capacity: 50, operational: true }));
  const shipments: Shipment[] = Array.from({ length: 2750 }, (_, i) => {
    const driver = drivers[Math.floor(i / 50)];
    if (!driver) throw new Error('Synthetic seed driver index is invalid.');
    const milli = 1005 + (i % 300) * 10;
    const delivered = i % 3 !== 0;
    return {
      id: `S${String(i + 1).padStart(6, '0')}`, driver_id: driver.id, vehicle_id: driver.vehicle_id,
      customer_id: `C${String(i + 1).padStart(6, '0')}`, status: delivered ? 'delivered' : 'in_transit',
      driver_payout: majorUnits(Math.floor((milli + 5) / 10)),
      payout_basis: `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, '0')}`,
      delivered_at: delivered ? `${date}T13:${String(i % 60).padStart(2, '0')}:00Z` : null,
      units: 1, zone: `Z${i % 5 + 1}`, eta: new Date(Date.parse(`${date}T10:00:00Z`) + (i % 480) * 60000).toISOString(),
      delivery_window: { start: `${date}T08:00:00Z`, end: `${date}T20:00:00Z` },
    };
  });
  return {
    synthetic: true, date, drivers, vehicles, shipments, clock: `${date}T14:00:00Z`, replan_status: 'idle',
    assignments: shipments.map((s) => ({ id: `A${s.id}`, order_id: s.id, driver_id: s.driver_id })),
    routes: drivers.map((d) => ({ id: `R${d.id.slice(1)}`, driver_id: d.id, order_ids: shipments.filter((s) => s.driver_id === d.id).map((s) => s.id) })),
    notifications: shipments.filter((s) => s.status === 'delivered').map((s) => ({ id: `N${s.id}`, created_at: s.delivered_at!, order_id: s.id, customer_id: s.customer_id, type: 'delivered' })),
  };
}
