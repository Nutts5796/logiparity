import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { configSchema } from '@logiparity/core';
import { scenarioSchema } from '@logiparity/scenarios';
import { parseStructured } from './input.js';
import type { AiProvider } from './provider.js';
import type { PreparedDraft } from './tasks.js';

export const draftMarker = '# AI-generated draft: review before use';
export async function prepareDestination(file: string, kind: PreparedDraft['kind']): Promise<string> {
  const absolute = resolve(file);
  const extensions = kind === 'explain' ? ['.md', '.markdown'] : ['.yaml', '.yml'];
  if (!extensions.includes(extname(absolute).toLowerCase())) throw new Error(`AI ${kind} output must use ${extensions.join(' or ')}; choose a new --output file.`);
  try { await lstat(absolute); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error(`${absolute}: cannot inspect draft output; check permissions.`);
    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    return absolute;
  }
  throw new Error(`${absolute}: output already exists; choose a new --output path. AI drafts never overwrite files.`);
}
function substituteUrls(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, 'https://staging.invalid');
  if (Array.isArray(value)) return value.map(substituteUrls);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, substituteUrls(child)]));
  return value;
}
export function renderDraft(prepared: PreparedDraft, answer: string): string {
  let content = prepared.scrub(answer).trim();
  const fenced = content.match(/^```(?:yaml|yml|markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) content = fenced[1]!.trim();
  if (content.startsWith(draftMarker)) content = content.slice(draftMarker.length).trimStart();
  if (!content) throw new Error('AI returned an empty draft; no output was written. Retry with a more specific input.');
  if (prepared.kind !== 'explain') {
    const raw = parseStructured(content, 'AI draft');
    const schema = prepared.kind === 'suggest-config' ? configSchema : scenarioSchema;
    // Validate structure using dummy URL substitutions. Never read real environment values or referenced files.
    const result = schema.safeParse(prepared.kind === 'suggest-config' ? substituteUrls(raw) : raw);
    if (!result.success) throw new Error(`AI ${prepared.kind} draft does not match the LogiParity schema at ${result.error.issues.slice(0, 8).map((i) => i.path.join('.') || '<root>').join(', ')}; no file was written. Revise the input or try another model.`);
  }
  return `${draftMarker}\n${content}\n`;
}
export async function generateDraft(prepared: PreparedDraft, provider: AiProvider, destination: string): Promise<void> {
  await prepareDestination(destination, prepared.kind);
  const content = renderDraft(prepared, await provider.complete(prepared.messages));
  try { await writeFile(destination, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
  catch { throw new Error(`${destination}: cannot create a new AI draft; check permissions or choose an unused --output path. No file was overwritten.`); }
}
