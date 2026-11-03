import { redactTree, secretValues } from './diagnostics.js';
import { aggregateDisplay, rawAggregateDisplay } from './money-display.js';
import { createHash } from 'node:crypto';
import { groupMembership, reportGroups, accountedFindingIndexes } from './groups.js';
import { reportLabels, humanize } from './labels.js';
import {
  presentationDifference,
  formatMoneyMajor,
  readableDatetime,
  type ReportPresentation,
} from './money-display.js';
import { escapeMarkup as escape } from './report-utils.js';
import { humanFinding, reportCounts, quantity, numberText, typeLabels, patternWords } from './human.js';
import { patternCards, kindInfo, icon } from './html-patterns.js';
import { brandMark, studioStyle, themeButton, themeScript } from './studio.js';
import { isBlocking } from './policy.js';
import type { Report, Finding, AggregateResult, EntitySummary } from './types.js';
const columns = {
  key: 0,
  source: 1,
  field: 2,
  reference: 3,
  sourceValue: 4,
  difference: 5,
  details: 6,
  pattern: 7,
  type: 8,
  entity: 9,
  rawSource: 10,
  rawField: 11,
  blocking: 12,
  accounted: 13,
  cards: 14,
  screenshot: 15,
};
const clientScript = `
const rows=DATA.rows, strings=DATA.strings, C=DATA.columns;
const text=index=>strings[index]||'';
const escaped=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const normalize=value=>value.toLowerCase().replaceAll('−','-');
const searchable=rows.map(row=>normalize(row.slice(0,12).map(text).join(' ')));
let mode='review',card=null,page=0;
const pageSize=50;
const search=document.getElementById('search'), entity=document.getElementById('entity-filter'), type=document.getElementById('type-filter');
function cell(label,value,raw,numeric=false){return '<td data-l="'+label+'"'+(numeric?' class="num"':'')+'><span title="'+escaped(raw||value)+'">'+escaped(value)+'</span></td>';}
function renderRow(row){
 const cells=[cell('Key',text(row[C.key]))+cell('Source',text(row[C.source]),text(row[C.rawSource]))+cell('Field',text(row[C.field]),text(row[C.rawField]))+cell('Reference',text(row[C.reference]),'',true)+cell('Source value',text(row[C.sourceValue]),'',true)+cell('Difference',text(row[C.difference]),'',true)];
 const pattern=text(row[C.pattern])||'Needs review';
 cells.push('<td data-l="Cause"><span class="tag '+(row[C.accounted]?'t-info':'t-rev')+'">'+escaped(pattern)+'</span>'+(row[C.blocking]?'':'<span class="details">Allowed by failOn</span>')+'</td>');
 cells[0]=cells[0].replace('</td>',(text(row[C.details])?'<span class="details">'+escaped(text(row[C.details]))+'</span>':'')+text(row[C.screenshot])+'</td>');
 return '<tr data-entity="'+escaped(text(row[C.entity]))+'" data-type="'+escaped(text(row[C.type]))+'">'+cells.join('')+'</tr>';
}
function matches(row,index,query){return(card!==null?row[C.cards].includes(card):mode==='all'||!row[C.accounted])&&(!entity.value||text(row[C.entity])===entity.value)&&(!type.value||text(row[C.type])===type.value)&&(!query||searchable[index].includes(query));}
function render(){
 const query=normalize(search.value.trim());
 const selected=rows.filter((row,index)=>matches(row,index,query));
 const pages=Math.max(1,Math.ceil(selected.length/pageSize));page=Math.min(page,pages-1);
 document.querySelector('#findings tbody').innerHTML=selected.slice(page*pageSize,(page+1)*pageSize).map(renderRow).join('');
 document.getElementById('visible-count').textContent='Showing '+(selected.length?page*pageSize+1:0)+'–'+Math.min(selected.length,(page+1)*pageSize)+' of '+selected.length.toLocaleString('en-US')+' results';
 document.getElementById('no-matches').hidden=selected.length!==0;
 document.getElementById('previous').disabled=page===0;document.getElementById('next').disabled=page+1>=pages;
 document.getElementById('page-number').textContent='Page '+(page+1)+' of '+pages;
 document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(card===null&&button.dataset.mode===mode)));
 document.getElementById('active-pattern').textContent=card===null?'':DATA.cards[card]+' findings';
}
for(const input of[search,entity,type])input.addEventListener(input===search?'input':'change',()=>{page=0;render();});
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;card=null;page=0;render();}));
document.querySelectorAll('[data-card]').forEach(button=>button.addEventListener('click',()=>{card=Number(button.dataset.card);entity.value='';type.value='';search.value='';page=0;render();document.getElementById('findings-title').scrollIntoView({block:'start'});search.focus({preventScroll:true});}));
document.getElementById('previous').addEventListener('click',()=>{page--;render();});document.getElementById('next').addEventListener('click',()=>{page++;render();});render();
`;
const span = (label: string, raw = label) => `<span title="${escape(raw)}">${escape(label)}</span>`;
function screenshotLink(path: string | undefined): string {
  if (
    !path ||
    !/^screenshots\//.test(path) ||
    path.includes('\\') ||
    [...path].some((char) => char.charCodeAt(0) < 32 || char === '?' || char === '#') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    !/\.(png|jpe?g|webp)$/i.test(path)
  )
    return '';
  return `<a href="${escape(path.split('/').map(encodeURIComponent).join('/'))}" target="_blank" rel="noopener noreferrer">View screenshot</a>`;
}
function findingRow(finding: Finding, label: string, presentation: ReportPresentation): string {
  const item = humanFinding(finding, presentation);
  const cells = [
    ['Key', item.key],
    ['Source', item.source],
    ['Field', item.field],
    ['Reference', item.reference],
    ['Source value', item.sourceValue],
    ['Difference', item.difference],
    ['Cause', label || 'Needs review'],
  ];
  return `<tr data-entity="${escape(finding.entity)}" data-type="${finding.type}">${cells.map(([name, value]) => `<td data-l="${name}">${escape(value ?? '')}${name === 'Key' && item.details ? `<span class="details">${escape(item.details)}</span>` : ''}${name === 'Key' ? screenshotLink(finding.screenshot) : ''}</td>`).join('')}</tr>`;
}
function sourceNames(entity: EntitySummary, presentation: ReportPresentation): string[] {
  return Object.keys(reportLabels(presentation).entity(entity.entity)?.sources ?? entity.counts);
}
function aggregateValue(
  aggregate: AggregateResult,
  entity: EntitySummary,
  source: string,
  presentation: ReportPresentation,
): string {
  const status = aggregate.sourceStatus?.[source];
  if (status === 'not_mapped' || aggregate.skippedSources.includes(source)) return 'Not mapped';
  if (status === 'not_read' || aggregate.values[source] === undefined) return 'Not read';
  return aggregateDisplay(aggregate, source, entity.entity, presentation);
}
function totals(report: Report, presentation: ReportPresentation): string {
  const labels = reportLabels(presentation);
  return report.entities
    .filter((entity) => entity.aggregates?.length)
    .map((entity) => {
      const sources = sourceNames(entity, presentation);
      const headers = sources
        .map(
          (source) =>
            `<th class="num">${span(labels.source(entity.entity, source), source)}${source === entity.reference ? ' · reference' : ''}</th>`,
        )
        .join('');
      const rows = (entity.aggregates ?? [])
        .map((aggregate) => {
          const values = sources
            .map((source) => {
              const value = aggregate.values[source],
                reference = aggregate.values[entity.reference];
              const difference =
                source !== entity.reference && value !== undefined && reference !== undefined && value !== reference
                  ? presentationDifference(reference, value, entity.entity, aggregate.name, true, presentation)
                  : '';
              const parts = aggregate.reconciliation?.[source];
              const follows =
                parts && BigInt(parts.remainder) === 0n
                  ? `Follows from: ${parts.causes?.join(', ') || 'matching values'}`
                  : '';
              const uncertain = aggregate.uncertainKeys?.[source];
              const raw = rawAggregateDisplay(aggregate, source, entity.entity, presentation);
              const excluded = aggregate.excludedRows?.[source] ?? [];
              return `<td class="num" data-l="${escape(labels.source(entity.entity, source))}">${span(aggregateValue(aggregate, entity, source, presentation))}${raw ? `<span class="sub-l">Raw source: ${escape(raw)}; retained/certain lines above.${excluded.length ? ` Excluded rows: ${excluded.join(', ')}` : ''}</span>` : ''}${difference ? `<span class="sub-l neg">${escape(difference)}</span>` : ''}${follows && difference ? `<span class="sub-l">${escape(follows)}</span>` : ''}${uncertain?.length ? `<span class="sub-l">Uncertain lines: ${escape(uncertain.join(', '))}</span>` : ''}</td>`;
            })
            .join('');
          return `<tr><td>${span(labels.field(entity.entity, aggregate.name, true), aggregate.name)}</td>${values}</tr>`;
        })
        .join('');
      return `<div class="totals"><table><thead><tr><th>${escape(labels.entity(entity.entity)?.label ?? humanize(entity.entity))} totals</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    .join('');
}
function reconciliationCards(report: Report, presentation: ReportPresentation): string {
  const labels = reportLabels(presentation);
  return report.entities
    .flatMap((entity) =>
      (entity.aggregates ?? []).flatMap((aggregate) =>
        Object.entries(aggregate.reconciliation ?? {}).flatMap(([source, parts]) => {
          const actual = aggregate.values[source],
            reference = aggregate.values[entity.reference];
          if (actual === undefined || reference === undefined || actual === reference) return [];
          const definition = labels.entity(entity.entity)?.aggregates.find((item) => item.name === aggregate.name);
          const rule = definition?.type === 'sum' ? labels.entity(entity.entity)?.compare[definition.field] : undefined;
          const difference = BigInt(actual) - BigInt(reference);
          const amount = (value: bigint) =>
            rule?.currency ? formatMoneyMajor(value, rule.currency) : numberText(value);
          const buckets = [
            {
              label: `Missing rows (${numberText(parts.missingRows.count)})`,
              value: BigInt(parts.missingRows.amount),
              color: 'page',
              show: BigInt(parts.missingRows.amount) !== 0n,
            },
            ...[
              { label: 'Extra rows', part: parts.extraRows },
              { label: 'Value differences', part: parts.valueDifferences },
            ].map(({ label, part }) => ({
              label: `${label} (${numberText(part?.count ?? 0)})`,
              value: BigInt(part?.amount ?? 0),
              color: 'round',
              show: !!part?.count,
            })),
            ...parts.patterns.map((part) => ({
              label: `${BigInt(report.groups?.[part.group]?.delta ?? 0) >= -3n && BigInt(report.groups?.[part.group]?.delta ?? 0) <= 3n ? 'Rounding' : 'Fixed differences'} (${numberText(part.count)})`,
              value: BigInt(part.amount),
              color: 'round',
              show: BigInt(part.amount) !== 0n,
            })),
            {
              label: `Uncertain lines${parts.uncertain?.keys.length ? ': ' + parts.uncertain.keys.join(', ') : ''}`,
              value: BigInt(parts.uncertain?.amount ?? 0),
              color: 'review',
              show: !!parts.uncertain?.keys.length,
            },
            { label: 'Unexplained remainder', value: BigInt(parts.remainder), color: 'review', show: true },
          ].filter((part) => part.show);
          const total = buckets.reduce((sum, part) => sum + (part.value < 0n ? -part.value : part.value), 0n);
          const accounted = BigInt(parts.remainder) === 0n;
          const bars = buckets
            .filter((part) => part.value)
            .map(
              (part) =>
                `<i style="width:${total ? Number(((part.value < 0n ? -part.value : part.value) * 10000n) / total) / 100 : 0}%;background:var(--c-${part.color})"></i>`,
            )
            .join('');
          const rows = buckets
            .map(
              (part) =>
                `<div><span><i style="background:var(--c-${part.color})"></i>${escape(part.label)}</span><b>${escape(amount(part.value))}${part.label === 'Unexplained remainder' && accounted ? ' · accounted for' : ''}</b></div>`,
            )
            .join('');
          return [
            `<article class="card"><h4>${span(labels.field(entity.entity, aggregate.name, true), aggregate.name)}: ${span(labels.source(entity.entity, source), source)} vs ${span(labels.source(entity.entity, entity.reference), entity.reference)}</h4><div class="sum">${escape(amount(difference))}</div><div class="bar" role="img" aria-label="${escape(buckets.map((part) => `${part.label}: ${amount(part.value)}`).join(', '))}">${bars}</div><div class="rows">${rows}</div></article>`,
          ];
        }),
      ),
    )
    .join('');
}
function sourceChips(report: Report, presentation: ReportPresentation): string {
  const labels = reportLabels(presentation);
  const describeFilter = (entity: string, filter: EntitySummary['filters']) =>
    Object.values(filter ?? {})
      .flatMap((parts) =>
        [...Object.entries(parts.source), ...Object.entries(parts.rollup)].map(([field, condition]) => {
          const inverse = condition !== null && typeof condition === 'object' && !Array.isArray(condition);
          const values = inverse ? condition.not : condition;
          const choices = (Array.isArray(values) ? values : [values])
            .map((value) =>
              value === null ? '(blank)' : parts.caseSensitive ? JSON.stringify(value) : humanize(String(value)),
            )
            .join(', ');
          return `${labels.field(entity, field)} ${inverse ? 'is not' : 'is'} ${choices} (${parts.caseSensitive ? 'case-sensitive' : 'case-insensitive'})`;
        }),
      )
      .join('; ');
  return report.entities
    .flatMap((entity) =>
      sourceNames(entity, presentation).map((source) => {
        const count = entity.uniqueCounts?.[source] ?? entity.counts[source];
        const reference = entity.uniqueCounts?.[entity.reference] ?? entity.counts[entity.reference];
        const difference = count !== undefined && reference !== undefined ? count - reference : 0;
        const rollup = entity.rollupSources?.includes(source);
        const filter = entity.filters?.[source];
        const value =
          count === undefined
            ? 'Not read'
            : rollup
              ? `${quantity(entity.counts[source] ?? 0, 'line')} → ${quantity(count, count === 1 ? (labels.entity(entity.entity)?.label ?? 'record').toLowerCase() : (entity.pluralLabel ?? 'records'), entity.pluralLabel ?? 'records')}`
              : numberText(count);
        return `<div class="src"><small>${span(labels.source(entity.entity, source), source)}${source === entity.reference ? ' · reference' : ''}</small><b>${escape(value)}</b>${difference && !rollup ? `<span class="bad">${difference > 0 ? '+' : ''}${numberText(difference)} ${Math.abs(difference) === 1 ? 'row' : 'rows'}</span>` : ''}${filter ? `<span class="details">Filter: ${escape(describeFilter(entity.entity, { [source]: filter }))}</span>` : ''}</div>`;
      }),
    )
    .join('');
}
export function htmlReport(report: Report, presentation: ReportPresentation = {}): string {
  const secrets = secretValues(presentation.entities);
  report = redactTree(report, secrets);
  presentation = redactTree(presentation, secrets);
  const labels = reportLabels(presentation),
    groups = reportGroups(report, presentation),
    cards = patternCards(report, presentation),
    members = groupMembership(report, presentation),
    accounted = accountedFindingIndexes(report, presentation),
    counts = reportCounts(report);
  const dictionary: string[] = [],
    lookup = new Map<string, number>();
  const intern = (value: string) => {
    let index = lookup.get(value);
    if (index === undefined) {
      index = dictionary.length;
      lookup.set(value, index);
      dictionary.push(value);
    }
    return index;
  };
  const findingCards = new Map<number, number[]>();
  cards.forEach((card, index) =>
    card.indexes.forEach((finding) => {
      const values = findingCards.get(finding) ?? [];
      values.push(index);
      findingCards.set(finding, values);
    }),
  );
  const rows = report.findings.map((finding, index) => {
    const item = humanFinding(finding, presentation),
      matching = findingCards.get(index) ?? [];
    const card = cards[matching[0] ?? -1];
    const pattern = finding.accounting ? `Follows from: ${finding.accounting.causes.join(', ')}` : (card?.label ?? '');
    return [
      item.key,
      item.source,
      item.field,
      item.reference,
      item.sourceValue,
      item.difference,
      item.details,
      pattern,
      finding.type,
      finding.entity,
      finding.source,
      finding.field,
    ]
      .map(intern)
      .concat([isBlocking(finding) ? 1 : 0, accounted.has(index) ? 1 : 0]) as unknown[];
  });
  rows.forEach((row, index) => {
    row.push(findingCards.get(index) ?? []);
    row.push(intern(screenshotLink(report.findings[index]?.screenshot)));
  });
  const data = { rows, strings: dictionary, columns, cards: cards.map((card) => card.label) };
  const serialized = JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  const script = `(()=>{${themeScript}\nconst DATA=${serialized};\n${clientScript}})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  const code = counts.errors ? 2 : counts.blocking ? 1 : 0;
  const review = report.findings.length - accounted.size;
  const ordinaryAccounted = report.findings.filter(
    (finding, index) => finding.type !== 'source_error' && accounted.has(index),
  ).length;
  const percent = counts.findings ? Math.floor((ordinaryAccounted / counts.findings) * 100) : counts.errors ? 0 : 100;
  const legend = new Map<string, { count: number; color: string }>();
  groups.forEach((group, index) => {
    const words = patternWords(group, presentation),
      kind = kindInfo[group.kind],
      previous = legend.get(words.label)?.count ?? 0;
    legend.set(words.label, { count: previous + (members[index]?.length ?? 0), color: kind.color });
  });
  const following = report.findings.filter((finding) => finding.accounting).length;
  if (following) legend.set('Follows from causes', { count: following, color: 'review' });
  legend.set('Needs review', { count: review, color: 'review' });
  let offset = 0;
  const arcs = [...legend.values()]
    .map((part) => {
      const length = report.findings.length ? (part.count / report.findings.length) * 100 : 0;
      const arc = `<circle cx="75" cy="75" r="59" fill="none" stroke="var(--c-${part.color})" stroke-width="15" pathLength="100" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 75 75)"/>`;
      offset += length;
      return arc;
    })
    .join('');
  const runTime = presentation.generatedAt
    ? readableDatetime(Date.parse(presentation.generatedAt), presentation.displayTimezone)
    : undefined;
  const header = [presentation.environment ?? 'Test & staging only', presentation.configFile, runTime]
    .filter(Boolean)
    .join(' · ');
  const causeCards = cards
    .map((card, index) => {
      const info = kindInfo[card.kind],
        group = groups[card.groups[0] ?? -1],
        words = group ? patternWords(group, presentation) : undefined;
      return `<article class="card pat" style="--c:var(--c-${info.color});--soft:var(--c-${info.color}-soft)"><div class="ic">${icon(info.path)}</div><div class="kind">${escape(card.label)}</div><div class="delta">${escape(card.headline)}</div><p>${escape(card.hint)}</p><div class="viz" title="${escape(words?.sentence ?? '')}">${card.chart}</div><p class="next-step"><b>Next step:</b> ${escape([...new Set(card.groups.map((index) => (groups[index] ? patternWords(groups[index], presentation).nextStep : '')))].join(' ') || 'Review source values.')}</p><button class="btn btn-soft" data-card="${index}" type="button">Show these findings</button></article>`;
    })
    .join('');
  const options = (values: [string, string][]) =>
    values.map(([raw, label]) => `<option value="${escape(raw)}">${escape(label)}</option>`).join('');
  const fallback = report.findings
    .flatMap((finding, index) => (accounted.has(index) ? [] : [finding]))
    .slice(0, 50)
    .map((finding) => findingRow(finding, 'Needs review', presentation))
    .join('');
  const totalsHtml = totals(report, presentation),
    reconciliation = reconciliationCards(report, presentation);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Parity report · LogiParity</title><style>${studioStyle}
 .totals th{white-space:nowrap}.next-step{font-size:12px}.detail-cell{font-size:12px;color:var(--muted)}
 @media(max-width:860px){.donut{justify-items:center}.legend{width:100%}}
 </style></head><body><main class="wrap"><header class="top"><div class="brand">${brandMark}LogiParity <span class="sub">/ Reconciliation report</span></div><div class="top-r"><span class="chip">${escape(header)}</span>${themeButton}</div></header><section class="hero"><div class="card"><span class="status ${code ? '' : 'passed'}" title="Exit code ${code}">${code ? 'Failed' : 'Passed'}</span><h1 class="big">${quantity(cards.length, 'cause')} found</h1><div class="lead">${quantity(review, counts.errors ? 'result' : 'finding')} ${review === 1 ? 'needs' : 'need'} individual review.</div><p class="details">${counts.errors ? 'Runtime error · ' : ''}${quantity(counts.findings, 'finding')} · ${quantity(counts.errors, 'source error')}</p><div class="srcs">${sourceChips(report, presentation)}</div>${!report.findings.length ? '<p>All configured comparisons passed.</p>' : ''}</div><div class="card donut"><svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="${percent}% of findings accounted for"><circle cx="75" cy="75" r="59" fill="none" stroke="var(--line)" stroke-width="15"/>${arcs}<text x="75" y="74" text-anchor="middle" font-size="24" font-weight="800" fill="var(--ink)">${counts.errors && !counts.findings ? 'N/A' : percent + '%'}</text><text x="75" y="93" text-anchor="middle" font-size="11" fill="var(--muted)">accounted for</text></svg><div class="legend">${[...legend].map(([name, item]) => `<div><span><i style="background:var(--c-${item.color})"></i>${escape(name)}</span><b>${numberText(item.count)}</b></div>`).join('')}</div></div></section>${causeCards ? `<h3>Causes to investigate</h3><section class="pats">${causeCards}</section>` : ''}${totalsHtml ? `<h3>Totals</h3><section class="card">${totalsHtml}</section>` : ''}${reconciliation ? `<section class="recon">${reconciliation}</section>` : ''}${cards.length || reconciliation ? '<p class="details">Accounted for means each difference is traced to a cause above. Each cause still needs a fix.</p>' : ''}${report.warnings?.length ? `<h3>Warnings (${numberText(report.warnings.length)})</h3><section class="card"><ul>${report.warnings.map((warning) => `<li>${escape(warning.message)}</li>`).join('')}</ul></section>` : ''}<h3 id="findings-title" tabindex="-1">Findings</h3><section class="card findings"><div class="toolbar"><div class="seg" role="group" aria-label="Finding view"><button type="button" data-mode="review" aria-pressed="true">Needs review (${numberText(review)})</button><button type="button" data-mode="all" aria-pressed="false">All (${numberText(report.findings.length)})</button></div><input id="search" type="search" placeholder="Search key, source or field" aria-label="Search findings"><select id="entity-filter" aria-label="Entity"${report.entities.length <= 1 ? ' hidden' : ''}><option value="">All entities</option>${options(report.entities.map((entity) => [entity.entity, labels.entity(entity.entity)?.label ?? humanize(entity.entity)]))}</select><select id="type-filter" aria-label="Finding type"><option value="">All finding types</option>${options([...new Set(report.findings.map((finding) => finding.type))].map((type) => [type, typeLabels[type]]))}</select></div><span id="active-pattern" class="details" aria-live="polite"></span><table id="findings"><thead><tr><th>Key</th><th>Source</th><th>Field</th><th class="num">Reference</th><th class="num">Source value</th><th class="num">Difference</th><th>Cause</th></tr></thead><tbody>${fallback}</tbody></table><p id="no-matches" class="empty"${review ? ' hidden' : ''}>${report.findings.length ? 'No findings match these filters.' : 'No findings. All configured comparisons passed.'}</p><nav class="pager" aria-label="Finding pages"><span id="visible-count" aria-live="polite"></span><button id="previous" class="btn btn-soft" type="button">Previous</button><span id="page-number"></span><button id="next" class="btn btn-soft" type="button">Next</button></nav><noscript>The first 50 results needing review are shown. Enable JavaScript for filters and all pages. JSON contains every result.</noscript></section><footer>Generated locally by LogiParity · Report schema v${report.schemaVersion} · Dates in ${escape(presentation.displayTimezone ?? 'UTC')} · Raw values in JSON</footer></main><script>${script}</script></body></html>\n`;
}
