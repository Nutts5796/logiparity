import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { demoWorkbook } from '../../apps/demo-delivery/src/xlsx-export.js';
import { seedData } from '../../apps/demo-delivery/src/seed.js';
it('writes an independently readable workbook without a runtime writer dependency', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(
    Readable.from(
      demoWorkbook([
        ['ID', 'Status'],
        ['A<&', 'Delivered'],
      ]),
    ),
  );
  expect(workbook.getWorksheet('Shipments')?.getRow(2).getCell(1).value).toBe('A<&');
  expect(workbook.getWorksheet('Shipments')?.getRow(2).getCell(2).value).toBe('Delivered');
});
it('bases payouts on varied zones and distance rather than one-cent increments', () => {
  const data = seedData();
  const payouts = data.shipments.map((order) => Number(order.driver_payout));
  expect(Math.min(...payouts)).toBeGreaterThanOrEqual(18);
  expect(Math.max(...payouts)).toBeLessThanOrEqual(45);
  expect(
    payouts.slice(1).filter((amount, index) => Math.abs(amount - (payouts[index] ?? 0)) > 0.5).length,
  ).toBeGreaterThan(2000);
});
it('keeps in-transit ETAs after the snapshot and varies delivery times around ETAs', () => {
  const data = seedData(),
    snapshot = Date.parse(data.clock);
  expect(
    data.shipments.filter((order) => order.status === 'in_transit').every((order) => Date.parse(order.eta) > snapshot),
  ).toBe(true);
  const offsets = new Set(
    data.shipments.flatMap((order) =>
      order.delivered_at ? [Date.parse(order.delivered_at) - Date.parse(order.eta)] : [],
    ),
  );
  expect(offsets.size).toBeGreaterThan(5);
  expect(data.shipments.every((order) => !order.delivered_at || Date.parse(order.delivered_at) <= snapshot)).toBe(true);
});
