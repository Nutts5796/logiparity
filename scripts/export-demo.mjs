import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = new URL(process.env.DEMO_API_URL ?? 'http://127.0.0.1:3010');
const date = process.env.DEMO_DATE ?? '2026-11-02';
const output = new URL('../examples/demo/out/', import.meta.url);
await mkdir(output, { recursive: true });
for (const extension of ['csv', 'xlsx']) {
  const response = await fetch(new URL(`/exports/shipments.${extension}?date=${encodeURIComponent(date)}`, base), {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `Demo ${extension} download returned HTTP ${response.status}; start npm run demo and check DEMO_API_URL/DEMO_DATE.`,
    );
  const destination = new URL(`shipments-${date}.${extension}`, output);
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
  console.log(`Saved synthetic export: ${fileURLToPath(destination)}`);
}
