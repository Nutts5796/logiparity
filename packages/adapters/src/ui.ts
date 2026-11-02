import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { SourceError, type AdapterContext, type DataRow, type UiConfig } from '@logiparity/core';

export async function* readUi(config: UiConfig, context: AdapterContext): AsyncIterable<DataRow> {
  let browser: Browser | undefined;
  let session: BrowserContext | undefined;
  let page: Page | undefined;
  let pageNumber = 1;
  let stage = 'launch Chromium (run npx playwright install chromium if it is missing)';
  try {
    browser = await chromium.launch({ headless: true, timeout: Math.max(10000, config.timeoutMs) });
    stage = config.storageState ? `load storageState ${resolve(context.baseDir, config.storageState)}` : 'create isolated browser context';
    session = await browser.newContext({ serviceWorkers: 'block', ...(config.storageState ? { storageState: resolve(context.baseDir, config.storageState) } : {}) });
    const origins = new Set([new URL(config.url).origin, ...config.allowedOrigins]);
    await session.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return ['http:', 'https:'].includes(url.protocol) && origins.has(url.origin) ? route.continue() : route.abort('blockedbyclient');
    });
    await session.routeWebSocket('**/*', (socket) => socket.close({ code: 1008, reason: 'LogiParity table snapshots do not open WebSockets.' }));
    page = await session.newPage();
    page.setDefaultTimeout(config.timeoutMs);
    page.setDefaultNavigationTimeout(config.timeoutMs);
    stage = 'navigate to the configured URL; check login/storageState and allowedOrigins';
    const response = await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    if (response && !response.ok()) throw new SourceError(`HTTP ${response.status()}`);
    const visited = new Set<string>();
    for (; pageNumber <= config.maxPages; pageNumber++) {
      stage = `find table ${config.table}${config.readySelector ? ` and readySelector ${config.readySelector}` : ''}; check login/storageState and selectors`;
      if (config.readySelector) await page.locator(config.readySelector).waitFor({ state: 'visible' });
      const table = page.locator(config.table);
      await table.waitFor({ state: 'visible' });
      const rows = table.locator(config.rows);
      stage = 'extract mapped CSS cells; check fields and unique cell matches';
      const extracted = await rows.evaluateAll((elements, fields) => {
        const records: Record<string, string>[] = [];
        for (let i = 0; i < elements.length; i++) {
          const record: Record<string, string> = Object.create(null) as Record<string, string>;
          for (const [field, selector] of Object.entries(fields)) {
            const cells = elements[i]?.querySelectorAll(selector);
            if (!cells || cells.length !== 1) return { records: [], fingerprint: '', error: `Row ${i + 1}, field ${field}: selector ${selector} must match exactly one cell.` };
            const cell = cells[0];
            record[field] = cell instanceof HTMLElement ? cell.innerText : cell?.textContent ?? '';
          }
          records.push(record);
        }
        return { records, fingerprint: JSON.stringify(elements.map((row) => row.textContent)), error: '' };
      }, config.fields);
      if (extracted.error) throw new SourceError(extracted.error);
      const fingerprint = extracted.fingerprint;
      const digest = createHash('sha256').update(fingerprint).digest('hex');
      if (visited.has(digest)) throw new SourceError('Pagination repeated earlier rows; correct nextPage or the target paginator.');
      visited.add(digest);
      yield* extracted.records;
      if (!config.nextPage) return;
      stage = `nextPage selector ${config.nextPage}; ensure it exists on the first page and disables/disappears at the end`;
      const next = page.locator(config.nextPage);
      const count = await next.count();
      if (count === 0 && pageNumber > 1) return;
      if (count !== 1) throw new SourceError('Next-page selector must match one control.');
      if (!await next.isVisible() || await next.isDisabled() || await next.getAttribute('aria-disabled') === 'true') return;
      if (pageNumber === config.maxPages) throw new SourceError(`Reached maxPages=${config.maxPages}; fix pagination or increase the explicit limit.`);
      await next.click();
      stage = `wait for next-page rows to change after ${config.nextPage}; check the paginator and timeoutMs`;
      await page.waitForFunction(({ tableSelector, rowSelector, old }) => {
        const root = document.querySelector(tableSelector);
        return root && JSON.stringify([...root.querySelectorAll(rowSelector)].map((row) => row.textContent)) !== old;
      }, { tableSelector: config.table, rowSelector: config.rows, old: fingerprint }, { timeout: config.timeoutMs });
    }
  } catch (error) {
    let screenshot: string | undefined;
    if (page && !page.isClosed()) {
      const name = createHash('sha256').update(JSON.stringify({ url: config.url, table: config.table, fields: config.fields })).digest('hex').slice(0, 12);
      const relative = `screenshots/ui-${name}-page-${pageNumber}.png`;
      const directory = context.reportDir ?? resolve(context.baseDir, 'logiparity-report');
      try { await mkdir(join(directory, 'screenshots'), { recursive: true }); await page.screenshot({ path: join(directory, relative), fullPage: true, timeout: Math.max(5000, config.timeoutMs) }); screenshot = relative; }
      catch { stage += '; screenshot could not be saved—check report.dir permissions'; }
    }
    throw new SourceError(`UI page ${pageNumber}: failed to ${stage}.${error instanceof SourceError ? ` ${error.message}` : ''} Check this test/staging target and its source configuration.`, screenshot);
  } finally {
    await session?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
