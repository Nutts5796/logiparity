import { readFileSync } from 'node:fs';

const font = (name: string) =>
  readFileSync(new URL(`../assets/fonts/${name}-latin.woff2`, import.meta.url)).toString('base64');
export const studioStyle = `
@font-face { font-family: Manrope; font-style: normal; font-weight: 500 800; font-display: swap; src: url(data:font/woff2;base64,${font('manrope')}) format('woff2'); }
@font-face { font-family: "JetBrains Mono"; font-style: normal; font-weight: 400 600; font-display: swap; src: url(data:font/woff2;base64,${font('jetbrainsmono')}) format('woff2'); }

:root {
  --bg: #f6f6f3; --panel: #ffffff; --ink: #15201b; --muted: #5f6c65; --faint: #5d6961; --line: #e8e9e3; --line-2: #f0f0eb; --chip: #ecede8;
  --shadow: 0 1px 2px rgba(20, 30, 25, .05), 0 8px 24px rgba(20, 30, 25, .06);
  --brand: #1d7a52; --brand-soft: #e3f3ea; --mark: #15201b; --mark-a: #7ee0b0; --mark-b: #ffffff;
  --fail: #b42318; --fail-soft: #fdeceb; --ok: #1d7a46; --ok-soft: #e4f4ea; --info: #2f5fb3; --info-soft: #e8effc;
  --c-page: #b52b32; --c-page-soft: #fdecec; --c-tz: #2858c4; --c-tz-soft: #e8effc; --c-round: #8c5706; --c-round-soft: #fdf3e1; --c-review: #15201b;
  --sans: Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #0e1311; --panel: #161c19; --ink: #e8eeea; --muted: #a3b0a9; --faint: #98a69e; --line: #26302b; --line-2: #1d2521; --chip: #1f2723;
  --shadow: 0 1px 0 rgba(255, 255, 255, .03) inset, 0 10px 30px rgba(0, 0, 0, .35);
  --brand: #5fd19c; --brand-soft: #173326; --mark: #e8eeea; --mark-a: #1d7a52; --mark-b: #0e1311;
  --fail: #ff8a7a; --fail-soft: #3a1c19; --ok: #5fd19c; --ok-soft: #163225; --info: #8db4ff; --info-soft: #18263f;
  --c-page: #ff7b7f; --c-page-soft: #3a1d1f; --c-tz: #7fa6ff; --c-tz-soft: #18263f; --c-round: #f3b24e; --c-round-soft: #3a2c14; --c-review: #e8eeea;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0e1311; --panel: #161c19; --ink: #e8eeea; --muted: #a3b0a9; --faint: #98a69e; --line: #26302b; --line-2: #1d2521; --chip: #1f2723;
    --shadow: 0 1px 0 rgba(255, 255, 255, .03) inset, 0 10px 30px rgba(0, 0, 0, .35);
    --brand: #5fd19c; --brand-soft: #173326; --mark: #e8eeea; --mark-a: #1d7a52; --mark-b: #0e1311;
    --fail: #ff8a7a; --fail-soft: #3a1c19; --ok: #5fd19c; --ok-soft: #163225; --info: #8db4ff; --info-soft: #18263f;
    --c-page: #ff7b7f; --c-page-soft: #3a1d1f; --c-tz: #7fa6ff; --c-tz-soft: #18263f; --c-round: #f3b24e; --c-round-soft: #3a2c14; --c-review: #e8eeea;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
code, .mono { font-family: var(--mono); font-size: .88em; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 26px 32px 64px; }
.top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; letter-spacing: -.01em; }
.brand span.sub { font-weight: 500; color: var(--muted); }
.mark { width: 30px; height: 30px; border-radius: 9px; background: var(--mark); display: grid; place-items: center; flex: none; }
.top-r { display: flex; align-items: center; gap: 10px; }
.chip { font-size: 12px; font-weight: 600; color: var(--muted); background: var(--chip); padding: 6px 12px; border-radius: 999px; white-space: nowrap; }
.theme { width: 40px; height: 40px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); display: grid; place-items: center; cursor: pointer; }
.theme:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.card { background: var(--panel); border-radius: 22px; padding: 24px 26px; box-shadow: var(--shadow); border: 1px solid transparent; }
:root[data-theme="dark"] .card { border-color: var(--line); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .card { border-color: var(--line); } }
h3 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin: 30px 0 12px; font-weight: 700; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-size: 12px; color: var(--faint); font-weight: 700; padding: 0 12px 10px; white-space: nowrap; }
td { padding: 12px; border-top: 1px solid var(--line-2); font-variant-numeric: tabular-nums; vertical-align: middle; }
.num { text-align: right; }
.sub-l { display: block; font-size: 12px; color: var(--faint); }
.tag { display: inline-block; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
.t-ok { background: var(--ok-soft); color: var(--ok); } .t-info { background: var(--info-soft); color: var(--info); } .t-rev { background: var(--fail-soft); color: var(--fail); }
.neg { color: var(--fail); font-weight: 700; }
.btn { font: inherit; font-size: 14px; font-weight: 700; border-radius: 12px; border: 0; padding: 0 16px; min-height: 40px; cursor: pointer; }
.btn-primary { background: var(--ink); color: var(--panel); }
.btn-soft { background: var(--chip); color: var(--ink); }
input, select { font: inherit; font-size: 14px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--ink); min-height: 40px; }
@media (max-width: 760px) {
  .wrap { padding: 16px 16px 48px; }
  .top { flex-wrap: wrap; }
  .card { padding: 18px; border-radius: 18px; }
}

.hero { margin-top: 26px; display: grid; grid-template-columns: 1.45fr 1fr; gap: 20px; }
.status { display: inline-flex; align-items: center; gap: 8px; color: var(--fail); background: var(--fail-soft); font-weight: 700; font-size: 13px; padding: 6px 12px; border-radius: 999px; }
.status i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.big { font-size: 52px; font-weight: 800; letter-spacing: -.03em; line-height: 1.05; margin: 14px 0 6px; }
.lead { color: var(--muted); font-size: 17px; }
.lead b { color: var(--ink); }
.srcs { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
.src { border: 1px solid var(--line); border-radius: 14px; padding: 10px 14px; min-width: 140px; }
.src small { display: block; color: var(--faint); font-size: 12px; font-weight: 600; }
.src b { font-size: 20px; }
.src .bad { color: var(--fail); font-size: 12px; font-weight: 700; margin-left: 4px; }
.donut { display: grid; grid-template-columns: 150px 1fr; gap: 20px; align-items: center; }
.legend div { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.legend div:last-child { border: 0; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 8px; }
.pats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.pat { display: flex; flex-direction: column; }
.ic { width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center; background: var(--soft); color: var(--c); }
.kind { font-weight: 700; color: var(--c); font-size: 13px; margin-top: 14px; }
.delta { font-size: 34px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; }
.pat p { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
.where { margin-top: 14px; display: grid; gap: 6px; }
.where div { display: flex; justify-content: space-between; font-size: 14px; background: var(--bg); border-radius: 10px; padding: 7px 12px; }
.where b { font-variant-numeric: tabular-nums; }
.pat .btn { margin-top: 16px; align-self: flex-start; }
.viz { margin-top: 16px; background: var(--bg); border-radius: 16px; padding: 14px; display: grid; place-items: center; min-height: 170px; }
.viz svg { display: block; max-width: 100%; height: auto; }
.viz .cap { font-size: 12.5px; color: var(--muted); text-align: center; margin-top: 8px; line-height: 1.4; }
.recon { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px; }
.recon .card h4 { margin: 0; font-size: 15px; }
.recon .card .sum { font-size: 28px; font-weight: 800; letter-spacing: -.02em; margin: 2px 0 12px; }
.recon .bar { display: flex; height: 18px; border-radius: 999px; overflow: hidden; background: var(--line); gap: 2px; }
.recon .bar i { display: block; height: 100%; }
.recon .rows { margin-top: 12px; display: grid; gap: 6px; }
.recon .rows div { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; }
.recon .rows span i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 8px; }
.recon .ok { color: var(--ok); font-weight: 700; }
@media (max-width: 860px) { .recon { grid-template-columns: 1fr; } }
.totals td:first-child { font-weight: 600; }
.toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.seg { display: inline-flex; background: var(--chip); border-radius: 12px; padding: 3px; }
.seg button { font: inherit; font-size: 13px; font-weight: 700; border: 0; background: none; color: var(--muted); border-radius: 9px; padding: 0 12px; min-height: 40px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--panel); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.toolbar input { flex: 1; min-width: 200px; }
.count { color: var(--faint); font-size: 13px; margin-left: auto; }
.note { margin-top: 12px; font-size: 13px; color: var(--faint); }
@media (max-width: 860px) {
  .hero, .pats { grid-template-columns: 1fr; }
  .big { font-size: 40px; }
  .donut { grid-template-columns: 120px 1fr; }
  .findings thead { display: none; }
  .findings table, .findings tbody, .findings tr, .findings td { display: block; }
  .findings tr { padding: 10px 0; border-top: 1px solid var(--line-2); display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
  .findings td { border: 0; padding: 0; text-align: left; }
  .findings td[data-l]::before { content: attr(data-l); display: block; font-size: 11px; color: var(--faint); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .totals { display: block; overflow-x: auto; }
}

button { touch-action: manipulation; } button:disabled { opacity: .55; cursor: default; }
[hidden] { display: none !important; } h1,h2,h3 { color: var(--ink); } a { color: var(--brand); }
footer { color: var(--muted); font-size: 12px; margin-top: 24px; }
.pager { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:16px; color:var(--muted); font-size:13px; }
.empty { color:var(--muted); padding:16px 0; } .details { display:block; color:var(--muted); font-size:12px; margin-top:4px; }
.status.passed { color:var(--ok); background:var(--ok-soft); }
.findings td { overflow-wrap:anywhere; } .findings td.num { min-width:120px; }
.totals { padding:0; } .totals td:first-child { min-width:180px; }
@media (max-width:860px) {
  .chip { white-space:normal; } .top-r { flex-wrap:wrap; }
  .totals table,.totals tbody,.totals tr,.totals td { display:block; }
  .totals thead { display:none; } .totals tr { padding:12px 0; }
  .totals td { text-align:left; border:0; padding:5px 0; }
  .totals td[data-l]::before { content:attr(data-l); display:block; font-size:12px; color:var(--muted); }
  .donut { grid-template-columns:1fr; } .findings td.num { min-width:0; }
}
`;

export const brandMark =
  '<span class="mark"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="4" width="12" height="2.4" rx="1.2" fill="var(--mark-a)"/><rect x="2" y="9.6" width="12" height="2.4" rx="1.2" fill="var(--mark-b)"/></svg></span>';
export const themeButton =
  '<button class="theme" id="theme" type="button" aria-label="Switch light or dark theme"></button>';
export const themeScript = `
const root = document.documentElement;
const themeButton = document.getElementById('theme');
const preference = matchMedia('(prefers-color-scheme: dark)');
const sun = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M18 18l1.5 1.5M5 19l1.5-1.5M18 6l1.5-1.5"/></svg>';
const moon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z"/></svg>';
try { const saved = localStorage.getItem('logiparity-theme'); if (saved === 'dark' || saved === 'light') root.dataset.theme = saved; } catch { /* Storage may be unavailable for a local file. */ }
const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : preference.matches;
const paintTheme = () => { themeButton.innerHTML = isDark() ? sun : moon; themeButton.setAttribute('aria-pressed', String(isDark())); };
themeButton.addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('logiparity-theme', root.dataset.theme); } catch { /* The toggle still works without storage. */ }
  paintTheme();
});
preference.addEventListener('change', paintTheme);
paintTheme();
`;
