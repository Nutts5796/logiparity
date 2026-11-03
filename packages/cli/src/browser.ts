import { readFile, mkdir } from 'node:fs/promises';
import { atomicReportFile } from '@logiparity/core';
import { requireOptionalAdapter } from '@logiparity/adapters';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
export async function installBrowser(withDeps = false): Promise<number> {
  requireOptionalAdapter('ui');
  let cli: string;
  try {
    cli = join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
  } catch {
    throw new Error(
      'UI sources require Playwright. Run npm install --save-dev --save-exact playwright@1.64.1, then npx logiparity install-browser',
    );
  }
  const child = spawn(process.execPath, [cli, 'install', ...(withDeps ? ['--with-deps'] : []), 'chromium'], {
    stdio: 'inherit',
  });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 2));
  });
}

export async function loginDemo(): Promise<string> {
  requireOptionalAdapter('ui');
  const candidates = [resolve('logiparity-demo/.service.json'), resolve('.service.json')];
  let file: string | undefined, baseUrl: unknown;
  for (const candidate of candidates) {
    try {
      baseUrl = Reflect.get(JSON.parse(await readFile(candidate, 'utf8')) as object, 'baseUrl');
      file = candidate;
      break;
    } catch {
      /* Try the generated project directory. */
    }
  }
  if (!file || typeof baseUrl !== 'string')
    throw new Error('Run npx logiparity demo first in this project to generate its login settings.');
  const base = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password
  )
    throw new Error('demo login supports only the local synthetic demo origin.');
  const destination = resolve(dirname(file), 'auth/state.json');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' }),
      page = await context.newPage();
    await page.goto(new URL('/dispatcher', base).href);
    await page.getByLabel('Username', { exact: true }).fill('dispatcher');
    await page.getByLabel('Password', { exact: true }).fill('demo-password');
    await Promise.all([
      page.waitForURL('**/dispatcher*'),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await page.locator('table#shipments').waitFor();
    await mkdir(dirname(destination), { recursive: true });
    await atomicReportFile(destination, JSON.stringify(await context.storageState(), null, 2) + '\n');
    return `Saved synthetic demo login to ${destination}. Restarting the demo invalidates it; run npx logiparity demo login again.\n`;
  } finally {
    await browser.close();
  }
}
