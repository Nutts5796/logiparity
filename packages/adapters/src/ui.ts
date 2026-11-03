import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { requireOptionalAdapter } from './optional.js';
import {
  assertAllowedHost,
  fieldPaths,
  withSourceRow,
  SourceError,
  type AdapterContext,
  type DataRow,
  type UiConfig,
} from '@logiparity/core';

export async function* readUi(config: UiConfig, context: AdapterContext): AsyncIterable<DataRow> {
  assertAllowedHost(config.url, context.allowedHosts, 'UI');
  requireOptionalAdapter('ui');
  const { chromium } = await import('playwright');
  let browser: Browser | undefined;
  let session: BrowserContext | undefined;
  let page: Page | undefined;
  let violation: SourceError | undefined;
  let pageNumber = 1;
  let rowNumber = 1;
  let stage = 'launch Chromium (run npx logiparity install-browser if it is missing)';
  try {
    browser = await chromium.launch({ headless: true, timeout: Math.max(10000, config.timeoutMs) });
    stage = config.storageState
      ? `load storageState ${resolve(context.baseDir, config.storageState)}`
      : 'create isolated browser context';
    session = await browser.newContext({
      serviceWorkers: 'block',
      ...(config.storageState ? { storageState: resolve(context.baseDir, config.storageState) } : {}),
    });
    const origins = new Set([new URL(config.url).origin, ...config.allowedOrigins]);
    const hostAllowed = (url: URL) => {
      try {
        assertAllowedHost(url, context.allowedHosts, 'UI');
        return true;
      } catch {
        return false;
      }
    };
    const allowed = (url: URL) =>
      hostAllowed(url) &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      origins.has(url.origin);
    const assertOrigin = () => {
      if (violation) throw violation;
      if (page && !allowed(new URL(page.url()))) throw new SourceError('Page navigation left allowedOrigins.');
    };
    await session.route('**/*', async (route) => {
      let url = new URL(route.request().url());
      if (!allowed(url)) {
        if (route.request().isNavigationRequest()) violation = new SourceError('Page navigation left allowedOrigins.');
        await route.abort('blockedbyclient');
        return;
      }
      try {
        for (let redirects = 0; redirects <= 20; redirects++) {
          const response = await route.fetch({ url: url.href, maxRedirects: 0, timeout: config.timeoutMs });
          const location = response.headers().location;
          if (response.status() >= 300 && response.status() < 400 && location) {
            const next = new URL(location, url);
            await response.dispose();
            if (!allowed(next)) throw new SourceError('Redirect Location is outside allowedOrigins.');
            url = next;
            continue;
          }
          await route.fulfill({ response });
          await response.dispose();
          return;
        }
        throw new SourceError('UI redirect limit exceeded.');
      } catch (error) {
        violation =
          error instanceof SourceError ? error : new SourceError('UI request failed while checking redirect origins.');
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
    await session.routeWebSocket('**/*', (socket) =>
      socket.close({ code: 1008, reason: 'LogiParity table snapshots do not open WebSockets.' }),
    );
    page = await session.newPage();
    page.setDefaultTimeout(config.timeoutMs);
    page.setDefaultNavigationTimeout(config.timeoutMs);
    stage = 'navigate to the configured URL; check login/storageState and allowedOrigins';
    const response = await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    assertOrigin();
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
            if (!cells || cells.length !== 1)
              return {
                records: [],
                fingerprint: '',
                error: `Row ${i + 1}, field ${field}: selector ${selector} must match exactly one cell.`,
              };
            const cell = cells[0];
            record[field] = cell instanceof HTMLElement ? cell.innerText : (cell?.textContent ?? '');
          }
          records.push(record);
        }
        return { records, fingerprint: JSON.stringify(elements.map((row) => row.textContent)), error: '' };
      }, fieldPaths(config.fields));
      if (extracted.error) throw new SourceError(extracted.error);
      const fingerprint = extracted.fingerprint;
      assertOrigin();
      const digest = createHash('sha256').update(fingerprint).digest('hex');
      if (visited.has(digest))
        throw new SourceError('Pagination repeated earlier rows; correct nextPage or the target paginator.');
      visited.add(digest);
      for (const record of extracted.records) yield withSourceRow(record, ++rowNumber);
      if (!config.nextPage) return;
      stage = `nextPage selector ${config.nextPage}; ensure it exists on the first page and disables/disappears at the end`;
      const next = page.locator(config.nextPage);
      const count = await next.count();
      if (count === 0 && pageNumber > 1) return;
      if (count !== 1) throw new SourceError('Next-page selector must match one control.');
      if (
        !(await next.isVisible()) ||
        (await next.isDisabled()) ||
        (await next.getAttribute('aria-disabled')) === 'true'
      )
        return;
      if (pageNumber === config.maxPages)
        throw new SourceError(`Reached maxPages=${config.maxPages}; fix pagination or increase the explicit limit.`);
      await next.click();
      assertOrigin();
      stage = `wait for next-page rows to change after ${config.nextPage}; check the paginator and timeoutMs`;
      await page.waitForFunction(
        ({ tableSelector, rowSelector, old }) => {
          const root = document.querySelector(tableSelector);
          return root && JSON.stringify([...root.querySelectorAll(rowSelector)].map((row) => row.textContent)) !== old;
        },
        { tableSelector: config.table, rowSelector: config.rows, old: fingerprint },
        { timeout: config.timeoutMs },
      );
      assertOrigin();
    }
  } catch (error) {
    let screenshot: string | undefined;
    if (page && !page.isClosed()) {
      const name = createHash('sha256')
        .update(JSON.stringify({ url: config.url, table: config.table, fields: config.fields }))
        .digest('hex')
        .slice(0, 12);
      const relative = `screenshots/ui-${name}-page-${pageNumber}.png`;
      const directory = context.reportDir ?? resolve(context.baseDir, 'logiparity-report');
      try {
        await mkdir(join(directory, 'screenshots'), { recursive: true });
        await page.screenshot({
          path: join(directory, relative),
          fullPage: true,
          timeout: Math.max(5000, config.timeoutMs),
        });
        screenshot = relative;
      } catch {
        stage += '; screenshot could not be saved—check report.dir permissions';
      }
    }
    const detail = violation ?? error;
    throw new SourceError(
      `UI page ${pageNumber}: failed to ${stage}.${detail instanceof SourceError ? ` ${detail.message}` : ''} Check this test/staging target and its source configuration.`,
      screenshot,
    );
  } finally {
    await session?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
