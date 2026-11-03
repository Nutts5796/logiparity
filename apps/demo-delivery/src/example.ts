import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function writeDemoExample(port: number): Promise<void> {
  const directory = resolve('logiparity-demo');
  await mkdir(directory, { recursive: true });
  await cp(new URL('../../../examples/demo/scenarios/', import.meta.url), resolve(directory, 'scenarios'), {
    recursive: true,
    force: false,
  });
  await cp(new URL('../../../examples/demo/fixtures/', import.meta.url), resolve(directory, 'fixtures'), {
    recursive: true,
    force: false,
  });
  const target = (await readFile(new URL('../../../examples/demo/target.yaml', import.meta.url), 'utf8')).replaceAll(
    '${DEMO_API_URL}',
    `http://127.0.0.1:${port}`,
  );
  try {
    await writeFile(resolve(directory, 'target.yaml'), target, { flag: 'wx' });
  } catch (error) {
    if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'EEXIST') throw error;
    await warnStalePort(resolve(directory, 'target.yaml'), port);
  }
  const parity = (
    await readFile(new URL('../../../examples/demo/parity-scenario.yaml', import.meta.url), 'utf8')
  ).replaceAll('${DEMO_API_URL}', `http://127.0.0.1:${port}`);
  try {
    await writeFile(resolve(directory, 'parity-scenario.yaml'), parity, { flag: 'wx' });
  } catch (error) {
    if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'EEXIST') throw error;
    await warnStalePort(resolve(directory, 'parity-scenario.yaml'), port);
  }
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
    await warnStalePort(resolve(directory, 'parity.yaml'), port);
  }
  process.stdout.write(`
In another terminal, from the same project directory:
  cd logiparity-demo
  curl --max-time 60 --retry 3 --retry-connrefused -fsS http://127.0.0.1:${port}/exports/shipments.xlsx -o shipments.xlsx
  curl --max-time 60 --retry 3 --retry-connrefused -fsS http://127.0.0.1:${port}/exports/shipments.csv -o shipments.csv
  npx logiparity validate --config parity.yaml
  npx logiparity check --config parity.yaml
Scenario files and target are in logiparity-demo/scenarios and logiparity-demo/target.yaml. Scenarios reset demo state; restart the demo afterwards to return to the original dataset.
Open logiparity-demo/report/report.html from the project directory. Stop the service with Ctrl+C.
`);
}

async function warnStalePort(file: string, port: number): Promise<void> {
  const content = await readFile(file, 'utf8');
  const urls = [...content.matchAll(/http:\/\/127\.0\.0\.1:(\d+)/g)];
  if (urls.some((match) => Number(match[1]) !== port))
    process.stderr.write(
      `Keeping existing ${file}: it still uses a different demo port. Update its URLs to http://127.0.0.1:${port}, or remove the file and restart the demo to regenerate it.\n`,
    );
}
