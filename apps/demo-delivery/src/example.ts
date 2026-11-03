import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function writeDemoExample(port: number): Promise<void> {
  const directory = resolve('logiparity-demo');
  await mkdir(directory, { recursive: true });
  const fields = `shipment_id: 'Shipment ID', status: Status, payout: 'Driver payout', delivered_at: 'Delivered at'`;
  const config = `# Synthetic closed-day data; no production credentials.
version: 1
environment: test
allowedHosts: [127.0.0.1]
entities:
  - name: shipment
    label: Order
    pluralLabel: orders
    key: shipment_id
    sources:
      api:
        type: rest
        label: API
        baseUrl: http://127.0.0.1:${port}
        path: /api/shipments
        items: $.data[*]
        pagination: {type: page, totalPath: $.pagination.total, sizeParam: limit, size: 200}
        fields:
          shipment_id: $.id
          status: $.status
          payout: {path: $.driver_payout, label: Driver payout}
          delivered_at: {path: $.delivered_at, label: Delivery time}
      export:
        type: xlsx
        label: Excel export
        file: ./shipments.xlsx
        sheet: Shipments
        fields: {${fields}}
      csv:
        type: csv
        label: CSV export
        file: ./shipments.csv
        fields: {${fields}}
    compare:
      status: {type: enum}
      payout: {type: money, currency: USD}
      delivered_at: {type: datetime, sourceTimezones: {export: UTC, csv: UTC}, toleranceSeconds: 60}
    aggregates:
      - {name: delivered_count, label: Delivered orders, type: count, where: {status: delivered}}
      - {name: payout_total, label: Total driver payout, type: sum, field: payout}
report:
  outputs: [console, html, markdown, json, junit]
  dir: ./report
`;
  try {
    await writeFile(resolve(directory, 'parity.yaml'), config, { flag: 'wx' });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    process.stdout.write('Keeping existing logiparity-demo/parity.yaml. Check its port if DEMO_PORT changed.\n');
  }
  process.stdout.write(`
In another terminal, from the same project directory:
  cd logiparity-demo
  curl --max-time 60 --retry 3 -fS http://127.0.0.1:${port}/exports/shipments.xlsx -o shipments.xlsx
  curl --max-time 60 --retry 3 -fS http://127.0.0.1:${port}/exports/shipments.csv -o shipments.csv
  npx logiparity validate --config parity.yaml
  npx logiparity check --config parity.yaml
Open logiparity-demo/report/report.html from the project directory. Stop the service with Ctrl+C.
`);
}
