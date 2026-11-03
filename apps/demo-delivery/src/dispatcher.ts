import { brandMark, studioStyle, themeButton, themeScript } from '@logiparity/core';
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DemoData, Shipment } from './seed.js';

export const demoCredentials = { username: 'dispatcher', password: 'demo-password' };
const pageSize = 200;
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const style =
  studioStyle +
  `
.title { display:flex; align-items:end; justify-content:space-between; gap:20px; margin:28px 0 20px; flex-wrap:wrap; }
.title h1 { font-size:36px; letter-spacing:-.03em; line-height:1.2; margin:0 0 8px; }
.title .lead { font-size:15px; } .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
.kpi { display:flex; align-items:center; gap:14px; padding:20px; } .kpi .ic { flex:none; }
.kpi small { display:block; color:var(--muted); font-weight:600; } .kpi b { font-size:28px; font-weight:800; }
.pct { color:var(--muted); font-size:13px; font-weight:600; margin-left:6px; }
.filters { display:flex; gap:12px; align-items:end; flex-wrap:wrap; margin-bottom:20px; }
.filters label { display:grid; gap:4px; font-size:12px; color:var(--muted); font-weight:700; }
.drv { font-weight:700; } .time { position:relative; display:inline-block; vertical-align:top; white-space:nowrap; }
.time-zone { position:absolute; left:5.7em; top:0; font-size:12px; color:var(--muted); line-height:21px; }
.parity-time { display:inline-block; min-width:135px; } .parity-time b { font-weight:600; }
.login { max-width:460px; margin:48px auto; } .login label { display:grid; gap:5px; margin:18px 0; }
.login .btn { width:100%; } .error { color:var(--fail); } .dim { color:var(--muted); }
.signout { margin-top:20px; } .order-pager { display:flex; align-items:center; gap:12px; margin-left:auto; color:var(--muted); font-size:13px; }
@media(max-width:860px) { .kpis { grid-template-columns:1fr 1fr; } .orders thead { display:none; } .orders table,.orders tbody,.orders td { display:block; } .orders tr { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:16px 0; border-top:1px solid var(--line); } .orders td { padding:0; border:0; text-align:left; } .orders td[data-l]::before { content:attr(data-l); display:block; font-size:11px; color:var(--muted); } .order-pager { margin-left:0; } }
@media(max-width:420px) { .kpis { gap:10px; } .kpi { padding:14px; gap:8px; } .kpi .ic { width:32px; height:32px; } .kpi b { font-size:24px; } }
`;

function html(response: ServerResponse, status: number, title: string, body: string): void {
  const script = `(() => {${themeScript}})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; font-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  });
  response.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · LogiParity demo</title><style>${style}</style></head><body><main class="wrap"><header class="top"><div class="brand">${brandMark}Delivery demo <span class="sub">/ Dispatcher</span></div><div class="top-r"><span class="chip">Synthetic data · test &amp; staging only</span>${themeButton}</div></header>${body}</main><script>${script}</script></body></html>`,
  );
}

const kpiIcon = (path: string) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
function displayTime(iso: string | null, zone: string): string {
  if (!iso) return '<span class="parity-time"></span><span class="dim">Not yet</span>';
  const date = new Date(iso);
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const abbreviation =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? zone;
  return `<span class="time"><span class="parity-time"><b>${escape(clock)}</b><span class="sub-l">${escape(day)}</span></span><span class="time-zone">${escape(abbreviation)}</span></span>`;
}

function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/dispatcher';
  const url = new URL(value, 'http://demo.local');
  return url.origin === 'http://demo.local' && url.pathname === '/dispatcher'
    ? url.pathname + url.search
    : '/dispatcher';
}

export function uiStatus(shipment: Shipment, stale: boolean, snapshot: string): string {
  const since = shipment.delivered_at ? Date.parse(snapshot) - Date.parse(shipment.delivered_at) : Infinity;
  return stale && shipment.status === 'delivered' && since >= 0 && since <= 10 * 60000 ? 'in_transit' : shipment.status;
}

