import { patternWords, mergedPatternWords } from './human.js';
import { groupMembership, reportGroups } from './groups.js';
import { reportLabels, presentationRule, ordinal } from './labels.js';
import {
  durationPhrase,
  durationValue,
  formatMoneyMajor,
  readableDatetime,
  type ReportPresentation,
} from './money-display.js';
import { escapeMarkup as escape } from './report-utils.js';
import type { FindingGroup, Report } from './types.js';

export const kindInfo = {
  missing_stride: {
    label: 'Page boundary',
    color: 'page',
    path: '<rect x="4" y="3" width="13" height="16" rx="2"/><path d="M8 21h11a2 2 0 0 0 2-2V7M8 8h5M8 12h5"/>',
  },
  extra_stride: {
    label: 'Page boundary',
    color: 'page',
    path: '<rect x="4" y="3" width="13" height="16" rx="2"/><path d="M8 8h5M8 12h5M8 16h5"/>',
  },
  datetime_offset: { label: 'Timezone', color: 'tz', path: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>' },
  money_delta: {
    label: 'Rounding',
    color: 'round',
    path: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 14h4"/>',
  },
  value_mapping: { label: 'Value mapping', color: 'tz', path: '<path d="M4 7h16l-4-4M20 17H4l4 4"/>' },
} as const;
export function patternKind(group: FindingGroup) {
  const info = kindInfo[group.kind];
  if (group.kind === 'datetime_offset' && group.cause !== 'timezone') return { ...info, label: 'Datetime offset' };
  if (group.kind.endsWith('_stride') && group.cause !== 'pagination')
    return { ...info, label: 'Repeated missing rows' };
  return group.kind === 'money_delta' && group.delta && (BigInt(group.delta) < -3n || BigInt(group.delta) > 3n)
    ? { ...info, label: 'Fixed difference' }
    : info;
}
export const icon = (path: string) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
export interface PatternCard {
  groups: number[];
  indexes: number[];
  kind: FindingGroup['kind'];
  label: string;
  headline: string;
  hint: string;
  nextStep: string;
  chart: string;
}
const fmt = (value: number) => value.toLocaleString('en-US');
const svg = (width: number, height: number, label: string, contents: string) =>
  `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)}">${contents}</svg>`;
const caption = (text: string) => `<div class="cap">${escape(text)}</div>`;

export function patternCards(report: Report, presentation: ReportPresentation): PatternCard[] {
  const groups = reportGroups(report, presentation);
  const memberships = groupMembership(report, presentation);
  const labels = reportLabels(presentation);
  const cards = new Map<string, PatternCard>();
  groups.forEach((group, index) => {
    const rule = presentationRule(labels.entity(group.entity), group.field, false);
    const key = JSON.stringify(
      [
        group.entity,
        group.kind,
        group.field,
        group.delta,
        group.stride,
        group.cause,
        group.currency ?? rule?.currency,
        group.kind === 'value_mapping' ? [group.expected, group.actual] : [],
      ],
      (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value),
    );
    let card = cards.get(key);
    if (!card) {
      const delta = BigInt(group.delta ?? 0);
      card = {
        groups: [],
        indexes: [],
        kind: group.kind,
        label: patternKind(group).label,
        chart: '',
        headline: group.kind.endsWith('_stride')
          ? `Every ${ordinal(group.stride ?? 0)} row`
          : group.kind === 'datetime_offset'
            ? durationPhrase(delta)
            : group.kind === 'money_delta' && rule?.currency
              ? `${delta > 0n ? '+' : ''}${formatMoneyMajor(delta, group.currency ?? rule.currency)}`.replace('-', '−')
              : 'Consistent mapping',
        hint: patternWords(group, presentation).hint,
        nextStep: patternWords(group, presentation).nextStep,
      };
      cards.set(key, card);
    }
    card.groups.push(index);
    for (const member of memberships[index] ?? []) card.indexes.push(member);
  });
  for (const card of cards.values()) {
    const first = groups[card.groups[0]!]!;
    const words = mergedPatternWords(
      card.groups.flatMap((index) => (groups[index] ? [groups[index]] : [])),
      presentation,
    )[0];
    if (words) {
      card.hint = `${words.sentence} ${words.hint}`;
      card.nextStep = words.nextStep;
    }
    const summary = report.entities.find((entity) => entity.entity === first.entity);
    const reference = summary?.reference ?? '';
    const sources = [...new Set(card.groups.map((index) => labels.source(first.entity, groups[index]!.source)))].join(
      ' and ',
    );
    const members = memberships[card.groups[0]!]!;
    const rows = summary?.counts[reference] ?? 0;
    if (first.kind.endsWith('_stride')) {
      const size = Number(first.stride);
      const count = size > 0 && Number.isSafeInteger(size) ? Math.ceil(rows / size) : 0;
      // One page per reference page. A scrollable chart accommodates long runs.
      const columns = Math.min(5, Math.max(1, count));
      const height = Math.max(60, Math.ceil(count / columns) * 60);
      const missing = new Map<number, number>();
      for (const finding of report.findings) {
        if (
          finding.entity !== first.entity ||
          finding.source !== first.source ||
          finding.type !== (first.kind === 'missing_stride' ? 'missing_in_source' : 'extra_in_source')
        )
          continue;
        const match = finding.key.match(/(\d+)$/);
        const position = finding.referencePosition ?? (match ? Number(match[1]) : undefined);
        if (position !== undefined) {
          const page = Math.floor((position - 1) / size);
          missing.set(page, (missing.get(page) ?? 0) + 1);
        }
      }
      let shapes = '';
      for (let page = 0; page < count; page++) {
        const total = Math.min(size, rows - page * size);
        const lost = missing.get(page) ?? 0;
        const x = (page % columns) * 52 + 2,
          y = Math.floor(page / columns) * 60 + 2;
        shapes += `<rect x="${x}" y="${y}" width="44" height="36" rx="4" fill="var(--panel)" stroke="var(--line)"/><path d="M${x + 6} ${y + 9}h18m-18 7h18m-18 7h18" stroke="var(--line)"/><rect x="${x + 5}" y="${y + 28}" width="20" height="4" rx="2" fill="${lost ? 'var(--c)' : 'var(--line)'}"/><text x="${x + 22}" y="${y + 49}" fill="var(--muted)" text-anchor="middle" font-size="11">${total - lost}/${total}</text>`;
      }
      card.chart =
        svg(columns * 52, height, `${sources}: ${count} reference pages; highlighted rows are missing.`, shapes) +
        caption(
          `Rows kept per ${fmt(size)}-row reference page in ${labels.source(first.entity, first.source)}. Highlighted pages include all missing rows.`,
        );
    } else if (first.kind === 'datetime_offset') {
      const example = report.findings[members[0] ?? -1];
      const zone = example?.evidence?.timezone ?? presentation.displayTimezone ?? 'UTC';
      const sampleHour = (field: 'expected' | 'actual') => {
        const value = example?.[field];
        if (typeof value !== 'number') return 0;
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          hour: 'numeric',
          minute: '2-digit',
          hourCycle: 'h23',
        }).formatToParts(new Date(value));
        return (
          Number(parts.find((part) => part.type === 'hour')?.value ?? 0) +
          Number(parts.find((part) => part.type === 'minute')?.value ?? 0) / 60
        );
      };
      const ref = sampleHour('expected'),
        src = sampleHour('actual');
      const point = (hour: number, radius: number): [number, number] => {
        const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
        return [80 + Math.cos(angle) * radius, 80 + Math.sin(angle) * radius];
      };
      const [rx, ry] = point(ref, 56),
        [sx, sy] = point(src, 56);
      const shift = Number(first.delta) / 3600000;
      const clockwise = shift >= 0 ? 1 : 0;
      const large = Math.abs(shift % 24) > 12 ? 1 : 0;
      let shapes = '<circle cx="80" cy="80" r="56" fill="none" stroke="var(--line)" stroke-width="9"/>';
      for (const hour of [0, 6, 12, 18]) {
        const [x, y] = point(hour, 73);
        shapes += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" fill="var(--muted)">${hour}</text>`;
      }
      shapes += `<path d="M${rx} ${ry} A56 56 0 ${large} ${clockwise} ${sx} ${sy}" fill="none" stroke="var(--c)" stroke-width="9" stroke-linecap="round"/><circle cx="${rx}" cy="${ry}" r="6" fill="var(--ink)"/><circle cx="${sx}" cy="${sy}" r="6" fill="var(--c)" stroke="var(--panel)" stroke-width="2"/><text x="80" y="85" text-anchor="middle" font-size="21" font-weight="800" fill="var(--ink)">${escape(durationValue(BigInt(first.delta ?? 0)))}</text>`;
      card.chart =
        svg(
          160,
          160,
          `24-hour ${zone} dial: ${labels.source(first.entity, reference)} ${typeof example?.expected === 'number' ? readableDatetime(example.expected, zone) : 'unknown'}, ${sources} ${typeof example?.actual === 'number' ? readableDatetime(example.actual, zone) : 'unknown'}. Shift ${card.headline}.`,
          shapes,
        ) +
        caption(
          [
            ...new Set(
              card.groups.flatMap((groupIndex) => {
                const member = report.findings[memberships[groupIndex]?.[0] ?? -1];
                if (!member || typeof member.expected !== 'number' || typeof member.actual !== 'number') return [];
                return [
                  `${labels.source(first.entity, reference)}: ${readableDatetime(member.expected, member.evidence?.timezone ?? zone)}.`,
                  `${labels.source(first.entity, groups[groupIndex]?.source ?? first.source)}: ${readableDatetime(member.actual, member.evidence?.timezone ?? zone)}.`,
                ];
              }),
            ),
          ].join(' '),
        );
    } else if (first.kind === 'money_delta') {
      const total = summary?.uniqueCounts?.[first.source] ?? summary?.counts[first.source] ?? rows;
      const sourceMembers = memberships[card.groups[0] ?? -1] ?? [];
      const highlighted = total ? Math.floor((sourceMembers.length / total) * 100) : 0;
      let shapes = '';
      for (let i = 0; i < 100; i++)
        shapes += `<rect x="${(i % 10) * 14}" y="${Math.floor(i / 10) * 14}" width="11" height="11" rx="2" fill="${i < highlighted ? 'var(--c)' : 'var(--line)'}"/>`;
      const example = report.findings[members[0]!];
      const currency =
        first.currency ?? presentationRule(labels.entity(first.entity), first.field, false)?.currency ?? 'USD';
      const extra = example
        ? ` Example: ${example.keyParts?.join(' · ') ?? example.key} is ${formatMoneyMajor(BigInt(String(example.expected)), currency)} in ${labels.source(first.entity, reference)} and ${formatMoneyMajor(BigInt(String(example.actual)), currency)} in ${labels.source(first.entity, first.source)}.`
        : '';
      card.chart =
        caption(`Share of rows: ${labels.source(first.entity, first.source)}. 1 square = 1% of rows.`) +
        svg(
          137,
          137,
          `${sourceMembers.length} of ${total} values differ in ${labels.source(first.entity, first.source)}.`,
          shapes,
        ) +
        caption(
          `${card.groups
            .map((index) => {
              const group = groups[index]!;
              const count = memberships[index]!.length;
              const denominator = summary?.uniqueCounts?.[group.source] ?? summary?.counts[group.source] ?? total;
              return `${labels.source(group.entity, group.source)}: ${fmt(count)} of ${fmt(denominator)} (${denominator ? ((count / denominator) * 100).toFixed(1) : '0.0'}%)`;
            })
            .join('; ')}. ${labels.field(first.entity, first.field)} values.${extra}`,
        );
    } else {
      card.chart =
        svg(
          210,
          70,
          `${sources}: consistent value mapping.`,
          `<text x="105" y="25" text-anchor="middle" fill="var(--ink)" font-size="13">${escape(String(first.expected))} → ${escape(String(first.actual))}</text><text x="105" y="53" text-anchor="middle" fill="var(--muted)" font-size="12">${members.length} values</text>`,
        ) + caption(`${sources}: ${labels.field(first.entity, first.field)}.`);
    }
  }
  return [...cards.values()];
}
