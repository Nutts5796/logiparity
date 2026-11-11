import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readSample } from '@logiparity/adapters';
import { suggestDraft } from './draft.js';
function choices(values: string[], label: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const value of values) {
    const at = value.indexOf('=');
    const name = value.slice(0, at),
      path = value.slice(at + 1);
    if (
      at < 1 ||
      !path ||
      !/^[_a-zA-Z][_a-zA-Z0-9-]*$/.test(name) ||
      ['__proto__', 'constructor', 'prototype'].includes(name)
    )
      throw new Error(`${label} uses source=value with a simple source name.`);
    if (entries.has(name)) throw new Error(`${label}: source ${name} is specified twice.`);
    entries.set(name, path);
  }
  return entries;
}
export const suggestHelp =
  'Usage: logiparity suggest --source reference=sample.csv --source candidate=sample.json [--source third=sample.xlsx] [--sheet third=SheetName] [--items candidate=$.data[*]] [--sample-rows 200] [--output new-parity.yaml]\nReads bounded local samples only. Prints an intentionally blocked TODO draft; validate it only after reviewing all guesses. Existing output files are never overwritten.\n';
export async function suggestCommand(values: {
  source?: string[];
  sheet?: string[];
  items?: string[];
  'sample-rows'?: string;
  output?: string;
}): Promise<string> {
  const sources = choices(values.source ?? [], '--source'),
    sheets = choices(values.sheet ?? [], '--sheet'),
    items = choices(values.items ?? [], '--items');
  if (sources.size < 2 || sources.size > 8)
    throw new Error('suggest requires 2–8 named local --source samples.\n' + suggestHelp);
  for (const name of [...sheets.keys(), ...items.keys()])
    if (!sources.has(name)) throw new Error(`Sample options name unknown source ${name}.`);
  const limit = values['sample-rows'] === undefined ? 200 : Number(values['sample-rows']);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('--sample-rows must be an integer from 1 to 1,000.');
  const output = values.output ? resolve(values.output) : undefined,
    samples = [];
  for (const [name, file] of sources)
    samples.push({
      name,
      sample: await readSample(file, {
        limit,
        ...(sheets.has(name) ? { sheet: sheets.get(name)! } : {}),
        ...(items.has(name) ? { items: items.get(name)! } : {}),
      }),
    });
  const yaml = suggestDraft(samples, output ? dirname(output) : process.cwd());
  if (output) {
    await writeFile(output, yaml, { flag: 'wx', mode: 0o600 });
    return `Created review draft ${output}. Resolve every TODO before validate/check; no sources were called.\n`;
  }
  return yaml;
}
