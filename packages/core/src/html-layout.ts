import { escapeMarkup as escape } from './report-utils.js';
import { numberText } from './human.js';
import { brandMark, studioStyle, themeButton } from './studio.js';
export function reportHeader(header: string): string {
  return `<header class="top"><div class="brand">${brandMark}LogiParity <span class="sub">/ Reconciliation report</span></div>
<div class="top-r"><span class="chip">${escape(header)}</span>${themeButton}</div></header>`;
}
export function findingDonut(
  percent: number,
  arcs: string,
  legend: readonly [string, { count: number; color: string }][],
  scope: string,
): string {
  const rows = legend
    .map(
      ([name, item]) =>
        `<div><span><i style="background:var(--c-${item.color})"></i>${escape(name)}</span><b>${numberText(item.count)}</b></div>`,
    )
    .join('');
  return `<div class="card donut"><svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="${percent}% of ${scope} accounted for">
<circle cx="75" cy="75" r="59" fill="none" stroke="var(--line)" stroke-width="15"/>${arcs}
<text x="75" y="74" text-anchor="middle" font-size="24" font-weight="800" fill="var(--ink)">${percent}%</text>
<text x="75" y="93" text-anchor="middle" font-size="11" fill="var(--muted)">accounted for</text></svg>
<div class="legend">${rows}<p class="details">Share of ${scope} traced to causes. Each total has its own status below.</p></div></div>`;
}
export function reportHero(input: {
  code: number;
  headline: string;
  lead: string;
  detail: string;
  sources: string;
  donut: string;
}): string {
  const status = input.code === 2 ? 'Runtime error' : input.code ? 'Failed' : 'Passed';
  return `<section class="hero${input.donut ? '' : ' clean'}"><div class="card"><span class="status ${input.code ? '' : 'passed'}" title="Exit code ${input.code}">${status}</span>
<h1 class="big">${escape(input.headline)}</h1>${input.lead ? `<div class="lead">${escape(input.lead)}</div>` : ''}
<p class="details">${escape(input.detail)}</p><div class="srcs">${input.sources}</div></div>${input.donut}</section>`;
}
export function findingsSection(input: {
  review: number;
  total: number;
  entityOptions: string;
  typeOptions: string;
  showEntities: boolean;
  fallback: string;
}): string {
  const empty = input.total
    ? 'Nothing needs individual review. See All (' + numberText(input.total) + ').'
    : 'No findings. All configured comparisons passed.';
  return `<h3 id="findings-title" tabindex="-1">Findings</h3><section class="card findings">
<div class="toolbar"${input.total ? '' : ' hidden'}><div class="seg" role="group" aria-label="Finding view">
<button type="button" data-mode="review" aria-pressed="true">Needs review (${numberText(input.review)})</button>
<button type="button" data-mode="all" aria-pressed="false">All (${numberText(input.total)})</button></div>
<input id="search" type="search" placeholder="Search key, source or field" aria-label="Search findings">
<select id="entity-filter" aria-label="Entity"${input.showEntities ? '' : ' hidden'}><option value="">All entities</option>${input.entityOptions}</select>
<select id="type-filter" aria-label="Finding type"><option value="">All finding types</option>${input.typeOptions}</select></div>
<span id="active-pattern" class="details" aria-live="polite"></span><button id="clear-pattern" class="btn btn-soft" type="button" hidden>Clear filter</button>
<table id="findings"><thead><tr><th>Key</th><th>Source</th><th>Field</th><th class="num">Reference</th><th class="num">Source value</th><th class="num">Difference</th><th>Cause</th></tr></thead><tbody>${input.fallback}</tbody></table>
<p id="no-matches" class="empty"${input.review ? ' hidden' : ''}>${empty}</p>
<nav class="pager" aria-label="Finding pages"><span id="visible-count" aria-live="polite"></span><button id="previous" class="btn btn-soft" type="button">Previous</button><span id="page-number"></span><button id="next" class="btn btn-soft" type="button">Next</button></nav>
<noscript>The first 50 results needing review are shown. Enable JavaScript for filters and all pages. JSON contains every result.</noscript></section>`;
}
export function reportDocument(input: {
  hash: string;
  body: string;
  script: string;
  timezone: string;
  version: number;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${input.hash}'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Parity report · LogiParity</title><style>${studioStyle}
.card{min-width:0}.hero.clean{grid-template-columns:1fr}.totals{max-width:100%;min-width:0;overflow-x:auto}
.totals th,.num{white-space:nowrap}.totals .sub-l{white-space:normal;overflow-wrap:anywhere;max-width:32ch;margin-left:auto}
.t-info{background:var(--c-round-soft);color:var(--ink)}.next-step{font-size:12px}.detail-cell{font-size:12px;color:var(--muted)}
@media(max-width:860px){.donut{justify-items:center}.legend{width:100%}}
</style></head><body><main class="wrap">${input.body}
<footer>Generated locally by LogiParity · Report schema v${input.version} · Dates in ${escape(input.timezone)} · Raw values in JSON</footer></main><script>${input.script}</script></body></html>\n`;
}
