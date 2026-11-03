import { formatConfigIssues } from '@logiparity/core';
import { z } from 'zod';
import { readStructured } from './input.js';

export const aiSettingsSchema = z
  .object({
    version: z.literal(1),
    redactFields: z.array(z.string().trim().min(1)).default([]),
    timeoutMs: z.number().int().min(1).max(300000).default(30000),
    maxFindings: z.number().int().min(1).max(1000).default(100),
  })
  .strict();
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export async function loadAiSettings(file?: string): Promise<AiSettings> {
  const raw = file ? await readStructured(file) : { version: 1 };
  const result = aiSettingsSchema.safeParse(raw);
  if (!result.success)
    throw new Error(
      `${file ?? 'AI settings'}: invalid settings at ${formatConfigIssues(aiSettingsSchema, raw, result.error)}. Use version: 1, redactFields, timeoutMs and maxFindings; see docs/ai.md.`,
    );
  return result.data;
}
export interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}
export function providerConfig(env: NodeJS.ProcessEnv, timeoutMs: number, required = true): ProviderConfig | undefined {
  const names = ['LOGIPARITY_AI_BASE_URL', 'LOGIPARITY_AI_MODEL', 'LOGIPARITY_AI_API_KEY'] as const;
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) {
    if (!required) return undefined;
    throw new Error(`AI is disabled: set ${missing.join(', ')} before using --send. Omit --send for a local preview.`);
  }
  const apiKey = env.LOGIPARITY_AI_API_KEY!;
  const model = env.LOGIPARITY_AI_MODEL!;
  let base: URL;
  try {
    base = new URL(env.LOGIPARITY_AI_BASE_URL!);
  } catch {
    throw new Error('LOGIPARITY_AI_BASE_URL must be an HTTP(S) API base URL, e.g. https://provider.example/v1.');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error(
      'LOGIPARITY_AI_BASE_URL must use HTTP(S), without credentials, query or fragment. Put the key in LOGIPARITY_AI_API_KEY.',
    );
  const controls = (value: string) => [...value].some((c) => c.charCodeAt(0) < 32);
  if (controls(apiKey) || apiKey.trim() !== apiKey || controls(model) || model.length > 200)
    throw new Error(
      'AI key/model has invalid control characters or the model name is too long; check the provider environment variables.',
    );
  let location: string;
  try {
    location = decodeURIComponent(base.href);
  } catch {
    throw new Error('LOGIPARITY_AI_BASE_URL has invalid percent encoding; use a plain API base URL.');
  }
  if (location.includes(apiKey) || model.includes(apiKey))
    throw new Error('AI credentials must appear only in LOGIPARITY_AI_API_KEY, not in the provider URL or model name.');
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/chat/completions`;
  return { endpoint: base.href, model, apiKey, timeoutMs };
}
