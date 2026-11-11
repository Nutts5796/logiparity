import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2),
  option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
const populationFile = 'docs/evaluation/fmcsa-groups-population.json';
if (option('--ia') && option('--summary')) {
  const iaBytes = await readFile(option('--ia')),
    summaryBytes = await readFile(option('--summary')),
    ia = JSON.parse(iaBytes),
    summary = JSON.parse(summaryBytes);
  const allowed = new Set([
    'carrier_operation',
    'hazmat',
    'mcs150_mileage',
    'mcs150_mileage_year',
    'power_units',
    'total_drivers',
    'mcs150_date',
  ]);
  const select = (state, entity, group) => ({
    state,
    entity,
    kind: group.kind,
    field: group.field,
    count: group.count,
    summary: group.summary,
  });
  const groups = [
    ...ia.groups.filter((g) => allowed.has(g.field)).map((g) => select('IA', g.entity, g)),
    ...Object.entries(summary.states.VT.entities).flatMap(([name, entity]) =>
      entity.causes.filter((g) => allowed.has(g.field)).map((g) => select('VT', name, g)),
    ),
  ];
  await writeFile(
    populationFile,
    JSON.stringify(
      {
        capturedAtUTC: new Date().toISOString(),
        sources: [
          {
            state: 'IA',
            source: 'local fmcsa-parity-monitor/report-IA/report.json',
            sha256: createHash('sha256').update(iaBytes).digest('hex'),
            runAt: null,
          },
          {
            state: 'VT',
            source: 'https://github.com/Nutts5796/fmcsa-parity-monitor/blob/main/docs/data/latest.json',
            sha256: createHash('sha256').update(summaryBytes).digest('hex'),
            runAt: summary.runAt,
            selection: 'public top-12 cause summaries; not the full Vermont group population',
          },
        ],
        groups,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
}
const population = JSON.parse(await readFile(populationFile, 'utf8'));
let seed = 130012;
const shuffled = population.groups.map((g, index) => ({ ...g, populationIndex: index }));
for (let i = shuffled.length - 1; i > 0; i--) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const j = seed % (i + 1);
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const sample = shuffled.slice(0, 50);
const csv = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const fields = [
  'sample_id',
  'state',
  'entity',
  'kind',
  'field',
  'count',
  'summary',
  'reviewer_verdict',
  'reviewer_note',
];
const output = option('--output') ?? 'docs/evaluation/fmcsa-sample-for-review.csv';
await writeFile(
  output,
  [
    fields.join(','),
    ...sample.map((g) =>
      [g.populationIndex + 1, g.state, g.entity, g.kind, g.field, g.count, g.summary, '', ''].map(csv).join(','),
    ),
  ].join('\n') + '\n',
  { flag: 'wx' },
);
console.log(
  `FMCSA sample: ${sample.length} of ${population.groups.length} available groups; seed 130012; ${sample.filter((g) => g.state === 'IA').length} IA / ${sample.filter((g) => g.state === 'VT').length} VT. Verdicts and notes are empty; real-data accuracy is not measured.`,
);
