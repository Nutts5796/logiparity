import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const starterConfig = `# LogiParity starter — TEST AND STAGING ENVIRONMENTS ONLY.
# First source is the reference. Paths resolve relative to this YAML file.
# Set STAGING_API_URL to your test/staging API, then edit path and fields.
# Keep secrets in environment variables; do not write credentials here.
version: 1
environment: test
entities:
  - name: shipment
    key: shipment_id
    sources:
      api:
        type: rest
        baseUrl: \${STAGING_API_URL}
        path: /api/shipments
        items: $.data[*]
        pagination: { type: page, totalPath: $.pagination.total, pageParam: page, sizeParam: limit, size: 200 }
        # auth: { type: bearer, tokenEnv: STAGING_API_TOKEN }
        fields: { shipment_id: $.id, status: $.status, payout: $.driver_payout }
      export:
        type: csv
        file: ./shipments.csv
        headerRow: 1
        fields: { shipment_id: "Shipment ID", status: Status, payout: "Driver payout" }
    compare:
      status: { type: enum, map: { Delivered: delivered, "In transit": in_transit } }
      # Money defaults to decimal strings; numeric input requires allowNumber: true.
      # Tolerance is in minor units.
      payout: { type: money, currency: USD, tolerance: 0 }
    aggregates:
      - { name: delivered_count, type: count, where: { status: delivered } }
      - { name: payout_total, type: sum, field: payout }
    # List: any finding in a selected category fails. [] is report-only.
    failOn: [missing, extra, mismatch, aggregate, duplicate]
    # Or use allowed counts: { missing: 2, mismatch: 10, aggregate: 0 }
    # Runtime/source errors always exit 2, regardless of failOn.
report:
  outputs: [console, html, junit, json, markdown]
  dir: ./logiparity-report
`;

export async function initConfig(file: string): Promise<string> {
  const destination = resolve(file);
  try { await writeFile(destination, starterConfig, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    const exists = error instanceof Error && 'code' in error && error.code === 'EEXIST';
    throw new Error(`${destination}: ${exists ? 'file already exists; choose another --config path or move the existing file' : 'cannot create starter config; check the parent directory and write permissions'}.`);
  }
  return destination;
}
