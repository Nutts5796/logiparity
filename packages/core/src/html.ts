import { DecimalSum, displayDecimal, negateDecimal, sumDecimal } from './aggregates.js';
import { reportHeader, reportHero, findingDonut, findingsSection, reportDocument } from './html-layout.js';
import { redactTree, secretValues } from './diagnostics.js';
import { aggregateDisplay, rawAggregateDisplay, aggregateDifference, aggregateStatus } from './money-display.js';
import { createHash } from 'node:crypto';
import { groupMembership, reportGroups, accountedFindingIndexes } from './groups.js';
import { reportLabels, humanize, uncertainKeyText } from './labels.js';
import { formatMoneyMajor, readableDatetime, displayTimezoneLabel, type ReportPresentation } from './money-display.js';
import { escapeMarkup as escape } from './report-utils.js';
import {
  matchingHeadline,
  humanFinding,
  reportCounts,
  quantity,
  numberText,
  typeLabels,
  patternWords,
} from './human.js';
import { patternCards, kindInfo, icon } from './html-patterns.js';
import { themeScript } from './studio.js';
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
 const cells=[cell('Key',text(row[C.key]))+cell('Source',text(row[C.source]),text(row[C.source]))+cell('Field',text(row[C.field]),text(row[C.field]))+cell('Reference',text(row[C.reference]),'',true)+cell('Source value',text(row[C.sourceValue]),'',true)+cell('Difference',text(row[C.difference]),'',true)];
 const pattern=text(row[C.pattern])||'Needs review';
 cells.push('<td data-l="Cause"><span class="tag '+(row[C.accounted]?'t-info':'t-rev')+'" style="'+(row[C.accounted]?'background:var(--c-'+(pattern==='Page boundary'?'page':pattern==='Timezone'||pattern==='Datetime offset'?'tz':'round')+'-soft)':'')+'">'+escaped(pattern)+'</span>'+(row[C.blocking]?'':'<span class="details">Allowed by failOn</span>')+'</td>');
 cells[0]=cells[0].replace('</td>',(text(row[C.details])?'<span class="details">'+escaped(text(row[C.details]))+'</span>':'')+text(row[C.screenshot])+'</td>');
 return '<tr data-entity="'+escaped(text(row[C.entity]))+'" data-type="'+escaped(text(row[C.type]))+'">'+cells.join('')+'</tr>';
}
function matches(row,index,query){return(card!==null?row[C.cards].includes(card):mode==='all'||!row[C.accounted])&&(!entity.value||text(row[C.entity])===entity.value)&&(!type.value||text(row[C.type])===type.value)&&(!query||searchable[index].includes(query));}
function render(){
 const query=normalize(search.value.trim());
 const selected=rows.filter((row,index)=>matches(row,index,query));
 const pages=Math.max(1,Math.ceil(selected.length/pageSize));page=Math.min(page,pages-1);
 document.querySelector('#findings tbody').innerHTML=selected.slice(page*pageSize,(page+1)*pageSize).map(renderRow).join('');
 document.getElementById('visible-count').hidden=selected.length===0;
 document.getElementById('page-number').hidden=selected.length===0; document.getElementById('previous').hidden=selected.length===0; document.getElementById('next').hidden=selected.length===0;
 document.getElementById('no-matches').textContent=rows.length===0?'No findings. All configured comparisons passed.':mode==='review'&&card===null&&!query&&!entity.value&&!type.value?'Nothing needs individual review. See All ('+rows.length.toLocaleString('en-US')+').':'No matching findings.';
 document.getElementById('visible-count').textContent='Showing '+(selected.length?page*pageSize+1:0)+'–'+Math.min(selected.length,(page+1)*pageSize)+' of '+selected.length.toLocaleString('en-US')+' results';
 document.getElementById('no-matches').hidden=selected.length!==0;
 document.getElementById('previous').disabled=page===0;document.getElementById('next').disabled=page+1>=pages;
 document.getElementById('page-number').textContent='Page '+(page+1)+' of '+pages;
 document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
 document.getElementById('clear-pattern').hidden=card===null;
 document.querySelectorAll('[data-card]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.card)===card)));
 document.getElementById('active-pattern').textContent=card===null?'':DATA.cards[card]+' findings';
}
for(const input of[search,entity,type])input.addEventListener(input===search?'input':'change',()=>{card=null;page=0;render();});
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;card=null;page=0;render();}));
document.querySelectorAll('[data-card]').forEach(button=>button.addEventListener('click',()=>{mode='all';card=Number(button.dataset.card);entity.value='';type.value='';search.value='';page=0;render();document.getElementById('findings-title').scrollIntoView({block:'start'});search.focus({preventScroll:true});}));
document.getElementById('clear-pattern').addEventListener('click',()=>{card=null;page=0;render();});
document.getElementById('previous').addEventListener('click',()=>{page--;render();});document.getElementById('next').addEventListener('click',()=>{page++;render();});render();
`;
const span = (label: string, raw = label) =>
  `<span data-id="${escape(raw)}" title="${escape(label)}">${escape(label)}</span>`;
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
    ['Cause', finding.reason === 'currency_mismatch' ? 'Currency difference' : label || 'Needs review'],
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
              const difference =
                source === entity.reference
                  ? ''
                  : aggregateDifference(aggregate, source, entity.reference, entity.entity, presentation);
              const follows = aggregateStatus(aggregate, source, entity.reference);
              const uncertain = aggregate.uncertainKeys?.[source];
              const raw = rawAggregateDisplay(aggregate, source, entity.entity, presentation);
              const excluded = aggregate.excludedRows?.[source] ?? [];
              return `<td class="num" data-l="${escape(labels.source(entity.entity, source))}">${span(aggregateValue(aggregate, entity, source, presentation))}${raw ? `<span class="sub-l">Raw source: ${escape(raw)}; retained/certain lines above.${excluded.length ? ` Excluded rows: ${excluded.join(', ')}` : ''}</span>` : ''}${difference ? `<span class="sub-l${follows === 'Matches' ? '' : ' neg'}">${escape(difference)}</span>` : ''}${follows && difference && !uncertain?.length ? `<span class="sub-l">${escape(follows)}</span>` : ''}${uncertain?.length ? `<span class="sub-l">Uncertain lines: ${escape(uncertainKeyText(uncertain))}</span>` : ''}</td>`;
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
        Object.entries(aggregate.reconciliationByCurrency ?? aggregate.reconciliation ?? {}).flatMap(
          ([source, value]) => {
            const partitions = aggregate.reconciliationByCurrency
              ? Object.entries(value).map(([currency, parts]) => ({
                  currency,
                  parts: parts as import('./types.js').AggregateReconciliation,
                }))
              : [{ currency: undefined, parts: value as import('./types.js').AggregateReconciliation }];
            return partitions.flatMap(({ currency, parts }) => {
              const actual = currency
                  ? (aggregate.valuesByCurrency?.[source]?.[currency] ?? 0n)
                  : (aggregate.exactValues?.[source] ?? aggregate.values[source]),
                reference = currency
                  ? (aggregate.valuesByCurrency?.[entity.reference]?.[currency] ?? 0n)
                  : (aggregate.exactValues?.[entity.reference] ?? aggregate.values[entity.reference]);
              if (actual === undefined || reference === undefined || actual === reference) return [];
              const definition = labels.entity(entity.entity)?.aggregates.find((item) => item.name === aggregate.name);
              const rule =
                definition?.type === 'sum' ? labels.entity(entity.entity)?.compare[definition.field] : undefined;
              const difference = sumDecimal(actual, negateDecimal(String(reference)));
              const amount = (value: bigint | string) =>
                `${sumDecimal(value) !== '0' && !String(value).startsWith('-') ? '+' : ''}${(currency ?? rule?.currency) ? formatMoneyMajor(BigInt(value), currency ?? rule?.currency ?? 'USD') : displayDecimal(value)}`;
              const buckets = [
                {
                  label: `Missing rows (${numberText(parts.missingRows.count)})`,
                  value: parts.missingRows.amount,
                  color: 'page',
                  show: sumDecimal(parts.missingRows.amount) !== '0',
                },
                ...[
                  { label: 'Extra rows', part: parts.extraRows },
                  { label: 'Value differences', part: parts.valueDifferences },
                ].map(({ label, part }) => ({
                  label: `${label} (${numberText(part?.count ?? 0)})`,
                  value: part?.amount ?? 0n,
                  color: 'round',
                  show: !!part?.count,
                })),
                ...parts.patterns.map((part) => ({
                  label: `${BigInt(report.groups?.[part.group]?.delta ?? 0) >= -3n && BigInt(report.groups?.[part.group]?.delta ?? 0) <= 3n ? 'Rounding' : 'Fixed differences'} (${numberText(part.count)})`,
                  value: part.amount,
                  color: 'round',
                  show: sumDecimal(part.amount) !== '0',
                })),
                {
                  label: `Uncertain lines${parts.uncertain?.keys.length ? ': ' + uncertainKeyText(parts.uncertain.keys) : ''}`,
                  value: parts.uncertain?.amount ?? 0n,
                  color: 'tz',
                  show: !!parts.uncertain?.keys.length,
                },
                { label: 'Unexplained remainder', value: parts.remainder, color: 'review', show: true },
              ].filter((part) => part.show);
              const total = new DecimalSum();
              for (const part of buckets)
                total.add(String(part.value).startsWith('-') ? negateDecimal(part.value) : part.value);
              const accounted = sumDecimal(parts.remainder) === '0' && !parts.uncertain?.keys.length;
              const bars = buckets
                .filter((part) => sumDecimal(part.value) !== '0')
                .map((part) => {
                  const absolute = new DecimalSum();
                  absolute.add(String(part.value).startsWith('-') ? negateDecimal(part.value) : part.value);
                  return `<i style="width:${absolute.percentOf(total)}%;background:var(--c-${part.color})"></i>`;
                })
                .join('');
              const rows = buckets
                .map(
                  (part) =>
                    `<div><span><i style="background:var(--c-${part.color})"></i>${escape(part.label)}</span><b>${escape(amount(part.value))}${part.label === 'Unexplained remainder' && accounted ? ' · accounted for' : ''}</b></div>`,
                )
                .join('');
              return [
                `<article class="card"><h4>${span(labels.field(entity.entity, aggregate.name, true), aggregate.name)}: ${span(labels.source(entity.entity, source), source)} vs ${span(labels.source(entity.entity, entity.reference), entity.reference)}</h4><div class="sum">${escape(amount(difference))}${currency ? ` · ${escape(currency)}` : ''}</div><div class="bar" role="img" aria-label="${escape(buckets.map((part) => `${part.label}: ${amount(part.value)}`).join(', '))}">${bars}</div><div class="rows">${rows}</div></article>`,
              ];
            });
          },
        ),
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
          const textFilter =
            ['string', 'enum'].includes(labels.entity(entity)?.compare[field]?.type ?? 'string') &&
            (Array.isArray(values) ? values : [values]).some(
              (value) => typeof value === 'string' && /\p{L}/u.test(value),
            );
          const choices = (Array.isArray(values) ? values : [values])
            .map((value) =>
              value === null ? '(blank)' : parts.caseSensitive ? JSON.stringify(value) : humanize(String(value)),
            )
            .join(', ');
          return `${labels.field(entity, field)} ${inverse ? 'is not' : 'is'} ${choices}${textFilter ? ` (${parts.caseSensitive ? 'case-sensitive' : 'case-insensitive'})` : ''}`;
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
      return `<article class="card pat" style="--c:var(--c-${info.color});--soft:var(--c-${info.color}-soft)"><div class="ic">${icon(info.path)}</div><div class="kind">${escape(card.label)}</div><div class="delta">${escape(card.headline)}</div><p${card.kind === 'formatting_difference' ? ' style="white-space:pre-wrap"' : ''}>${escape(card.hint)}</p><div class="viz" title="${escape(words?.sentence ?? '')}">${card.chart}</div><p class="next-step"><b>Next step:</b> ${escape(card.nextStep)}</p><button class="btn btn-soft" data-card="${index}" type="button" aria-pressed="false">Show these findings</button></article>`;
    })
    .join('');
  const options = (values: [string, string][]) =>
    values.map(([raw, label]) => `<option value="${escape(raw)}">${escape(label)}</option>`).join('');
  const fallback = report.findings
    .flatMap((finding, index) => (accounted.has(index) ? [] : [finding]))
    .slice(0, 50)
    .map((finding) => findingRow(finding, 'Needs review', presentation))
    .join('');
  const headline = counts.errors
    ? 'Comparison could not complete'
    : !report.findings.length
      ? matchingHeadline(report)
      : !cards.length
        ? `${quantity(review, 'finding')} ${review === 1 ? 'needs' : 'need'} review`
        : `${quantity(cards.length, 'cause')} found`;
  const totalsHtml = totals(report, presentation),
    reconciliation = reconciliationCards(report, presentation);
  const lead = counts.errors
    ? 'Resolve the source errors below and run the comparison again.'
    : cards.length
      ? review
        ? `${quantity(review, 'finding')} ${review === 1 ? 'needs' : 'need'} individual review.`
        : 'Each finding is traced to a cause; each cause still needs a fix.'
      : '';
  const scope = counts.errors ? 'results' : 'findings';
  const donut = counts.findings
    ? findingDonut(Math.floor((accounted.size / report.findings.length) * 100), arcs, [...legend], scope)
    : '';
  const hero = reportHero({
    code,
    headline,
    lead,
    detail: `${counts.errors ? 'Runtime error · ' : ''}${quantity(counts.findings, 'finding')} · ${quantity(counts.errors, 'source error')}`,
    sources: sourceChips(report, presentation),
    donut,
  });
  const warnings = report.warnings?.length
    ? `<h3>Warnings (${numberText(report.warnings.length)})</h3><section class="card"><ul>${report.warnings.map((warning) => `<li>${escape(warning.message)}</li>`).join('')}</ul></section>`
    : '';
  const findings = findingsSection({
    review,
    total: report.findings.length,
    entityOptions: options(
      report.entities.map((entity) => [entity.entity, labels.entity(entity.entity)?.label ?? humanize(entity.entity)]),
    ),
    typeOptions: options(
      (Object.keys(typeLabels) as Finding['type'][])
        .filter((type) => report.findings.some((finding) => finding.type === type))
        .map((type) => [type, typeLabels[type]]),
    ),
    showEntities: report.entities.length > 1,
    fallback,
  });
  const body = `${reportHeader(header)}${hero}
${causeCards ? `<h3>Causes to investigate</h3><section class="pats">${causeCards}</section>` : ''}
${totalsHtml ? `<h3>Totals</h3><section class="card">${totalsHtml}</section>` : ''}
${reconciliation ? `<section class="recon">${reconciliation}</section>` : ''}
${cards.length || reconciliation ? '<p class="details">Accounted for means each difference is traced to a cause above. Each cause still needs a fix.</p>' : ''}${warnings}${findings}`;
  return reportDocument({
    hash,
    body,
    script,
    timezone: displayTimezoneLabel(presentation),
    version: report.schemaVersion,
  });
}
