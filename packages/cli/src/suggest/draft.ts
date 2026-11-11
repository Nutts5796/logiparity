import { relative } from 'node:path';
import { Document } from 'yaml';
import type { SourceSample } from '@logiparity/adapters';
import { columnName, guess, type Guess } from './infer.js';
export interface NamedSample {
  name: string;
  sample: SourceSample;
}
export function suggestDraft(samples: NamedSample[], baseDir: string): string {
  const fields = new Map<string, Map<string, string>>(),
    notes: string[] = [];
  for (const { name, sample } of samples) {
    const mapped = new Map<string, string>();
    for (const header of sample.headers) {
      const logical = columnName(header);
      if (mapped.has(logical))
        throw new Error(
          `${name}: ambiguous normalized headers ${JSON.stringify(mapped.get(logical))} and ${JSON.stringify(header)}; rename them explicitly before suggesting.`,
        );
      mapped.set(logical, header);
    }
    fields.set(name, mapped);
  }
  const logical = [...new Set([...fields.values()].flatMap((m) => [...m.keys()]))].sort();
  const shared = logical.filter((f) => samples.every((s) => fields.get(s.name)!.has(f)));
  const candidates = shared
    .flatMap((field) => {
      const evidence = samples.map(({ name, sample }) => {
        const header = fields.get(name)!.get(field)!;
        const values = sample.rows
          .map((r) => r[header])
          .filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
        return {
          name,
          present: values.length,
          total: sample.rows.length,
          unique: new Set(values.map((v) => String(v).trim())).size,
        };
      });
      return evidence.every((e) => e.total > 0 && e.present / e.total >= 0.95 && e.unique / e.present >= 0.95)
        ? [{ field, evidence }]
        : [];
    })
    .sort(
      (a, b) =>
        Number(/(?:^|_)id$/.test(b.field)) - Number(/(?:^|_)id$/.test(a.field)) || a.field.localeCompare(b.field),
    );
  notes.push('DRAFT — starting point only. No key, field match, type or endpoint is accepted automatically.');
  notes.push(
    'TODO: review every mapping and type; remove TODO_REVIEW_REQUIRED only after resolving the TODOs. validate must fail until that explicit review.',
  );
  notes.push(
    'Only local samples were read. No API was called. Coverage beyond the sample, money units, definitions and uniqueness of the full dataset are unknown.',
  );
  for (const candidate of candidates)
    notes.push(
      `Candidate key ${JSON.stringify(candidate.field)}: ${candidate.evidence.map((e) => `${e.name} ${e.unique}/${e.present} unique, ${e.present}/${e.total} present`).join('; ')}. TODO choose a key; uniqueness in a sample is not proof.`,
    );
  if (!candidates.length)
    notes.push('TODO: no high-presence/high-uniqueness shared key candidate; select or construct a key explicitly.');
  for (const { name, sample } of samples) {
    const unmatched = [...fields.get(name)!].filter(([field]) => !shared.includes(field)).map(([, header]) => header);
    notes.push(
      `${name}: sampled ${sample.rows.length} rows${sample.truncated ? ' (truncated)' : ''}; unmatched columns ${JSON.stringify(unmatched)}. All columns are retained; missing counterparts have TODO paths.`,
    );
  }
  const sources: Record<string, unknown> = {},
    compare: Record<string, unknown> = {},
    evidence = new Map<string, string>();
  for (const { name, sample } of samples) {
    const mapped: Record<string, unknown> = {};
    for (const field of logical) {
      const header = fields.get(name)!.get(field);
      mapped[field] = header ?? `TODO_MAP_OR_EXPLICITLY_REMOVE_${field}`;
    }
    sources[name] =
      sample.kind === 'json'
        ? { type: 'rest', baseUrl: 'TODO_API_BASE_URL', path: 'TODO_API_PATH', items: sample.items, fields: mapped }
        : {
            type: sample.kind,
            file: relative(baseDir, sample.file) || '.',
            ...(sample.kind === 'xlsx' ? { sheet: sample.sheet } : { delimiter: sample.delimiter }),
            fields: mapped,
          };
  }
  for (const field of logical) {
    const guesses: { name: string; value: Guess; numeric: boolean }[] = samples.flatMap(({ name, sample }) => {
      const header = fields.get(name)!.get(field);
      return header
        ? [
            {
              name,
              value: guess(
                header,
                sample.rows.map((row) => row[header]),
              ),
              numeric: sample.rows.some((row) => typeof row[header] === 'number'),
            },
          ]
        : [];
    });
    const types = new Set(guesses.map((g) => g.value.type));
    const type =
      types.size === 1
        ? guesses[0]!.value.type
        : types.size === 2 && types.has('money') && types.has('number')
          ? 'money'
          : 'string';
    const rule: Record<string, unknown> = { type };
    if (type === 'money') {
      rule.currency = 'TODO_REVIEW_CURRENCY';
      if (guesses.some((g) => g.numeric))
        notes.push(
          `TODO ${field}: numeric JSON/Excel money input requires an explicit allowNumber decision; decimal text is safer.`,
        );
      if (guesses.some((g) => g.value.symbol))
        notes.push(`TODO ${field}: review allowCurrencySymbol and locale; no symbol is accepted implicitly.`);
    }
    if (type === 'date') {
      const format = Object.fromEntries(guesses.flatMap((g) => (g.value.format ? [[g.name, g.value.format]] : [])));
      if (Object.keys(format).length) rule.format = format;
    }
    if (type === 'datetime') {
      const zones = Object.fromEntries(
        guesses.filter((g) => g.value.naive).map((g) => [g.name, 'TODO_SOURCE_TIMEZONE']),
      );
      if (Object.keys(zones).length) rule.sourceTimezones = zones;
    }
    evidence.set(
      field,
      guesses.map((g) => `${g.name}: ${g.value.type} — ${g.value.evidence}`).join('\n') +
        (types.size > 1 ? '\nTODO: source guesses differ; resolve semantics explicitly.' : ''),
    );
    compare[field] = rule;
  }
  const doc = new Document({
    version: 1,
    TODO_REVIEW_REQUIRED:
      'Resolve keys, unmatched columns, types, currency/units, time zones and REST endpoint; then remove this marker.',
    entities: [{ name: 'record', key: 'TODO_REVIEW_KEY', sources, compare }],
    report: { outputs: ['console', 'json', 'html', 'markdown', 'junit'], dir: './logiparity-report' },
  });
  doc.commentBefore = notes.join('\n');
  for (const [field, note] of evidence) {
    const node = doc.getIn(['entities', 0, 'compare', field], true);
    if (node && typeof node === 'object') Object.assign(node, { commentBefore: note });
  }
  return doc.toString();
}
