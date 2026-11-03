import { expect, it } from 'vitest';
import { seedData } from '../../apps/demo-delivery/src/seed.js';
it('uses deterministic payouts within the documented stop range', () => {
  const payouts = seedData().shipments.map((row) => Number(row.driver_payout));
  expect(Math.min(...payouts)).toBeGreaterThanOrEqual(18);
  expect(Math.max(...payouts)).toBeLessThanOrEqual(45);
  expect(seedData().shipments[0]?.driver_payout).toBe('18.19');
});
