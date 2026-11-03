import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = new URL(process.env.DEMO_UI_URL ?? process.env.DEMO_API_URL ?? 'http://127.0.0.1:3010');
if (
  !['http:', 'https:'].includes(base.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
  base.username ||
  base.password
)
  throw new Error(
    'demo:login supports only the local synthetic demo origin. For another staging UI, create your own Playwright storageState.',
  );
const output = new URL('../examples/demo/auth/state.json', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(new URL('/dispatcher', base).href);
  await page.getByLabel('Username', { exact: true }).fill('dispatcher');
  await page.getByLabel('Password', { exact: true }).fill('demo-password');
  await Promise.all([
    page.waitForURL('**/dispatcher*'),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  await page.locator('table#shipments').waitFor();
  await mkdir(new URL('./', output), { recursive: true });
  await writeFile(output, JSON.stringify(await context.storageState(), null, 2) + '\n', { mode: 0o600 });
  console.log(
    'Saved synthetic demo login state to examples/demo/auth/state.json. Restarting the demo invalidates it; run demo:login again.',
  );
} finally {
  await browser.close();
}
