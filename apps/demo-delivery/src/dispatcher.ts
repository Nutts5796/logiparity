import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DemoData, Shipment } from './seed.js';

export const demoCredentials = { username: 'dispatcher', password: 'demo-password' };
const pageSize = 200;
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const style = `:root{font-family:system-ui,sans-serif;line-height:1.5;color:#19392e;background:#f4f6f2}*{box-sizing:border-box}body{margin:0}main{max-width:1400px;margin:auto;padding:32px}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:20px;border-bottom:1px solid #d4dfd4}h1{font-size:32px;letter-spacing:-1px;margin:28px 0 8px}h2{font-size:18px}.brand{font-size:21px;font-weight:750}p{color:#526b5e}.badge{font-size:12px;letter-spacing:.05em;text-transform:uppercase}.panel{padding:24px;background:white;border:1px solid #d6e1d5;border-radius:12px;margin:24px 0}.filters{display:flex;align-items:end;gap:16px;flex-wrap:wrap}label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}input,select,button{font:inherit;border:1px solid #b9cebe;border-radius:6px;padding:9px 12px;background:white;color:#19392e}button{cursor:pointer;background:#126c4f;color:white}button:disabled{opacity:.4;cursor:default}input:focus,select:focus,button:focus{outline:2px solid #17865e;outline-offset:2px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:700px;font-size:13px;text-align:left}th,td{padding:14px 16px;border-bottom:1px solid #e0e7dc}th{background:#f2f6ee;color:#496456;font-size:12px}td:first-child{font-family:monospace}.status{background:#eaf2e5;border-radius:4px;padding:3px 7px;white-space:nowrap}nav{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:20px}.login{max-width:460px;margin:48px auto}.login input{width:100%;margin-bottom:18px}.error{color:#9b3527}.mono{font-family:monospace}a{color:#116847}@media(max-width:600px){main{padding:18px}header{align-items:start}.badge{max-width:150px;text-align:right}h1{font-size:27px}.panel{padding:16px}.filters>div{width:100%}.filters input,.filters select{width:100%}nav{gap:8px;font-size:12px}}`;

