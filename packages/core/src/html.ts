import { createHash } from 'node:crypto';
import { reportGroups } from './groups.js';
import { isBlocking } from './policy.js';
import { entityNames, escapeMarkup as escape, findingTypes, verdict } from './report-utils.js';
import { presentationValue, type ReportPresentation } from './money-display.js';
import type { Finding, Report } from './types.js';

const filterScript = `(() => {
  const entity = document.getElementById('entity-filter');
  const type = document.getElementById('type-filter');
  const search = document.getElementById('search');
  const rows = Array.from(document.querySelectorAll('#findings tbody tr[data-entity]'));
  const count = document.getElementById('visible-count');
  const empty = document.getElementById('no-matches');
  function filter() {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      row.hidden = (entity.value !== '' && row.dataset.entity !== entity.value) || (type.value !== '' && row.dataset.type !== type.value) || (query !== '' && !row.textContent.toLowerCase().includes(query));
      if (!row.hidden) visible++;
    }
    count.textContent = 'Showing ' + visible + ' of ' + rows.length + ' findings';
    empty.hidden = visible !== 0 || rows.length === 0;
  }
  entity.addEventListener('change', filter);
  type.addEventListener('change', filter);
  search.addEventListener('input', filter);
  filter();
})();`;

function screenshotLink(path: string | undefined): string {
  if (!path || !/^screenshots\//.test(path) || path.includes('\\') || [...path].some((char) => char.charCodeAt(0) < 32 || char === '?' || char === '#') || path.split('/').some((part) => !part || part === '.' || part === '..') || !/\.(png|jpe?g|webp)$/i.test(path)) return '';
  return `<a href="${escape(path.split('/').map(encodeURIComponent).join('/'))}" target="_blank" rel="noopener noreferrer">View screenshot</a>`;
}

function findingRow(f: Finding, presentation: ReportPresentation): string {
  return `<tr data-entity="${escape(f.entity)}" data-type="${f.type}"><td><strong>${escape(f.entity)}</strong><small>${escape(f.source)}</small></td><td class="mono">${escape(f.key || '—')}</td><td>${escape(f.field || '—')}</td><td><span class="tag">${f.type.replaceAll('_', ' ')}</span><small>${isBlocking(f) ? 'Blocking' : 'Allowed by failOn'}</small></td><td class="mono">${escape(presentationValue(f.expected, f.entity, f.field, f.type === 'aggregate_mismatch', presentation))}</td><td class="mono">${escape(presentationValue(f.actual, f.entity, f.field, f.type === 'aggregate_mismatch', presentation))}</td><td class="explanation">${escape(f.message)}${screenshotLink(f.screenshot) ? `<small>${screenshotLink(f.screenshot)}</small>` : ''}</td></tr>`;
}

export function htmlReport(report: Report, presentation: ReportPresentation = {}): string {
  const groups = reportGroups(report, presentation);
  const countRows = findingTypes.map((type) => { const found = report.findings.filter((f) => f.type === type); return `<tr><td>${type}</td><td>${found.length}</td><td>${found.filter(isBlocking).length}</td></tr>`; }).join('');
  const status = verdict(report);
  const blocking = report.findings.filter(isBlocking).length;
  const hash = createHash('sha256').update(filterScript).digest('base64');
  const options = (values: readonly string[]) => values.map((value) => `<option value="${escape(value)}">${escape(value.replaceAll('_', ' '))}</option>`).join('');
  const aggregateRows = report.entities.flatMap((e) => (e.aggregates ?? []).map((a) => `<tr><td><strong>${escape(e.entity)}</strong></td><td>${escape(a.name)}<small>${a.type}</small></td><td class="mono">${Object.entries(a.values).map(([source, value]) => `${escape(source)}: ${escape(presentationValue(value, e.entity, a.name, true, presentation))}`).join(' · ')}</td><td>${escape(a.skippedSources.join(', ') || '—')}</td></tr>`));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>LogiParity · Parity report</title>
<style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172f2a;background:#f4f6f2;color-scheme:light;line-height:1.5}*{box-sizing:border-box}body{margin:0}main{max-width:1600px;margin:auto;padding:38px 40px 56px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid #d8e1d8;padding-bottom:22px}.brand{font-size:20px;font-weight:750;letter-spacing:-.6px}.brand b{color:#087552}.safety{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#50635c}.eyebrow{margin:35px 0 8px;color:#557067;font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.13em}h1{font-size:42px;letter-spacing:-1.8px;line-height:1.15;margin:0 0 12px}h2{font-size:19px;letter-spacing:-.4px;margin:0}.intro{margin:0;color:#52675d;max-width:850px}.cards{display:grid;grid-template-columns:1.5fr repeat(3,1fr);gap:14px;margin:28px 0 30px}.card{background:white;border:1px solid #d9e2d9;border-radius:12px;padding:20px 24px}.card.status{background:${blocking ? '#fff0e9' : '#e7f3e8'};border-color:${blocking ? '#edc6b5' : '#c0dcc3'}}.label{color:#5d7067;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.number{display:block;font-size:32px;letter-spacing:-1px;line-height:1.25;margin-top:8px}.status .number{font-size:25px;letter-spacing:-.6px}.section{background:white;border:1px solid #d9e2d9;border-radius:12px;margin-top:24px;overflow:hidden}.section-head{padding:22px 24px 16px;display:flex;justify-content:space-between;align-items:center;gap:16px}.muted{color:#5a6c63;font-size:13px}.filters{display:flex;align-items:end;gap:14px;padding:0 24px 22px;flex-wrap:wrap}.filter-field{display:flex;flex-direction:column;gap:6px}label{font-size:12px;font-weight:600;color:#53695e;display:flex;flex-direction:column;gap:6px}select,input{font:inherit;font-size:14px;background:#fff;border:1px solid #cbd8ce;border-radius:6px;padding:9px 12px;min-width:210px;color:#173c2c}input{min-width:280px}select:focus,input:focus{outline:2px solid #087552;outline-offset:2px}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}#findings{min-width:1080px}thead{background:#f6f8f4}th{padding:12px 16px;color:#587064;font-size:11px;text-transform:uppercase;letter-spacing:.07em;font-weight:650;border-block:1px solid #e1e8df}td{padding:17px 16px;border-bottom:1px solid #e5ebe2;vertical-align:top;overflow-wrap:anywhere}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#f8faf5}tr[hidden]{display:none}small{display:block;margin-top:5px;color:#64766d;font-size:11px}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.tag{display:inline-block;color:#3b594d;background:#edf2ea;border:1px solid #dce6d7;border-radius:4px;padding:3px 7px;white-space:nowrap;font-size:11px}.explanation{min-width:260px;max-width:460px}.empty{padding:28px 24px;color:#53695e}.empty[hidden]{display:none}a{color:#076843}footer{display:flex;justify-content:space-between;gap:20px;margin-top:25px;font-size:12px;color:#5a6c63}noscript{display:block;padding:12px 24px;color:#6d4d24}@media(max-width:760px){main{padding:22px 16px 36px}h1{font-size:34px}.cards{grid-template-columns:repeat(2,1fr)}.card{padding:16px}.safety{max-width:150px;text-align:right}input,select{min-width:0;width:100%}.filter-field{flex:1 1 180px}.filters{padding-inline:16px}.section-head{padding-inline:16px;align-items:start;flex-direction:column}footer{flex-direction:column;gap:5px}}
</style></head><body><main>
<header><div class="brand">Logi<b>Parity</b></div><div class="safety">Test &amp; staging only</div></header>
<p class="eyebrow">Data consistency / Parity</p><h1>Parity report</h1><p class="intro">Compare the same records across configured sources. Review missing records, field differences and aggregate results below.</p>
<div class="cards"><div class="card status"><span class="label">Check result</span><strong class="number">${status}</strong></div><div class="card"><span class="label">Findings</span><strong class="number">${report.findings.length}</strong></div><div class="card"><span class="label">Blocking</span><strong class="number">${blocking}</strong></div><div class="card"><span class="label">Entities</span><strong class="number">${report.entities.length}</strong></div></div>
${groups.length ? `<section class="section" aria-labelledby="groups-title"><div class="section-head"><h2 id="groups-title">Patterns to investigate</h2></div><ul>${groups.map((g) => `<li><strong>${escape(g.entity)}</strong>: ${escape(g.summary)}</li>`).join('')}</ul></section>` : ''}
<section class="section" aria-labelledby="counts-title"><div class="section-head"><h2 id="counts-title">Finding counts</h2></div><div class="scroll"><table id="finding-counts"><thead><tr><th>Finding type</th><th>Total</th><th>Blocking</th></tr></thead><tbody>${countRows}</tbody></table></div></section>
<section class="section" aria-labelledby="findings-title"><div class="section-head"><h2 id="findings-title">Findings</h2><span class="muted" id="visible-count" aria-live="polite">Showing ${report.findings.length} of ${report.findings.length} findings</span></div>
<div class="filters"><div class="filter-field"><label for="entity-filter">Entity</label><select id="entity-filter"><option value="">All entities</option>${options(entityNames(report))}</select></div><div class="filter-field"><label for="type-filter">Finding type</label><select id="type-filter"><option value="">All finding types</option>${options(findingTypes)}</select></div><div class="filter-field"><label for="search">Search records</label><input id="search" type="search" placeholder="Key, source or explanation"></div></div>
<noscript>All findings are shown. Enable JavaScript to use filters.</noscript><div class="scroll"><table id="findings"><thead><tr><th>Entity / source</th><th>Record key</th><th>Field</th><th>Finding</th><th>Expected</th><th>Actual</th><th>Explanation</th></tr></thead><tbody>${report.findings.map((f) => findingRow(f, presentation)).join('\n')}</tbody></table></div>
${report.findings.length ? '' : '<p class="empty">No findings. All configured comparisons passed.</p>'}<p class="empty" id="no-matches" hidden>No findings match these filters.</p></section>
${aggregateRows.length ? `<section class="section" aria-labelledby="aggregate-title"><div class="section-head"><h2 id="aggregate-title">Aggregates</h2><span class="muted">Normalized values by source</span></div><div class="scroll"><table><thead><tr><th>Entity</th><th>Aggregate</th><th>Values by source</th><th>Skipped sources</th></tr></thead><tbody>${aggregateRows.join('\n')}</tbody></table></div></section>` : ''}
<footer><span>Money: minor units + configured currency equivalent · Dates: epoch milliseconds + ISO 8601 UTC</span><span>Generated locally by LogiParity · Report schema v${report.schemaVersion}</span></footer>
</main><script>${filterScript}</script></body></html>\n`;
}
