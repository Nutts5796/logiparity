import { dirname, resolve } from 'node:path';
import { loadYaml, sourceSchema, ConfigError } from '@logiparity/core';
import { z } from 'zod';

const text = z.string().min(1);
export const eventTypes = ['driver_no_show', 'vehicle_breakdown', 'traffic_delay', 'order_cancel', 'capacity_change', 'http'] as const;
export const builtinNames = ['no_order_lost', 'single_assignment', 'capacity_respected', 'eta_updated_for_affected', 'customer_notified_for_affected'] as const;
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const event = z.object({ step: z.number().int().positive(), type: z.enum(eventTypes), params: z.record(text, z.unknown()).default({}) }).strict();
const invariant = z.union([
  z.enum(builtinNames),
  z.object({ sla_window_violations: z.object({ max: z.number().int().nonnegative() }).strict() }).strict(),
  z.object({ name: text, jsonPath: text, expected: z.unknown() }).strict().refine((v) => Object.hasOwn(v, 'expected'), 'Set expected explicitly'),
  z.object({ name: text, module: text }).strict(),
]);
export const scenarioSchema = z.object({
  version: z.literal(1), name: text, target: text,
  setup: z.object({ fixture: text }).strict().optional(),
  events: z.array(event).min(1),
  wait: z.object({ source: text.default('meta'), until: z.record(text, scalar).refine((v) => Object.keys(v).length > 0, 'Set a completion condition'), timeoutSeconds: z.number().positive().max(3600).default(60), pollSeconds: z.number().positive().max(60).default(2) }).strict(),
  invariants: z.array(invariant).min(1),
  afterwards: z.object({ parity: text }).strict().optional(),
}).strict().refine((v) => new Set(v.events.map((e) => e.step)).size === v.events.length, 'Event steps must be unique')
  .refine((v) => { const names = v.invariants.map((i) => typeof i === 'string' ? i : 'sla_window_violations' in i ? 'sla_window_violations' : i.name); return new Set(names).size === names.length; }, 'Invariant names must be unique');
const request = z.object({ method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), path: text, body: z.unknown().optional() }).strict();
export const targetSchema = z.object({
  version: z.literal(1), name: text, environment: z.enum(['test', 'staging']), allowMutations: z.literal(true),
  baseUrl: z.url().refine((v) => ['http:', 'https:'].includes(new URL(v).protocol) && !new URL(v).username && !new URL(v).password, 'Use HTTP(S) without embedded credentials'),
  timeoutMs: z.number().int().positive().max(300000).default(10000),
  headers: z.record(text, z.string()).default({}).refine((v) => !Object.keys(v).some((k) => /^(authorization|proxy-authorization|cookie|x-api-key)$/i.test(k)), 'Use headersEnv for credentials'),
  headersEnv: z.record(text, z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).default({}),
  setup: request.optional(), events: z.partialRecord(z.enum(eventTypes), request), replan: request.optional(),
  clock: z.object({ advance: request }).strict().optional(),
  state: z.record(text, sourceSchema).refine((v) => Object.keys(v).length > 0, 'Configure state sources'),
  artifacts: z.array(z.object({ path: text, file: z.string().regex(/^[A-Za-z0-9_-]+\.(csv|xlsx)$/) }).strict()).default([]),
}).strict().refine((v) => new Set(v.artifacts.map((a) => a.file)).size === v.artifacts.length, 'Artifact filenames must be unique');
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioEvent = Scenario['events'][number];
export type Invariant = Scenario['invariants'][number];
export type Target = z.infer<typeof targetSchema>;
export type RequestTemplate = z.infer<typeof request>;
export async function loadScenario(file: string, env: NodeJS.ProcessEnv) {
  return { scenario: parse(scenarioSchema, await loadYaml(file, env), file), baseDir: dirname(resolve(file)) };
}
export async function loadTarget(file: string, env: NodeJS.ProcessEnv) {
  return { target: parse(targetSchema, await loadYaml(file, env), file), baseDir: dirname(resolve(file)) };
}
function parse<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConfigError(`${file}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return result.data;
}
