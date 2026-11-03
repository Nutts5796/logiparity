import { createHash } from 'node:crypto';
import { groupMembership, reportGroups } from './groups.js';
import { reportLabels, humanize } from './labels.js';
import {
  presentationDifference,
  presentationValue,
  formatMoneyMajor,
  type ReportPresentation,
} from './money-display.js';
import { displayValue, escapeMarkup as escape, verdict } from './report-utils.js';
import { isBlocking } from './policy.js';
import { patternCards, kindInfo, patternKind, icon } from './html-patterns.js';
import { brandMark, studioStyle, themeButton, themeScript } from './studio.js';
import type { Finding, Report } from './types.js';

const filterScript = `
const rows = DATA.rows;
let mode = 'review', card = null, page = 0;
const pageSize = 50;
const search = document.getElementById('search');
const entity = document.getElementById('entity-filter');
const type = document.getElementById('type-filter');
const tbody = document.querySelector('#findings tbody');
function render() {
  const query = search.value.trim().toLowerCase();
  const matches = rows.filter(row => (card !== null ? row.cards.includes(card) : mode === 'all' || !row.explained) && (!entity.value || row.entity === entity.value) && (!type.value || row.type === type.value) && (!query || row.search.includes(query)));
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  page = Math.min(page, pages - 1);
  tbody.innerHTML = matches.slice(page * pageSize, (page + 1) * pageSize).map(row => row.html).join('');
  document.getElementById('visible-count').textContent = 'Showing ' + (matches.length ? page * pageSize + 1 : 0) + '–' + Math.min(matches.length, (page + 1) * pageSize) + ' of ' + matches.length.toLocaleString('en-US') + ' findings';
  document.getElementById('no-matches').hidden = matches.length !== 0;
  document.getElementById('previous').disabled = page === 0;
  document.getElementById('next').disabled = page + 1 >= pages;
  document.getElementById('page-number').textContent = 'Page ' + (page + 1) + ' of ' + pages;
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(card === null && button.dataset.mode === mode)));
  document.getElementById('active-pattern').textContent = card === null ? '' : DATA.cards[card] + ' findings';
}
for (const input of [search, entity, type]) input.addEventListener(input === search ? 'input' : 'change', () => { page = 0; render(); });
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; card = null; page = 0; render(); }));
document.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', () => { card = Number(button.dataset.card); entity.value = ''; type.value = ''; search.value = ''; page = 0; render(); document.getElementById('findings-title').scrollIntoView({block:'start'}); search.focus({preventScroll:true}); }));
document.getElementById('previous').addEventListener('click', () => { page--; render(); });
document.getElementById('next').addEventListener('click', () => { page++; render(); });
render();
`;
const fmt = (value: number) => value.toLocaleString('en-US');
const labelSpan = (label: string, raw: string) => `<span title="${escape(raw)}">${escape(label)}</span>`;

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
function findingRow(f: Finding, pattern: string | undefined, presentation: ReportPresentation): string {
  const labels = reportLabels(presentation);
  const aggregate = f.type === 'aggregate_mismatch';
  const value = (side: 'expected' | 'actual') => {
    if (f.type === 'missing_in_source') return side === 'expected' ? 'Present' : 'Missing';
    if (f.type === 'extra_in_source') return side === 'expected' ? 'Absent' : 'Present';
    return labelSpan(presentationValue(f[side], f.entity, f.field, aggregate, presentation), displayValue(f[side]));
  };
  const observed = f.values
    ?.map((item) => `Line ${item.line}: ${presentationValue(item.value, f.entity, f.field, false, presentation)}`)
    .join(' · ');
  const detail = [observed, f.type === 'source_error' || f.reason || f.type === 'duplicate_key' ? f.message : undefined]
    .filter(Boolean)
    .join(' ');
  return `<tr title="${escape(f.message)}" data-entity="${escape(f.entity)}" data-type="${f.type}"><td data-l="Key">${f.key ? `<code>${escape(f.key)}</code>` : labelSpan(aggregate ? labels.all(f.entity) : 'Source', f.entity)}${detail ? `<span class="details">${escape(detail)}</span>` : ''}${screenshotLink(f.screenshot)}</td><td data-l="Source">${labelSpan(labels.source(f.entity, f.source), f.source)}</td><td data-l="Field">${labelSpan(labels.field(f.entity, f.field, aggregate), f.field || 'Whole row')}</td><td class="num" data-l="Reference">${value('expected')}</td><td class="num" data-l="Source value">${value('actual')}</td><td class="num neg" data-l="Difference">${escape(presentationDifference(f.expected, f.actual, f.entity, f.field, aggregate, presentation))}</td><td data-l="Pattern"><span class="tag ${pattern ? 't-info' : 't-rev'}">${escape(pattern ?? 'Needs review')}</span>${!isBlocking(f) ? '<span class="details">Allowed by failOn</span>' : ''}</td></tr>`;
}

