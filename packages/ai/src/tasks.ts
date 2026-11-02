import { z } from 'zod';
import type { AiSettings } from './config.js';
import type { AiMessage } from './provider.js';
import { readStructured } from './input.js';
import { redactInput, type Redaction } from './redact.js';
import { systemPrompt } from './prompts.js';

export type DraftKind = 'suggest-config' | 'scenario' | 'explain';
export type DraftTask = { kind: 'suggest-config'; openapi: string; entity: string } | { kind: 'scenario'; description: string } | { kind: 'explain'; report: string };
export interface PreparedDraft { kind: DraftKind; messages: AiMessage[]; redactions: number; scrub: Redaction['scrub'] }
const text = z.string().min(1);
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const reportSchema = z.object({
  schemaVersion: z.literal(1),
  entities: z.array(z.object({ entity: text, reference: text, counts: z.record(text, z.number().int().nonnegative()), aggregates: z.array(z.object({ name: text, type: z.enum(['count', 'sum']), values: z.record(text, z.union([z.string(), z.number().finite()])), skippedSources: z.array(text) }).strict()).optional() }).strict()),
  findings: z.array(z.object({ type: z.enum(['missing_in_source', 'extra_in_source', 'field_mismatch', 'aggregate_mismatch', 'duplicate_key', 'source_error']), entity: text, source: text, key: z.string(), field: z.string(), message: z.string(), expected: scalar.optional(), actual: scalar.optional(), blocking: z.boolean().optional(), screenshot: z.string().optional() }).strict()),
}).strict();
export async function prepareDraft(task: DraftTask, settings: AiSettings, secrets: readonly string[] = []): Promise<PreparedDraft> {
  let input: unknown;
  if (task.kind === 'suggest-config') {
    if (!task.entity.trim() || task.entity.length > 200) throw new Error('--entity must be a nonempty name up to 200 characters.');
    const raw = await readStructured(task.openapi);
    const result = z.object({ openapi: z.string().regex(/^3\.\d+\.\d+(?:[-+].*)?$/), paths: z.record(z.string(), z.unknown()) }).passthrough().safeParse(raw);
    if (!result.success) throw new Error(`${task.openapi}: expected an OpenAPI 3.x document with paths. Local and remote $ref values are sent as text, never resolved.`);
    input = { entity: task.entity, openapi: result.data };
  } else if (task.kind === 'scenario') {
    if (!task.description.trim() || Buffer.byteLength(task.description) > 8192) throw new Error('--from must contain a scenario description up to 8 KiB.');
    input = { description: task.description };
  } else {
    const result = reportSchema.safeParse(await readStructured(task.report));
    if (!result.success) throw new Error(`${task.report}: expected a Parity schemaVersion: 1 report.json. For M4 scenarios use parity/report.json. Check paths: ${result.error.issues.slice(0, 5).map((i) => i.path.join('.') || '<root>').join(', ')}.`);
    const report = result.data; const counts: Record<string, number> = {};
    for (const finding of report.findings) counts[finding.type] = (counts[finding.type] ?? 0) + 1;
    input = { report: { ...report, findings: report.findings.slice(0, settings.maxFindings) }, sampling: { totalFindings: report.findings.length, sentFindings: Math.min(report.findings.length, settings.maxFindings), omittedFindings: Math.max(0, report.findings.length - settings.maxFindings), blockingFindings: report.findings.filter((f) => f.type === 'source_error' || f.blocking !== false).length, countsByType: counts } };
  }
  const redaction = redactInput(input, settings.redactFields, secrets);
  return { kind: task.kind, messages: [{ role: 'system', content: systemPrompt(task.kind) }, { role: 'user', content: JSON.stringify(redaction.data, null, 2) }], redactions: redaction.count, scrub: redaction.scrub };
}
