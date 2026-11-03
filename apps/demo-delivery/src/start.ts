import { createDemoServer } from './server.js';
import { writeDemoExample } from './example.js';

export async function startDemo(options: { allBugs?: boolean; writeExample?: boolean } = {}) {
  const allBugs = options.allBugs ?? false;
  const port = Number(process.env.DEMO_PORT ?? '3010');
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('DEMO_PORT must be an integer between 0 and 65535 (0 selects an available port).');
  const bugs = {
    dropLastRow: allBugs || process.env.BUG_EXPORT_DROPS_LAST_ROW === '1',
    roundingPayout: allBugs || process.env.BUG_ROUNDING_PAYOUT === '1',
    staleUi: allBugs || process.env.BUG_STATUS_STALE_UI === '1',
    loseOrder: allBugs || process.env.BUG_REPLAN_LOSES_ORDER === '1',
    doubleAssign: allBugs || process.env.BUG_DOUBLE_ASSIGN === '1',
    timezoneShift: allBugs || process.env.BUG_TZ_SHIFT_EXPORT === '1',
  };
  const bugNames = {
    dropLastRow: 'missing export rows',
    roundingPayout: 'incorrect payout rounding',
    staleUi: 'stale dispatcher statuses',
    timezoneShift: 'shifted export datetimes',
    loseOrder: 'orders lost during replanning',
    doubleAssign: 'duplicate assignments after replanning',
  };
  const enabled = Object.entries(bugs)
    .filter(([, value]) => value)
    .map(([name]) => bugNames[name as keyof typeof bugNames]);
  const date = process.env.DEMO_DATE;
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + 'T12:00:00Z')) ||
      new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date)
  )
    throw new Error('DEMO_DATE must be a valid calendar date in YYYY-MM-DD format, e.g. 2026-11-02.');
  const { server, data } = createDemoServer({
    ...(process.env.DEMO_DATE ? { date: process.env.DEMO_DATE } : {}),
    bugs,
  });
  server.on('error', (error) => {
    process.stderr.write(
      'code' in error && error.code === 'EADDRINUSE'
        ? `LogiParity demo: port ${port} is in use. Choose another DEMO_PORT or stop the service using it.\n`
        : `LogiParity demo: ${error.message}. Check DEMO_PORT.\n`,
    );
    process.exitCode = 2;
  });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') {
      if (options.writeExample)
        void writeDemoExample(address.port, data.date).catch((error) => {
          process.stderr.write(String(error) + '\n');
          process.exitCode = 2;
          server.close();
        });
      process.stdout.write(
        `LogiParity demo: http://127.0.0.1:${address.port}/dispatcher (TEST/STAGING ONLY)\n${data.drivers.length} drivers, ${data.shipments.length.toLocaleString('en-US')} orders, date ${data.date}. ${enabled.length ? `Enabled demo bugs: ${enabled.join('; ')}.` : 'No demo bugs are enabled.'}\n`,
      );
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      server.close();
      server.closeAllConnections();
    });

  return { server, data };
}