function totals(report: Report, presentation: ReportPresentation): string {
  const labels = reportLabels(presentation);
  return report.entities
    .map((entity) => {
      const sources = Object.keys(entity.counts);
      return `<div class="totals"><table><thead><tr><th>${labelSpan(labels.entity(entity.entity)?.label ?? humanize(entity.entity), entity.entity)} totals</th>${sources.map((source) => `<th class="num">${labelSpan(labels.source(entity.entity, source), source)}${source === entity.reference ? '<span class="sub-l">Reference</span>' : ''}</th>`).join('')}</tr></thead><tbody>${(
        entity.aggregates ?? []
      )
        .map(
          (aggregate) =>
            `<tr><td>${labelSpan(labels.field(entity.entity, aggregate.name, true), aggregate.name)}</td>${sources
              .map((source) => {
                const value = aggregate.values[source];
                const difference =
                  source === entity.reference || value === undefined
                    ? ''
                    : presentationDifference(
                        aggregate.values[entity.reference],
                        value,
                        entity.entity,
                        aggregate.name,
                        true,
                        presentation,
                      );
                return `<td class="num" data-l="${escape(labels.source(entity.entity, source))}">${labelSpan(presentationValue(value, entity.entity, aggregate.name, true, presentation), displayValue(value))}${difference ? `<span class="sub-l neg">${escape(difference)}</span>` : ''}${aggregate.skippedSources.includes(source) ? '<span class="sub-l">Skipped: incomplete or ambiguous input</span>' : ''}</td>`;
              })
              .join('')}</tr>`,
        )
        .join('')}</tbody></table></div>`;
    })
    .join('');
}
function reconciliationCards(report: Report, presentation: ReportPresentation): string {
  const labels = reportLabels(presentation);
  return report.entities
    .flatMap((entity) =>
      (entity.aggregates ?? []).flatMap((aggregate) =>
        Object.entries(aggregate.reconciliation ?? {}).flatMap(([source, reconciliation]) => {
          const definition = labels.entity(entity.entity)?.aggregates.find((item) => item.name === aggregate.name);
          const rule = definition?.type === 'sum' ? labels.entity(entity.entity)?.compare[definition.field] : undefined;
          if (
            rule?.type !== 'money' ||
            aggregate.values[source] === undefined ||
            aggregate.values[entity.reference] === undefined
          )
            return [];
          const difference = BigInt(aggregate.values[source]!) - BigInt(aggregate.values[entity.reference]!);
          if (!difference) return [];
          const parts = [
            {
              label: `Missing rows (${reconciliation.missingRows.count})`,
              amount: BigInt(reconciliation.missingRows.amount),
              color: 'page',
            },
            ...reconciliation.patterns.map((part) => ({
              label: `${BigInt(report.groups?.[part.group]?.delta ?? 0) >= -3n && BigInt(report.groups?.[part.group]?.delta ?? 0) <= 3n ? 'Rounding' : 'Fixed difference'} (${part.count})`,
              amount: BigInt(part.amount),
              color: 'round',
            })),
            { label: 'Unexplained remainder', amount: BigInt(reconciliation.remainder), color: 'review' },
          ];
          const total = parts.reduce((sum, part) => sum + (part.amount < 0n ? -part.amount : part.amount), 0n);
          const money = (amount: bigint) => formatMoneyMajor(amount, rule.currency!);
          const bars = parts
            .filter((part) => part.amount)
            .map(
              (part) =>
                `<i style="width:${total ? Number(((part.amount < 0n ? -part.amount : part.amount) * 10000n) / total) / 100 : 0}%;background:var(--c-${part.color})"></i>`,
            )
            .join('');
          return [
            `<article class="card"><h4>${labelSpan(labels.field(entity.entity, aggregate.name, true), aggregate.name)}: ${labelSpan(labels.source(entity.entity, source), source)} vs ${labelSpan(labels.source(entity.entity, entity.reference), entity.reference)}</h4><div class="sum" title="${difference}">${escape(money(difference))}</div><div class="bar" role="img" aria-label="${escape(parts.map((part) => `${part.label}: ${money(part.amount)}`).join(', '))}">${bars}</div><div class="rows">${parts.map((part) => `<div><span><i style="background:var(--c-${part.color})"></i>${escape(part.label)}</span><b title="${part.amount}"${part.label === 'Unexplained remainder' && !part.amount ? ' class="ok"' : ''}>${escape(money(part.amount))}${part.label === 'Unexplained remainder' && !part.amount ? ' · fully explained' : ''}</b></div>`).join('')}</div></article>`,
          ];
        }),
      ),
    )
    .join('');
}

