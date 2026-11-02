import { z } from 'zod';
import type { ProviderConfig } from './config.js';

export interface AiMessage { role: 'system' | 'user'; content: string }
export interface AiProvider { complete(messages: readonly AiMessage[]): Promise<string> }
export const maxRequestBytes = 256 * 1024;
export const maxResponseBytes = 1024 * 1024;
export function chatBody(config: Pick<ProviderConfig, 'model'>, messages: readonly AiMessage[]) {
  return { model: config.model, messages, stream: false as const };
}
export function requestBody(config: Pick<ProviderConfig, 'model'>, messages: readonly AiMessage[]): string {
  const body = JSON.stringify(chatBody(config, messages));
  if (Buffer.byteLength(body) > maxRequestBytes) throw new Error('AI request exceeds 256 KiB; reduce the OpenAPI document or maxFindings, then preview again.');
  return body;
}
const completion = z.object({ choices: z.array(z.object({
  finish_reason: z.string(),
  message: z.object({ content: z.string().min(1), refusal: z.string().nullable().optional(), tool_calls: z.array(z.unknown()).optional() }),
})).min(1) });
export class ChatCompletionsProvider implements AiProvider {
  constructor(private readonly config: ProviderConfig) {}
  async complete(messages: readonly AiMessage[]): Promise<string> {
    const body = requestBody(this.config, messages);
    let response: Response;
    try {
      response = await fetch(this.config.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` }, body, redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs) });
    } catch { throw new Error('AI provider connection, redirect or timeout error; check LOGIPARITY_AI_BASE_URL and timeoutMs. No retry was made.'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`AI provider returned HTTP ${response.status}; check credentials, model and provider availability. Response body omitted; no retry was made.`);
    }
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      if (!response.body) throw new Error('empty');
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maxResponseBytes) { await response.body.cancel().catch(() => undefined); throw new Error('large'); }
        chunks.push(chunk);
      }
    } catch { throw new Error('AI response is incomplete, timed out or exceeds 1 MiB; check provider output limits and retry explicitly.'); }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('AI provider returned invalid JSON; use a non-streaming chat-completions endpoint. Response body omitted.'); }
    const result = completion.safeParse(value);
    if (!result.success) throw new Error('AI provider returned no valid text completion; check the chat-completions response format. Response body omitted.');
    const choice = result.data.choices[0]!;
    if (choice.finish_reason !== 'stop' || choice.message.refusal || choice.message.tool_calls?.length || !choice.message.content.trim()) throw new Error('AI completion was truncated, refused, empty or requested tools; no draft was written. Check model/output settings and retry explicitly.');
    return choice.message.content;
  }
}
