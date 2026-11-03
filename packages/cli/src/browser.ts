import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
export async function installBrowser(): Promise<number> {
  let cli: string;
  try {
    cli = join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
  } catch {
    throw new Error(
      'UI sources require Playwright. Run npm install --save-dev playwright@1.64.1, then npx logiparity install-browser.',
    );
  }
  const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 2));
  });
}