export function htmlReport(report: Report, presentation: ReportPresentation = {}): string {
  const labels = reportLabels(presentation);
  const groups = reportGroups(report, presentation);
  const cards = patternCards(report, presentation);
  const memberships = groupMembership(report, presentation);
  const covered = new Set(memberships.flat());
  const explained = covered.size;
  const review = report.findings.length - explained;
  const data = {
    cards: cards.map((card) => card.label),
    rows: report.findings.map((finding, index) => {
      const matching = cards.flatMap((card, cardIndex) => (card.indexes.includes(index) ? [cardIndex] : []));
      const pattern = matching.length ? cards[matching[0]!]!.label : undefined;
      return {
        entity: finding.entity,
        type: finding.type,
        cards: matching,
        explained: covered.has(index),
        html: findingRow(finding, pattern, presentation),
        search: [
          finding.key,
          finding.source,
          finding.field,
          finding.entity,
          labels.all(finding.entity),
          labels.source(finding.entity, finding.source),
          labels.field(finding.entity, finding.field, finding.type === 'aggregate_mismatch'),
          presentationValue(
            finding.expected,
            finding.entity,
            finding.field,
            finding.type === 'aggregate_mismatch',
            presentation,
          ),
          presentationValue(
            finding.actual,
            finding.entity,
            finding.field,
            finding.type === 'aggregate_mismatch',
            presentation,
          ),
          finding.message,
        ]
          .join(' ')
          .toLowerCase(),
      };
    }),
  };
  // Escape script delimiters before hashing. Every table cell is escaped before it reaches innerHTML.
  const serialized = JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  const script = `(() => {${themeScript}\nconst DATA = ${serialized};\n${filterScript}})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  const code = report.findings.some((finding) => finding.type === 'source_error')
    ? 2
    : report.findings.some(isBlocking)
      ? 1
      : 0;
  const percent = report.findings.length ? Math.floor((explained / report.findings.length) * 100) : 100;
  const counts = new Map<string, { count: number; color: string }>();
  groups.forEach((group, index) => {
    const kind = patternKind(group);
    const old = counts.get(kind.label);
    counts.set(kind.label, { count: (old?.count ?? 0) + memberships[index]!.length, color: kind.color });
  });
  counts.set('Needs review', { count: review, color: 'review' });
  let offset = 0;
  const segments = [...counts.values()]
    .map(({ count, color }) => {
      const length = report.findings.length ? (count / report.findings.length) * 100 : 0;
      const part = `<circle cx="75" cy="75" r="59" fill="none" stroke="var(--c-${color})" stroke-width="15" pathLength="100" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 75 75)"/>`;
      offset += length;
      return part;
    })
    .join('');
  const sources = report.entities
    .flatMap((entity) =>
      Object.entries(entity.counts).map(([source, count]) => {
        const difference = count - (entity.counts[entity.reference] ?? 0);
        return `<div class="src"><small>${labelSpan(labels.source(entity.entity, source), source)}${source === entity.reference ? ' · reference' : ''}</small><b>${fmt(count)}</b>${source !== entity.reference ? `<span class="bad">${difference > 0 ? '+' : ''}${fmt(difference)} rows</span>` : ''}</div>`;
      }),
    )
    .join('');
  const aggregates = report.entities.some((entity) => entity.aggregates?.length);
  const options = (items: [string, string][]) =>
    items.map(([raw, label]) => `<option value="${escape(raw)}">${escape(label)}</option>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Parity report · LogiParity</title><style>${studioStyle}</style></head><body><main class="wrap">
<header class="top"><div class="brand">${brandMark}LogiParity <span class="sub">/ Parity report</span></div><div class="top-r"><span class="chip">${escape([presentation.environment ?? 'Test & staging only', presentation.configFile, presentation.generatedAt].filter(Boolean).join(' · '))}</span>${themeButton}</div></header>
<section class="hero"><div class="card"><div class="status ${code ? '' : 'passed'}"><i></i>${verdict(report)} · exit code ${code}</div><h1 class="big">${fmt(report.findings.length)} findings</h1><div class="lead"><b>${cards.length} patterns explain ${fmt(explained)} of them.</b> Only ${fmt(review)} need individual review.</div><div class="srcs">${sources}</div>${!report.findings.length ? '<p>All configured comparisons passed.</p>' : ''}</div><div class="card donut"><svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="${percent}% of findings explained by patterns"><circle cx="75" cy="75" r="59" fill="none" stroke="var(--line)" stroke-width="15"/>${segments}<text x="75" y="74" text-anchor="middle" font-weight="800" font-size="24" fill="var(--ink)">${percent}%</text><text x="75" y="93" text-anchor="middle" font-size="11" fill="var(--muted)">explained</text></svg><div class="legend">${[...counts].map(([name, value]) => `<div><span><i style="background:var(--c-${value.color})"></i>${escape(name)}</span><b>${fmt(value.count)}</b></div>`).join('')}</div></div></section>
${
  cards.length
    ? `<h3>Patterns to investigate</h3><section class="pats">${cards
        .map((card, index) => {
          const kind = kindInfo[card.kind];
          return `<article class="card pat" style="--c:var(--c-${kind.color});--soft:var(--c-${kind.color}-soft)"><div class="ic">${icon(kind.path)}</div><div class="kind">${escape(card.label)}</div><div class="delta">${escape(card.headline)}</div><p>${escape(card.hint)}</p><div class="viz" title="${escape(
            card.groups
              .map((index) => {
                const group = groups[index]!;
                return `${group.source}.${group.field || 'whole row'}${group.delta ? ` delta=${group.delta}` : ''}`;
              })
              .join('; '),
          )}">${card.chart}</div><button class="btn btn-soft" data-card="${index}" type="button">Show these findings</button></article>`;
        })
        .join('')}</section>`
    : ''
}
${aggregates ? `<h3>Totals</h3><section class="card">${totals(report, presentation)}</section><section class="recon">${reconciliationCards(report, presentation)}</section>` : ''}
${report.warnings?.length ? `<h3>Warnings (${report.warnings.length})</h3><section class="card"><ul>${report.warnings.map((warning) => `<li>${escape(warning.message)}</li>`).join('')}</ul></section>` : ''}
<h3 id="findings-title" tabindex="-1">Findings</h3><section class="card findings"><div class="toolbar"><div class="seg" role="group" aria-label="Finding view"><button type="button" data-mode="review" aria-pressed="true">Needs review (${fmt(review)})</button><button type="button" data-mode="all" aria-pressed="false">All (${fmt(report.findings.length)})</button></div><input id="search" type="search" placeholder="Search key, source or field" aria-label="Search findings"><select id="entity-filter" aria-label="Entity"><option value="">All entities</option>${options(report.entities.map((entity) => [entity.entity, labels.entity(entity.entity)?.label ?? humanize(entity.entity)]))}</select><select id="type-filter" aria-label="Finding type"><option value="">All finding types</option>${options([...new Set(report.findings.map((finding) => finding.type))].map((type) => [type, humanize(type)]))}</select></div><span id="active-pattern" class="details" aria-live="polite"></span><table id="findings"><thead><tr><th>Key</th><th>Source</th><th>Field</th><th class="num">Reference</th><th class="num">Source value</th><th class="num">Difference</th><th>Pattern</th></tr></thead><tbody>${data.rows
    .filter((row) => !row.explained)
    .slice(0, 50)
    .map((row) => row.html)
    .join(
      '',
    )}</tbody></table><p id="no-matches" class="empty"${review ? ' hidden' : ''}>${report.findings.length ? 'No findings match these filters.' : 'No findings. All configured comparisons passed.'}</p><nav class="pager" aria-label="Finding pages"><span id="visible-count" aria-live="polite"></span><button id="previous" class="btn btn-soft" type="button">Previous</button><span id="page-number"></span><button id="next" class="btn btn-soft" type="button">Next</button></nav><noscript>The first 50 findings needing review are shown. Enable JavaScript for filters and all pages; JSON contains every finding.</noscript></section><footer>Generated locally by LogiParity · Report schema v${report.schemaVersion} · Money in configured currencies · Dates in UTC · Raw values in tooltips and JSON</footer></main><script>${script}</script></body></html>\n`;
}
