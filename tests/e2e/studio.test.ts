import { once } from 'node:events';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { compareEntities, entitySchema, htmlReport, type Report, type EntityConfig } from '@logiparity/core';
import { createDemoServer, exportValues } from '../../apps/demo-delivery/src/server.js';
import { seedData } from '../../apps/demo-delivery/src/seed.js';

let browser: Browser;
let url: string;
let server: ReturnType<typeof createDemoServer>['server'];
let report: Report;
let html: string;
let entity: EntityConfig;
beforeAll(async () => {
  browser = await chromium.launch();
  const demo = createDemoServer();
  server = demo.server;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Demo server has no port');
  url = `http://127.0.0.1:${address.port}`;
  const source = {
    type: 'csv',
    file: 'unused.csv',
    fields: {
      id: 'ID',
      payout: { path: 'Pay', label: 'Driver payout' },
      delivered_at: { path: 'At', label: 'Delivery time' },
      status: 'Status',
    },
  };
  entity = entitySchema.parse({
    name: 'order',
    pluralLabel: 'orders',
    key: 'id',
    sources: {
      api: { ...source, label: 'API' },
      export: { ...source, label: 'Excel export' },
      csv: { ...source, label: 'CSV export' },
    },
    compare: {
      payout: { type: 'money', currency: 'USD' },
      delivered_at: { type: 'datetime', sourceTimezones: { csv: 'UTC', export: 'UTC' } },
    },
    aggregates: [
      { name: 'delivered_count', label: 'Delivered orders', type: 'count', where: { status: 'delivered' } },
      { name: 'payout_total', label: 'Total driver payout', type: 'sum', field: 'payout' },
    ],
  });
  const data = seedData();
  report = await compareEntities([entity], async function* (source) {
    for (let index = 0; index < data.shipments.length; index++) {
      if (source === 'export' && ((index + 1) % 200 === 0 || index + 1 === data.shipments.length)) continue;
      const shipment = data.shipments[index]!;
      const exported = exportValues(shipment, {
        roundingPayout: true,
        timezoneShift: true,
        dropLastRow: false,
        staleUi: false,
        loseOrder: false,
        doubleAssign: false,
      });
      yield {
        id: shipment.id,
        payout: source === 'api' ? shipment.driver_payout : exported[2],
        delivered_at: source === 'api' ? shipment.delivered_at : exported[3],
        status: shipment.status,
      };
    }
  });
  html = htmlReport(report, {
    entities: [entity],
    environment: 'test',
    configFile: 'parity.yaml',
    generatedAt: '2026-11-03T10:00:00Z',
  });
}, 30000);
afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
});

it('opens the complete report offline with zero requests, correct default review, and accessible charts', async () => {
  const context = await browser.newContext({ offline: true, colorScheme: 'light' });
  try {
    const requests: string[] = [];
    await context.route('**/*', async (route) => {
      requests.push(route.request().url());
      await route.abort();
    });
    const page = await context.newPage();
    page.on('request', (request) => {
      requests.push(request.url());
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    expect(report.findings.length).toBe(3741);
    expect(await page.locator('[data-mode=review]').getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('#findings tbody tr').count()).toBe(report.coverage!.needsReview);
    expect(await page.locator('.pats article').count()).toBe(3);
    const timezone = page.locator('.pat').filter({ hasText: '6 hours earlier' });
    expect(await timezone.locator('.next-step').innerText()).toBe(
      'Next step: Set sourceTimezones for CSV export and Excel export to the zones each export writes in.',
    );
    const dialLabel = await timezone.locator('svg[role=img]').getAttribute('aria-label');
    expect(dialLabel).toContain('2:14 PM UTC');
    expect(dialLabel).toContain('8:14 AM UTC');
    expect(await page.locator('.pat').filter({ hasText: 'Rounding' }).locator('.cap').last().innerText()).toContain(
      'Excel export: 34 of 2,736 (1.2%)',
    );
    expect(await page.locator('.donut svg').getAttribute('aria-label')).toBe(
      `${Math.floor((report.coverage!.explained / report.findings.length) * 100)}% of findings accounted for`,
    );
    expect(await page.locator('.recon').innerText()).toContain('accounted for');
    expect(await page.locator('#findings tbody').innerText()).toBe('');
    expect(await page.locator('.totals').innerText()).toContain('Total driver payout');
  } finally {
    await context.close();
  }
});

it('filters merged cards, searches all findings by human labels, and pages instead of rendering thousands of rows', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    await page
      .locator('.pat')
      .filter({ hasText: 'Rounding' })
      .getByRole('button', { name: 'Show these findings' })
      .click();
    expect(await page.locator('#visible-count').innerText()).toContain('68 results');
    expect(await page.locator('#findings tbody tr').count()).toBe(50);
    expect(await page.locator('#findings tbody').innerText()).toContain('$');
    expect(await page.locator('#findings tbody span[title]').count()).toBeGreaterThan(0);
    await page.locator('[data-mode=all]').click();
    await page.getByLabel('Search findings').fill('S002748');
    expect(await page.locator('#findings tbody').innerText()).toContain('S002748');
    expect(await page.locator('#visible-count').innerText()).toContain('2 results');
    await page.getByLabel('Search findings').fill('Excel export delivery time');
    expect(await page.locator('#visible-count').innerText()).toContain('1,823 results');
    await page.getByLabel('Search findings').fill('');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    expect(await page.locator('#page-number').innerText()).toContain('Page 2');
    expect(await page.locator('#findings tbody tr').count()).toBe(50);
    await page.locator('[data-mode=review]').click();
    expect(await page.locator('#findings tbody tr').count()).toBe(report.coverage!.needsReview);
  } finally {
    await page.close();
  }
});

