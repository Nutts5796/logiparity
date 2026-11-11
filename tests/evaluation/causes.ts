import {
  compareEntities,
  entitySchema,
  type DataRow,
  type EntityConfig,
  type FindingGroup,
  type Report,
} from '@logiparity/core';

export interface Plant {
  id: string;
  category: string;
  entity: string;
  key: string;
  field: string;
  type: string;
  expected: string | null;
}
export interface Case {
  id: string;
  entities: EntityConfig[];
  rows: Record<string, { a: DataRow[]; b: DataRow[] }>;
  truth: Plant[];
}
export const randomFor = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
export function generateCase(seed: number, size: number): Case {
  const random = randomFor(seed),
    count = 3 + (seed % 3),
    truth: Plant[] = [],
    id = `s${seed}-n${size}`;
  const put = (category: string, entity: string, key: string, field: string, type: string, expected: string | null) =>
    truth.push({ id: `${id}/${entity}/${key}/${field}/${type}`, category, entity, key, field, type, expected });
  const a: DataRow[] = Array.from({ length: size }, (_, i) => ({
    id: `R${String(i + 1).padStart(6, '0')}`,
    stale: 'Delivered',
    casing: 'Delivered',
    space: 'Ready now',
    both: 'Ready now',
    vocabulary: 'D',
    reused_codes: i % 2 ? 'U' : 'D',
    unanchored: 'Delivered',
    quantity: 5,
    sparse: 10,
    rounding: '10.00',
    fixed: '10.00',
    zone: '2026-11-02T12:00:00Z',
    offset: '2026-11-02T12:00:00Z',
    day: '20261102',
    blank: 'Present',
    noise: 'same',
  }));
  const missing = new Set(a.filter((_, i) => (i + 1) % 10 === 0).map((r) => String(r.id)));
  const b: DataRow[] = a
    .filter((r) => !missing.has(String(r.id)))
    .map((r) => ({
      ...r,
      vocabulary: 'DONE',
      reused_codes: r.reused_codes === 'D' ? 'DONE' : 'D',
      unanchored: 'In transit',
      zone: '2026-11-02 12:00',
      day: '02-NOV-26',
    }));
  for (const key of missing) put('page_boundary', 'record', key, '', 'missing_in_source', 'missing_stride:pagination');
  for (const row of b) {
    put('vocabulary', 'record', String(row.id), 'vocabulary', 'field_mismatch', 'value_mapping:vocabulary');
    put(
      'vocabulary_reused_codes',
      'record',
      String(row.id),
      'reused_codes',
      'field_mismatch',
      'value_mapping:vocabulary',
    );
    put('stale_without_anchor', 'record', String(row.id), 'unanchored', 'field_mismatch', 'value_mapping:stale_value');
  }
  const indexes = b.map((_, i) => i);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = random() % (i + 1);
    [indexes[i], indexes[j]] = [indexes[j]!, indexes[i]!];
  }
  const duplicate = b[indexes.pop()!]!;
  const plants: [string, string, unknown, string | null, number][] = [
    ['stale_status', 'stale', 'In transit', 'value_mapping:stale_value', count],
    ['case_only', 'casing', 'delivered', 'formatting_difference:case_only', count],
    ['whitespace_only', 'space', 'Ready  now', 'formatting_difference:whitespace_only', count],
    ['case_and_whitespace', 'both', 'ready  now', 'formatting_difference:case_whitespace', count],
    ['numeric_drift', 'quantity', 7, 'number_change:pair', count],
    ['numeric_below_support', 'sparse', 11, 'number_change:pair', 2],
    ['rounding', 'rounding', seed % 2 ? '10.01' : '9.99', 'money_delta:rounding', count],
    ['fixed_money', 'fixed', '15.00', 'money_delta:fixed', count],
    ['timezone', 'zone', '2026-11-02 06:00', 'datetime_offset:timezone', count],
    ['datetime_offset', 'offset', '2026-11-02T11:55:00Z', 'datetime_offset:offset', count],
    ['date_only', 'day', '03-NOV-26', null, count],
    ['blank', 'blank', '', null, count],
    ['individual', 'noise', 'one-off-' + seed, null, 1],
  ];
  // Distinct rows keep the ground truth unambiguous while all defect families coexist in one report.
  let cursor = 0;
  for (const [category, field, value, expected, n] of plants)
    for (let i = 0; i < n; i++) {
      const row = b[indexes[cursor++ % indexes.length]!]!;
      row[field] = value;
      put(category, 'record', String(row.id), field, 'field_mismatch', expected);
    }
  b.push({ ...duplicate });
  put('duplicate', 'record', String(duplicate.id), '', 'duplicate_key', null);
  for (let i = b.length - 1; i > 0; i--) {
    const j = random() % (i + 1);
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  const fields = Object.fromEntries(Object.keys(a[0]!).map((name) => [name, name]));
  const entity = entitySchema.parse({
    name: 'record',
    key: 'id',
    sources: {
      a: { type: 'csv', file: 'synthetic', fields },
      b: {
        type: 'rest',
        baseUrl: 'http://fixture.invalid',
        path: '/',
        fields: Object.fromEntries(Object.keys(fields).map((f) => [f, '$.' + f])),
        pagination: { type: 'page', size: 10, totalPath: '$.total' },
      },
    },
    compare: {
      stale: { type: 'enum' },
      casing: { type: 'enum' },
      space: { type: 'enum' },
      both: { type: 'enum' },
      vocabulary: { type: 'enum' },
      reused_codes: { type: 'enum' },
      unanchored: { type: 'enum' },
      quantity: { type: 'number' },
      sparse: { type: 'number' },
      rounding: { type: 'money', currency: 'USD' },
      fixed: { type: 'money', currency: 'USD' },
      zone: { type: 'datetime', sourceTimezones: { b: 'UTC' } },
      offset: { type: 'datetime' },
      day: { type: 'date', format: { a: 'yyyyMMdd', b: 'dd-MMM-yy' } },
      blank: { type: 'string' },
    },
  });
  const sequential: DataRow[] = Array.from({ length: count }, (_, i) => ({ id: `M${(i + 1) * 10}` }));
  const extras: DataRow[] = Array.from({ length: count }, (_, i) => ({ id: `X${(i + 1) * 10}` }));
  const source = { type: 'csv', file: 'synthetic', fields: { id: 'id' } };
  const second = entitySchema.parse({ name: 'sequence', key: 'id', sources: { a: source, b: source } });
  sequential.forEach((r) =>
    put('missing_sequence', 'sequence', String(r.id), '', 'missing_in_source', 'missing_stride:sequence'),
  );
  extras.forEach((r) =>
    put('extra_sequence', 'sequence', String(r.id), '', 'extra_in_source', 'extra_stride:sequence'),
  );
  return {
    id,
    entities: [entity, second],
    rows: { record: { a, b }, sequence: { a: [{ id: 'anchor' }, ...sequential], b: [{ id: 'anchor' }, ...extras] } },
    truth,
  };
}
export function predicted(group: FindingGroup): string {
  if (group.kind === 'money_delta')
    return `${group.kind}:${BigInt(group.delta ?? 0) >= -3n && BigInt(group.delta ?? 0) <= 3n ? 'rounding' : 'fixed'}`;
  const fallback: Record<string, string> = {
    value_mapping: 'vocabulary',
    number_change: 'pair',
    missing_stride: 'sequence',
    extra_stride: 'sequence',
    datetime_offset: 'offset',
  };
  return `${group.kind}:${group.cause ?? fallback[group.kind] ?? 'unknown'}`;
}
export interface EvaluationRow {
  category: string;
  groupable: boolean;
  planted: number;
  found: number;
  correctlyLabelled: number;
  mislabelled: number;
  ungrouped: number;
  missed: number;
  falseGroups: number;
  as: Record<string, number>;
}
export async function evaluate(cases: Case[]) {
  const rows = new Map<string, EvaluationRow>(),
    correct: Record<string, string> = {},
    groups: {
      case: string;
      index: number;
      prediction: string;
      members: number;
      correct: number;
      wrong: number;
      unplanted: number;
    }[] = [];
  const expectedCategories = new Map<string, string>([
    ['value_mapping:vocabulary', 'vocabulary'],
    ['value_mapping:stale_value', 'stale_status'],
    ['number_change:pair', 'numeric_drift'],
    ['money_delta:rounding', 'rounding'],
    ['money_delta:fixed', 'fixed_money'],
    ['missing_stride:pagination', 'page_boundary'],
    ['missing_stride:sequence', 'missing_sequence'],
    ['extra_stride:sequence', 'extra_sequence'],
    ['datetime_offset:timezone', 'timezone'],
    ['datetime_offset:offset', 'datetime_offset'],
    ['formatting_difference:case_only', 'case_only'],
    ['formatting_difference:whitespace_only', 'whitespace_only'],
    ['formatting_difference:case_whitespace', 'case_and_whitespace'],
  ]);
  for (const c of cases) {
    const report: Report = await compareEntities(
      c.entities,
      async function* (name, source) {
        const entity = source.fields.stale ? 'record' : 'sequence';
        yield* c.rows[entity]![name as 'a' | 'b'];
      },
      {},
      { maxFindings: 100000 },
    );
    const byFinding = new Map<number, string[]>();
    for (const [gIndex, g] of (report.groups ?? []).entries()) {
      const label = predicted(g);
      let right = 0,
        wrong = 0,
        unplanted = 0;
      for (const index of g.findingIndexes ?? []) {
        const f = report.findings[index]!;
        const p = c.truth.find(
          (p) => p.entity === f.entity && p.key === f.key && p.field === f.field && p.type === f.type,
        );
        if (!p) unplanted++;
        else if (p.expected === label) right++;
        else wrong++;
        byFinding.set(index, [...(byFinding.get(index) ?? []), label]);
      }
      groups.push({ case: c.id, index: gIndex, prediction: label, members: g.count, correct: right, wrong, unplanted });
      if (!right) {
        const category = expectedCategories.get(label) ?? 'unplanted';
        const row = rows.get(category) ?? newRow(category, true);
        row.falseGroups++;
        rows.set(category, row);
      }
    }
    for (const p of c.truth) {
      const row = rows.get(p.category) ?? newRow(p.category, p.expected !== null);
      row.planted++;
      const index = report.findings.findIndex(
        (f) =>
          f.entity === p.entity &&
          f.key === p.key &&
          f.type === p.type &&
          (p.type === 'duplicate_key' || f.field === p.field),
      );
      if (index < 0) row.missed++;
      else {
        row.found++;
        const labels = byFinding.get(index) ?? [];
        if (!labels.length) row.ungrouped++;
        else if (p.expected && labels.every((l) => l === p.expected)) {
          row.correctlyLabelled++;
          correct[p.id] = p.expected;
        } else {
          row.mislabelled++;
          for (const label of labels) row.as[label] = (row.as[label] ?? 0) + 1;
        }
      }
      rows.set(p.category, row);
    }
  }
  return {
    cases: cases.map((c) => c.id),
    rows: [...rows.values()].sort((a, b) => a.category.localeCompare(b.category)),
    groups,
    correct,
  };
}
function newRow(category: string, groupable: boolean): EvaluationRow {
  return {
    category,
    groupable,
    planted: 0,
    found: 0,
    correctlyLabelled: 0,
    mislabelled: 0,
    ungrouped: 0,
    missed: 0,
    falseGroups: 0,
    as: {},
  };
}
export function table(rows: EvaluationRow[]): string {
  return [
    '| Cause / defect | Planted | Found | Correct label | Mislabelled | Ungrouped | Missed | False groups |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.category} | ${r.planted} | ${r.found} | ${r.groupable ? r.correctlyLabelled : 'n/a'} | ${r.mislabelled} | ${r.ungrouped} | ${r.missed} | ${r.falseGroups} |`,
    ),
  ].join('\n');
}
export interface CorrectGuard {
  case: string;
  entity: string;
  field: string;
  type: string;
  label: string;
  keys: string[];
}
export function compactGuard(correct: Record<string, string>): CorrectGuard[] {
  const buckets = new Map<string, CorrectGuard>();
  for (const [id, label] of Object.entries(correct)) {
    const [caseId, entity, key, field, type] = id.split('/') as [string, string, string, string, string];
    const bucket = [caseId, entity, field, type, label].join('/');
    const item = buckets.get(bucket) ?? { case: caseId, entity, field, type, label, keys: [] };
    item.keys.push(key);
    buckets.set(bucket, item);
  }
  return [...buckets.values()];
}
export function guardFailures(guard: CorrectGuard[], correct: Record<string, string>): string[] {
  return guard.flatMap((g) =>
    g.keys.flatMap((key) => {
      const id = [g.case, g.entity, key, g.field, g.type].join('/');
      return correct[id] === g.label ? [] : [id + ': expected ' + g.label];
    }),
  );
}
