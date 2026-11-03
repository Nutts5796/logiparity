import { createServer, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { demoWorkbook } from './xlsx-export.js';
import { DEMO_DATE, seedData, type DemoData, type Shipment } from './seed.js';
import { createOperations } from './operations.js';
import { createDispatcher } from './dispatcher.js';

export interface DemoBugs {
  dropLastRow: boolean;
  roundingPayout: boolean;
  staleUi: boolean;
  timezoneShift: boolean;
  loseOrder: boolean;
  doubleAssign: boolean;
}
export const noBugs: DemoBugs = {
  dropLastRow: false,
  roundingPayout: false,
  staleUi: false,
  timezoneShift: false,
  loseOrder: false,
  doubleAssign: false,
};
const exportPageSize = 200;
const headers = ['Shipment ID', 'Status', 'Driver payout', 'Delivered at', 'ETA'];
const chicagoClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function exportValues(shipment: Shipment, bugs: DemoBugs): string[] {
  // Intentionally incorrect floating-point arithmetic exists only behind the seeded bug.
  const payout = bugs.roundingPayout
    ? (Math.round(Number(shipment.payout_basis) * 100) / 100).toFixed(2)
    : shipment.driver_payout;
  const delivered =
    shipment.delivered_at && bugs.timezoneShift
      ? chicagoClock.format(new Date(shipment.delivered_at)).replace(' ', 'T')
      : (shipment.delivered_at ?? '');
  const eta = bugs.timezoneShift ? chicagoClock.format(new Date(shipment.eta)).replace(' ', 'T') : shipment.eta;
  return [shipment.id, shipment.status, payout, delivered, eta];
}

function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}

function positiveInteger(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max)
    throw new Error(`Pagination must be an integer between 1 and ${max}.`);
  return Number(value);
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function createDemoServer(options: { bugs?: Partial<DemoBugs>; date?: string } = {}): {
  server: Server;
  data: DemoData;
} {
  const bugs = { ...noBugs, ...options.bugs };
  const data = seedData(options.date ?? DEMO_DATE);
  const dispatcher = createDispatcher(data, bugs);
  const operations = createOperations(data, bugs);
  const collections = (): Record<string, unknown[]> => ({
    shipments: data.shipments,
    orders: data.shipments,
    drivers: data.drivers,
    vehicles: data.vehicles,
    routes: data.routes,
    notifications: data.notifications,
    assignments: data.assignments,
    state: [{ id: 'state', replan_status: data.replan_status, clock: data.clock }],
    payouts: data.shipments.map((s) => ({ id: s.id, driver_id: s.driver_id, amount: s.driver_payout })),
  });
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (await dispatcher(request, response, url)) return;
      if (await operations(request, url.pathname)) {
        json(response, 200, { synthetic: true, replan_status: data.replan_status, clock: data.clock });
        return;
      }
      if (request.method !== 'GET') {
        json(response, 405, {
          error: 'Use GET for API/exports; Use the configured test-only operational endpoints for scenario events.',
        });
        return;
      }
      if (url.pathname === '/health') {
        json(response, 200, { status: 'ok', synthetic: true, date: data.date, bugs });
        return;
      }
      if (url.searchParams.has('date') && url.searchParams.get('date') !== data.date) {
        json(response, 400, {
          error: `Synthetic data exists only for ${data.date}; set variables.date or DEMO_DATE accordingly.`,
        });
        return;
      }
      if (url.pathname === '/exports/shipments.csv') {
        response.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="shipments.csv"',
        });
        for (const row of [headers, ...data.shipments.map((s) => exportValues(s, bugs))]) {
          if (!response.write(row.map(csvCell).join(',') + '\r\n')) await once(response, 'drain');
        }
        response.end();
        return;
      }
      if (url.pathname === '/exports/shipments.xlsx') {
        response.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': 'attachment; filename="shipments.xlsx"',
        });
        const rows = [
          headers,
          ...data.shipments.flatMap((shipment, index) =>
            bugs.dropLastRow && ((index + 1) % exportPageSize === 0 || index === data.shipments.length - 1)
              ? []
              : [exportValues(shipment, bugs)],
          ),
        ];
        response.end(demoWorkbook(rows));
        return;
      }
      const match = url.pathname.match(/^\/api\/([a-z]+)(?:\/([^/]+))?$/);
      const collection = match?.[1] ? collections()[match[1]] : undefined;
      if (collection) {
        if (match?.[2]) {
          const record = collection.find(
            (item) => typeof item === 'object' && item !== null && 'id' in item && item.id === match[2],
          );
          json(
            response,
            record ? 200 : 404,
            record
              ? { data: record, synthetic: true }
              : { error: 'Record not found; use an ID from the list endpoint.' },
          );
        } else {
          const page = positiveInteger(url.searchParams.get('page'), 1, 1000000);
          const limit = positiveInteger(url.searchParams.get('limit'), 200, 10000);
          const status = url.searchParams.get('status');
          const filtered = status
            ? collection.filter(
                (item) => typeof item === 'object' && item !== null && 'status' in item && item.status === status,
              )
            : collection;
          json(response, 200, {
            synthetic: true,
            data: filtered.slice((page - 1) * limit, page * limit),
            pagination: { page, limit, total: filtered.length },
          });
        }
        return;
      }
      json(response, 404, {
        error:
          'Use /dispatcher, /health, /api/shipments, /api/drivers, /api/vehicles, /api/routes, /api/payouts, /api/notifications or /exports/shipments.csv|xlsx. All data is synthetic.',
      });
    })().catch((error: unknown) => {
      if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
      else
        json(response, 400, {
          error: error instanceof Error ? error.message : 'Request failed; check the query parameters.',
        });
    });
  });
  return { server, data };
}