it('honors system theme and toggles safely when localStorage is unavailable, with stacked mobile rows', async () => {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 375, height: 900 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('Storage blocked');
        },
      });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.setContent(html);
    expect(await page.locator('#theme').getAttribute('aria-pressed')).toBe('true');
    await page.locator('#theme').click();
    expect(await page.locator('html').getAttribute('data-theme')).toBe('light');
    await page.locator('#theme').click();
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
    expect(await page.locator('#findings thead').isVisible()).toBe(false);
    const accountedValue = page.locator('.recon .rows b').filter({ hasText: 'accounted for' }).first();
    expect(
      await accountedValue.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      }),
    ).toBe(1);
    await page.locator('[data-mode=all]').click();
    expect(
      await page
        .locator('#findings tbody tr')
        .first()
        .evaluate((row) => getComputedStyle(row).display),
    ).toBe('grid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const sizes = await page
      .locator('button')
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => button.getBoundingClientRect().height > 0)
          .map((button) => button.getBoundingClientRect().height),
      );
    expect(sizes.every((height) => height >= 40)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

it('keeps report text contrast at least 4.5:1 in both themes', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    for (const theme of ['light', 'dark']) {
      const ratios = await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        const css = getComputedStyle(document.documentElement);
        const luminance = (token: string) => {
          const hex = css.getPropertyValue(token).trim();
          const channels = [1, 3, 5]
            .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
            .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
        };
        const pairs = ['--ink', '--muted', '--faint']
          .flatMap((foreground) => ['--bg', '--panel', '--chip'].map((background) => [foreground, background]))
          .concat(['page', 'tz', 'round'].map((color) => [`--c-${color}`, `--c-${color}-soft`]));
        return pairs.map(([foreground, background]) => {
          const left = luminance(foreground!),
            right = luminance(background!);
          return { foreground, background, ratio: (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05) };
        });
      }, theme);
      expect(ratios.filter((pair) => pair.ratio < 4.5)).toEqual([]);
    }
  } finally {
    await page.close();
  }
});

it('persists the theme and shows visible Chicago times, UTC toggle, KPIs and mobile dispatcher rows', async () => {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1200, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(url + '/dispatcher');
    await page.getByLabel('Username', { exact: true }).fill('dispatcher');
    await page.getByLabel('Password', { exact: true }).fill('demo-password');
    await Promise.all([
      page.waitForURL('**/dispatcher'),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    expect(await page.getByRole('heading', { name: "Today's deliveries" }).isVisible()).toBe(true);
    expect(await page.locator('.kpis .card').count()).toBe(4);
    const second = page.locator('#shipments tbody tr').nth(1);
    expect(await second.locator('[data-col=delivered_at]').innerText()).toContain('8:14 AM');
    expect(await second.locator('[data-col=delivered_at]').innerText()).toContain('CST');
    expect(await second.locator('.parity-time').last().innerText()).toBe('8:14 AM\nNov 2, 2026');
    await page.locator('#theme').click();
    await page.reload();
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
    await page.getByRole('button', { name: 'UTC', exact: true }).click();
    expect(await second.locator('[data-col=delivered_at]').innerText()).toContain('2:14 PM');
    await page.setViewportSize({ width: 375, height: 900 });
    expect(await page.locator('#shipments thead').isVisible()).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    expect(await page.locator('#shipments [data-col=id]').first().innerText()).toBe('S000201');
  } finally {
    await context.close();
  }
});
it('shows an empty review state, selects the all tab for a cause and offers a clear filter', async () => {
  const page = await browser.newPage();
  try {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setContent(html);
    expect(await page.locator('#no-matches').innerText()).toContain('Nothing needs individual review. See All (3,741)');
    expect(await page.locator('#next').isHidden()).toBe(true);
    expect(await page.locator('#theme').getAttribute('aria-label')).toBe('Switch to dark theme');
    await page.locator('.pat').filter({ hasText: 'Rounding' }).getByRole('button').click();
    expect(await page.locator('[data-mode=all]').getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByRole('button', { name: 'Clear filter' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Clear filter' }).click();
    expect(await page.locator('#active-pattern').innerText()).toBe('');
    expect(await page.locator('#visible-count').innerText()).toContain('3,741');
    await page.locator('#theme').click();
    expect(await page.locator('#theme').getAttribute('aria-label')).toBe('Switch to light theme');
  } finally {
    await page.close();
  }
});
it('redirects the demo root to its dispatcher', async () => {
  const response = await fetch(url + '/', { redirect: 'manual' });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('/dispatcher');
});