function html(response: ServerResponse, status: number, title: string, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · LogiParity demo</title><style>${style}</style></head><body><main><header><div class="brand">LogiParity / Delivery demo</div><div class="badge">Synthetic data · Test &amp; staging only</div></header>${body}</main></body></html>`);
}

function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/dispatcher';
  const url = new URL(value, 'http://demo.local');
  return url.origin === 'http://demo.local' && url.pathname === '/dispatcher' ? url.pathname + url.search : '/dispatcher';
}

export function uiStatus(shipment: Shipment, stale: boolean, snapshot: string): string {
  const since = shipment.delivered_at ? Date.parse(snapshot) - Date.parse(shipment.delivered_at) : Infinity;
  return stale && shipment.status === 'delivered' && since >= 0 && since <= 10 * 60000 ? 'in_transit' : shipment.status;
}

export function createDispatcher(data: DemoData, bugs: { staleUi: boolean }) {
  const sessions = new Map<string, number>();
  const login = (res: ServerResponse, next: string, error = false) => html(res, error ? 401 : 200, 'Sign in', `<section class="panel login"><h1>Dispatcher sign in</h1><p>Use the documented synthetic demo account.</p>${error ? '<p class="error" role="alert">Sign in failed. Check the demo username and password.</p>' : ''}<form method="post" action="/login"><input type="hidden" name="next" value="${escape(next)}"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form><p>Demo credentials: <span class="mono">dispatcher / demo-password</span>. This is a local demonstration login, not production authentication.</p></section>`);
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    if (!['/login', '/logout', '/dispatcher'].includes(url.pathname)) return false;
    if (url.pathname === '/login' && request.method === 'GET') { login(response, safeNext(url.searchParams.get('next'))); return true; }
    if (url.pathname === '/login' && request.method === 'POST') {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) { html(response, 403, 'Forbidden', '<p>Use the login form on this demo origin.</p>'); return true; }
      let body = '';
      for await (const chunk of request as AsyncIterable<Buffer>) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 8192) throw new Error('Login form exceeds 8 KiB; submit only the documented demo credentials.'); }
      const form = new URLSearchParams(body);
      const next = safeNext(form.get('next'));
      if (form.get('username') !== demoCredentials.username || form.get('password') !== demoCredentials.password) { login(response, next, true); return true; }
      const token = randomBytes(32).toString('hex');
      if (sessions.size >= 1000) { const oldest = sessions.keys().next().value as string | undefined; if (oldest) sessions.delete(oldest); }
      sessions.set(token, Date.now() + 3600000);
      response.writeHead(303, { location: next, 'set-cookie': `logiparity_demo=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`, 'cache-control': 'no-store' }); response.end(); return true;
    }
    const token = request.headers.cookie?.match(/(?:^|;\s*)logiparity_demo=([a-f0-9]{64})(?:;|$)/)?.[1] ?? '';
    const authenticated = (sessions.get(token) ?? 0) > Date.now();
    if (url.pathname === '/logout' && request.method === 'POST') {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) { html(response, 403, 'Forbidden', '<p>Use the logout form on this demo origin.</p>'); return true; }
      sessions.delete(token); response.writeHead(303, { location: '/login', 'set-cookie': 'logiparity_demo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0', 'cache-control': 'no-store' }); response.end(); return true;
    }
    if (request.method !== 'GET' || url.pathname !== '/dispatcher') { html(response, 405, 'Method not allowed', '<p>Use GET to view the dispatcher or POST for its login/logout forms.</p>'); return true; }
    if (!authenticated) { response.writeHead(302, { location: `/login?next=${encodeURIComponent(safeNext(url.pathname + url.search))}`, 'cache-control': 'no-store' }); response.end(); return true; }
    if (url.searchParams.has('date') && url.searchParams.get('date') !== data.date) { html(response, 400, 'Unknown date', `<p>Synthetic data exists only for ${escape(data.date)}. Correct the date filter.</p>`); return true; }
    const status = url.searchParams.get('status') ?? '';
    if (!['', 'delivered', 'in_transit'].includes(status)) { html(response, 400, 'Unknown status', '<p>Choose Delivered, In transit or All statuses.</p>'); return true; }
    const pageText = url.searchParams.get('page') ?? '1';
    if (!/^\d+$/.test(pageText) || !Number.isSafeInteger(Number(pageText)) || Number(pageText) < 1) { html(response, 400, 'Invalid page', '<p>Page must be a positive integer.</p>'); return true; }
    const page = Number(pageText);
    const filtered = data.shipments.filter((s) => !status || s.status === status);
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > pages) { html(response, 400, 'Invalid page', `<p>The selected filter has ${pages} pages. Start with page 1.</p>`); return true; }
    const snapshot = `${data.date}T14:00:00Z`;
    const rowHtml = filtered.slice((page - 1) * pageSize, page * pageSize).map((s) => {
      const state = uiStatus(s, bugs.staleUi, snapshot);
      return `<tr><td data-col="id">${escape(s.id)}</td><td data-col="status"><span class="status">${state === 'delivered' ? 'Delivered' : 'In transit'}</span></td><td data-col="payout">${escape(s.driver_payout)}</td><td data-col="delivered_at">${escape(s.delivered_at ?? '')}</td><td>${escape(s.driver_id)}</td></tr>`;
    }).join('');
    const hidden = `<input type="hidden" name="date" value="${data.date}"><input type="hidden" name="status" value="${status}">`;
    html(response, 200, 'Dispatcher', `<h1>Delivery dispatcher</h1><p>${data.drivers.length} synthetic drivers · ${data.shipments.length.toLocaleString('en-US')} orders · Snapshot ${snapshot}</p><section class="panel"><form class="filters" method="get" action="/dispatcher"><div><label for="date">Date</label><input id="date" name="date" type="date" value="${data.date}"></div><div><label for="status">Status</label><select id="status" name="status"><option value="">All statuses</option><option value="delivered"${status === 'delivered' ? ' selected' : ''}>Delivered</option><option value="in_transit"${status === 'in_transit' ? ' selected' : ''}>In transit</option></select></div><button type="submit">Apply filters</button></form></section><section class="panel"><h2>${filtered.length.toLocaleString('en-US')} orders · Page ${page} of ${pages}</h2><div class="scroll"><table id="shipments"><thead><tr><th>Shipment ID</th><th>Status</th><th>Driver payout (USD)</th><th>Delivered at (UTC)</th><th>Driver</th></tr></thead><tbody>${rowHtml}</tbody></table></div><nav aria-label="Order pages"><form method="get" action="/dispatcher">${hidden}<input type="hidden" name="page" value="${page - 1}"><button aria-label="Previous page"${page === 1 ? ' disabled' : ''}>Previous</button></form><span>${page} / ${pages}</span><form method="get" action="/dispatcher">${hidden}<input type="hidden" name="page" value="${page + 1}"><button aria-label="Next page"${page === pages ? ' disabled' : ''}>Next</button></form></nav></section><form method="post" action="/logout"><button type="submit">Sign out</button></form>`);
    return true;
  };
}