export function createDispatcher(data: DemoData, bugs: { staleUi: boolean }) {
  const sessions = new Map<string, number>();
  const login = (res: ServerResponse, next: string, error = false) =>
    html(
      res,
      error ? 401 : 200,
      'Sign in',
      `<section class="card login"><h1>Dispatcher sign in</h1><p>Use the documented synthetic demo account.</p>${error ? '<p class="error" role="alert">Sign in failed. Check the demo username and password.</p>' : ''}<form method="post" action="/login"><input type="hidden" name="next" value="${escape(next)}"><label for="username">Username<input id="username" name="username" autocomplete="username" required></label><label for="password">Password<input id="password" name="password" type="password" autocomplete="current-password" required></label><button class="btn btn-primary" type="submit">Sign in</button></form><p>Demo credentials: <span class="mono">dispatcher / demo-password</span>. This is a local demonstration login, not production authentication.</p></section>`,
    );
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    if (!['/login', '/logout', '/dispatcher'].includes(url.pathname)) return false;
    if (url.pathname === '/login' && request.method === 'GET') {
      login(response, safeNext(url.searchParams.get('next')));
      return true;
    }
    if (url.pathname === '/login' && request.method === 'POST') {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
        html(response, 403, 'Forbidden', '<p>Use the login form on this demo origin.</p>');
        return true;
      }
      let body = '';
      for await (const chunk of request as AsyncIterable<Buffer>) {
        body += chunk.toString('utf8');
        if (Buffer.byteLength(body) > 8192)
          throw new Error('Login form exceeds 8 KiB; submit only the documented demo credentials.');
      }
      const form = new URLSearchParams(body);
      const next = safeNext(form.get('next'));
      if (form.get('username') !== demoCredentials.username || form.get('password') !== demoCredentials.password) {
        login(response, next, true);
        return true;
      }
      const token = randomBytes(32).toString('hex');
      if (sessions.size >= 1000) {
        const oldest = sessions.keys().next().value as string | undefined;
        if (oldest) sessions.delete(oldest);
      }
      sessions.set(token, Date.now() + 3600000);
      response.writeHead(303, {
        location: next,
        'set-cookie': `logiparity_demo=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
        'cache-control': 'no-store',
      });
      response.end();
      return true;
    }
    const token = request.headers.cookie?.match(/(?:^|;\s*)logiparity_demo=([a-f0-9]{64})(?:;|$)/)?.[1] ?? '';
    const authenticated = (sessions.get(token) ?? 0) > Date.now();
    if (url.pathname === '/logout' && request.method === 'POST') {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
        html(response, 403, 'Forbidden', '<p>Use the logout form on this demo origin.</p>');
        return true;
      }
      sessions.delete(token);
      response.writeHead(303, {
        location: '/login',
        'set-cookie': 'logiparity_demo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
        'cache-control': 'no-store',
      });
      response.end();
      return true;
    }
    if (request.method !== 'GET' || url.pathname !== '/dispatcher') {
      html(
        response,
        405,
        'Method not allowed',
        '<p>Use GET to view the dispatcher or POST for its login/logout forms.</p>',
      );
      return true;
    }
    if (!authenticated) {
      response.writeHead(302, {
        location: `/login?next=${encodeURIComponent(safeNext(url.pathname + url.search))}`,
        'cache-control': 'no-store',
      });
      response.end();
      return true;
    }
    if (url.searchParams.has('date') && url.searchParams.get('date') !== data.date) {
      html(
        response,
        400,
        'Unknown date',
        `<p>Synthetic data exists only for ${escape(data.date)}. Correct the date filter.</p>`,
      );
      return true;
    }
    const status = url.searchParams.get('status') ?? '';
    if (!['', 'delivered', 'in_transit', 'cancelled'].includes(status)) {
      html(response, 400, 'Unknown status', '<p>Choose Delivered, In transit or All statuses.</p>');
      return true;
    }
    const pageText = url.searchParams.get('page') ?? '1';
    if (!/^\d+$/.test(pageText) || !Number.isSafeInteger(Number(pageText)) || Number(pageText) < 1) {
      html(response, 400, 'Invalid page', '<p>Page must be a positive integer.</p>');
      return true;
    }
    const page = Number(pageText);
    const filtered = data.shipments.filter((s) => !status || s.status === status);
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > pages) {
      html(response, 400, 'Invalid page', `<p>The selected filter has ${pages} pages. Start with page 1.</p>`);
      return true;
    }
    const snapshot = data.clock;
    const zone = url.searchParams.get('tz') === 'UTC' ? 'UTC' : 'America/Chicago';
    const zoneName = zone === 'UTC' ? 'UTC' : 'Chicago';
    const snapshotText = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(snapshot));
    const rowHtml = filtered
      .slice((page - 1) * pageSize, page * pageSize)
      .map((s) => {
        const state = uiStatus(s, bugs.staleUi, snapshot);
        return `<tr><td data-l="Shipment"><code data-col="id">${escape(s.id)}</code><span class="sub-l">Zone ${escape(s.zone.replace('Z', ''))}</span></td><td data-l="Status"><span data-col="status" class="tag ${state === 'delivered' ? 't-ok' : 't-info'}">${state === 'delivered' ? 'Delivered' : state === 'cancelled' ? 'Cancelled' : 'In transit'}</span></td><td class="drv" data-l="Driver">${escape(s.driver_id)}<span class="sub-l">Vehicle ${escape(s.vehicle_id)}</span></td><td data-col="eta" data-l="ETA">${displayTime(s.eta, zone)}</td><td data-col="delivered_at" data-l="Delivered">${displayTime(s.delivered_at, zone)}</td><td class="num" data-l="Driver payout"><span data-col="payout">$${escape(s.driver_payout)}</span></td></tr>`;
      })
      .join('');
    const hidden = `<input type="hidden" name="date" value="${data.date}"><input type="hidden" name="status" value="${status}"><input type="hidden" name="tz" value="${zone}">`;
    const delivered = data.shipments.filter((s) => uiStatus(s, bugs.staleUi, snapshot) === 'delivered').length;
    const transit = data.shipments.filter((s) => uiStatus(s, bugs.staleUi, snapshot) === 'in_transit').length;
    const kpis = [
      ['Orders', data.shipments.length, '', '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v8l9 5 9-5V8M12 13v8"/>', 'tz'],
      [
        'Delivered',
        delivered,
        `${Math.round((delivered / data.shipments.length) * 100)}%`,
        '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
        'ok',
      ],
      [
        'In transit',
        transit,
        `${Math.round((transit / data.shipments.length) * 100)}%`,
        '<path d="M3 6h11v10H3ZM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
        'round',
      ],
      [
        'Drivers on shift',
        data.drivers.filter((d) => d.available).length,
        '',
        '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        'review',
      ],
    ]
      .map(
        ([label, value, percent, path, color]) =>
          `<div class="card kpi" style="--c:${color === 'ok' ? 'var(--ok)' : `var(--c-${color})`};--soft:${color === 'ok' ? 'var(--ok-soft)' : color === 'review' ? 'var(--chip)' : `var(--c-${color}-soft)`}"><div class="ic">${kpiIcon(String(path))}</div><div><small>${label}</small><b>${Number(value).toLocaleString('en-US')}</b>${percent ? `<span class="pct">${percent}</span>` : ''}</div></div>`,
      )
      .join('');
    const timezoneButtons = ['America/Chicago', 'UTC']
      .map(
        (tz) =>
          `<form method="get" action="/dispatcher"><input type="hidden" name="date" value="${data.date}"><input type="hidden" name="status" value="${status}"><button name="tz" value="${tz}" aria-pressed="${zone === tz}">${tz === 'UTC' ? 'UTC' : 'Depot time (Chicago)'}</button></form>`,
      )
      .join('');
    html(
      response,
      200,
      'Dispatcher',
      `<div class="title"><div><h1>Today's deliveries</h1><div class="lead">${data.shipments.length.toLocaleString('en-US')} orders · ${data.drivers.length} synthetic drivers · Snapshot ${escape(snapshotText)}</div></div><div class="seg" role="group" aria-label="Time zone">${timezoneButtons}</div></div><section class="kpis">${kpis}</section><h3>Orders</h3><section class="card orders"><form class="filters" method="get" action="/dispatcher"><label>Date<input id="date" name="date" type="date" value="${data.date}"></label><div><label for="status">Status</label><select id="status" name="status"><option value="">All statuses</option><option value="delivered"${status === 'delivered' ? ' selected' : ''}>Delivered</option><option value="in_transit"${status === 'in_transit' ? ' selected' : ''}>In transit</option><option value="cancelled"${status === 'cancelled' ? ' selected' : ''}>Cancelled</option></select></div><input type="hidden" name="tz" value="${zone}"><button class="btn btn-primary" type="submit">Apply filters</button><span class="order-pager">${filtered.length.toLocaleString('en-US')} orders · Page ${page} of ${pages}</span></form><table id="shipments"><thead><tr><th>Shipment</th><th>Status</th><th>Driver</th><th>ETA (${zoneName})</th><th>Delivered (${zoneName})</th><th class="num">Driver payout</th></tr></thead><tbody>${rowHtml}</tbody></table><nav class="pager" aria-label="Order pages"><form method="get" action="/dispatcher">${hidden}<input type="hidden" name="page" value="${page - 1}"><button class="btn btn-soft" aria-label="Previous page"${page === 1 ? ' disabled' : ''}>Previous</button></form><span>${page} / ${pages}</span><form method="get" action="/dispatcher">${hidden}<input type="hidden" name="page" value="${page + 1}"><button class="btn btn-soft" aria-label="Next page"${page === pages ? ' disabled' : ''}>Next</button></form></nav></section><form class="signout" method="post" action="/logout"><button class="btn btn-soft" type="submit">Sign out</button></form>`,
    );
    return true;
  };
}
