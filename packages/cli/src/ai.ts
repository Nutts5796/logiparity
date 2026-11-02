import { safeConsole, redactSecrets, secretValues } from '@logiparity/core';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ChatCompletionsProvider, chatBody, generateDraft, loadAiSettings, prepareDestination, prepareDraft, providerConfig, requestBody, type DraftTask } from '@logiparity/ai';

export interface AiOptions {
  'allow-modules'?: boolean | undefined; version?: boolean | undefined;
  config?: string | undefined; target?: string | undefined; 'report-dir'?: string | undefined;
  openapi?: string | undefined; entity?: string | undefined; from?: string | undefined;
  output?: string | undefined; 'ai-config'?: string | undefined; 'redact-fields'?: string[] | undefined;
  send?: boolean | undefined;
}
export async function aiCommand(positionals: string[], values: AiOptions): Promise<number> {
  const usage = 'Use ai suggest-config --openapi <spec.yaml> --entity <name>, ai scenario --from <description>, or ai explain <report.json>; see --help.';
  if (values['allow-modules'] || values.config || values.target || values['report-dir']) throw new Error(`${usage} AI settings use --ai-config.`);
  let task: DraftTask;
  if (positionals.length === 1 && positionals[0] === 'suggest-config' && values.openapi && values.entity && values.from === undefined) task = { kind: 'suggest-config', openapi: values.openapi, entity: values.entity };
  else if (positionals.length === 1 && positionals[0] === 'scenario' && values.from !== undefined && values.openapi === undefined && values.entity === undefined) task = { kind: 'scenario', description: values.from };
  else if (positionals.length === 2 && positionals[0] === 'explain' && positionals[1] && values.openapi === undefined && values.entity === undefined && values.from === undefined) task = { kind: 'explain', report: positionals[1] };
  else throw new Error(usage);
  const settings = await loadAiSettings(values['ai-config']);
  const fields = (values['redact-fields'] ?? []).flatMap((value) => value.split(',').map((field) => field.trim()));
  if (fields.some((field) => !field)) throw new Error('--redact-fields requires nonempty comma-separated field names or JSONPaths. Nothing was sent.');
  settings.redactFields.push(...fields);
  const config = providerConfig(process.env, settings.timeoutMs, values.send === true);
  const prepared = await prepareDraft(task, settings, process.env.LOGIPARITY_AI_API_KEY ? [process.env.LOGIPARITY_AI_API_KEY] : []);
  const body = chatBody(config ?? { model: '<LOGIPARITY_AI_MODEL>' }, prepared.messages);
  requestBody(config ?? { model: '<LOGIPARITY_AI_MODEL>' }, prepared.messages);
  const destination = resolve(values.output ?? `logiparity-ai-drafts/${task.kind}-${randomUUID()}.${task.kind === 'explain' ? 'md' : 'yaml'}`);
  if (values.send) await prepareDestination(destination, task.kind);
  const preview = `AI request preview — ${values.send ? 'will send once after this preview' : 'local only; nothing sent'}\n${JSON.stringify({ endpoint: config?.endpoint ?? '<LOGIPARITY_AI_BASE_URL>/chat/completions', headers: { 'content-type': 'application/json', authorization: '[REDACTED]' }, body, maskedFields: prepared.redactions }, null, 2)}\n`;
  await new Promise<void>((done) => process.stdout.write(safeConsole(redactSecrets(preview, secretValues(undefined))), () => done()));
  if (!values.send) { process.stdout.write('Preview only. Review this payload and rerun with --send to request a draft. No output file was created.\n'); return 0; }
  await generateDraft(prepared, new ChatCompletionsProvider(config!), destination);
  process.stdout.write(safeConsole(redactSecrets(`Created ${destination}. AI-generated draft: review before use. It has not been executed.\n`, secretValues(undefined))));
  return 0;
}
