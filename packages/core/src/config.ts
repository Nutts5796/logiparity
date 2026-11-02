import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { findingCategories } from './policy.js';

const name = z.string().min(1);
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const fields = z.record(name, name).refine((v) => Object.keys(v).length > 0, 'Map at least one field');
const httpUrl = z.url().refine((v) => {
  const u = new URL(v);
  return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
}, 'Use an HTTP(S) URL without embedded credentials');
const pageSize = z.number().int().min(1).max(10000).default(200);
const completionSignals = { totalPath: name.optional(), totalPagesPath: name.optional(), hasMorePath: name.optional() };
const pagination = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), ...completionSignals, pageParam: name.default('page'), sizeParam: name.default('limit'), size: pageSize, start: z.number().int().min(0).default(1) }).strict(),
  z.object({ type: z.literal('offset'), ...completionSignals, offsetParam: name.default('offset'), sizeParam: name.default('limit'), size: pageSize }).strict(),
  z.object({ type: z.literal('cursor'), cursorParam: name.default('cursor'), next: name, sizeParam: name.default('limit'), size: pageSize }).strict(),
  z.object({ type: z.literal('link') }).strict(),
]);
const auth = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bearer'), tokenEnv: envName }).strict(),
  z.object({ type: z.literal('basic'), usernameEnv: envName, passwordEnv: envName }).strict(),
]);
export const sourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rest'), baseUrl: httpUrl,
    path: name, fields, items: name.default('$.data[*]'),
    headers: z.record(name, z.string()).default({}).refine((v) => !Object.keys(v).some((k) => /^(authorization|proxy-authorization|cookie|x-api-key)$/i.test(k)), 'Use auth or headersEnv for secrets'),
    headersEnv: z.record(name, envName).default({}), auth: auth.optional(), pagination: pagination.optional(),
    timeoutMs: z.number().int().min(1).max(300000).default(10000),
    retries: z.number().int().min(0).max(10).default(3),
    backoffMs: z.number().int().min(1).max(10000).default(100),
    maxPages: z.number().int().min(1).max(1000000).default(10000),
  }).strict(),
  z.object({ type: z.literal('csv'), file: name, fields, delimiter: z.string().length(1).default(','), quote: z.string().length(1).default('"'), encoding: z.enum(['utf8', 'utf16le', 'latin1']).default('utf8'), headerRow: z.number().int().min(1).default(1) }).strict(),
  z.object({ type: z.literal('xlsx'), file: name, fields, sheet: name, headerRow: z.number().int().min(1).default(1) }).strict(),
  z.object({
    type: z.literal('ui'), url: httpUrl, storageState: name.optional(), table: name,
    rows: name.default('tbody tr'), fields, nextPage: name.optional(), readySelector: name.optional(),
    allowedOrigins: z.array(httpUrl.refine((v) => new URL(v).origin === v, 'Use an origin without a path, query or fragment')).default([]),
    timeoutMs: z.number().int().min(1).max(300000).default(10000),
    maxPages: z.number().int().min(1).max(100000).default(1000),
  }).strict(),
  z.object({
    type: z.literal('sql'), connectionEnv: envName, query: name, fields,
    params: z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).default([]),
    timeoutMs: z.number().int().min(1).max(300000).default(10000),
    batchSize: z.number().int().min(1).max(10000).default(1000),
  }).strict(),
]);
export const ruleSchema = z.object({
  type: z.enum(['string', 'number', 'money', 'datetime', 'enum']),
  allowNumber: z.boolean().default(false), caseFold: z.boolean().default(false), emptyAsNull: z.boolean().default(true),
  locale: name.default('en-US'), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  tolerance: z.number().finite().nonnegative().default(0),
  toleranceSeconds: z.number().finite().nonnegative().default(0),
  sourceTimezones: z.record(name, name).default({}),
  map: z.record(z.string(), z.string()).default({}),
}).strict().superRefine((v, ctx) => {
  if (v.type === 'money' && !v.currency) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Money requires a currency (e.g. USD)' });
  if (v.type === 'money' && !Number.isSafeInteger(v.tolerance)) ctx.addIssue({ code: 'custom', path: ['tolerance'], message: 'Money tolerance must be an integer in minor units' });
});
const where = z.record(name, z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).default({});
export const aggregateSchema = z.discriminatedUnion('type', [
  z.object({ name, type: z.literal('count'), where, tolerance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) }).strict(),
  z.object({ name, type: z.literal('sum'), field: name, where, tolerance: z.number().finite().nonnegative().default(0) }).strict(),
]);
const category = z.enum(findingCategories);
export const failOnSchema = z.union([
  z.array(category),
  z.partialRecord(category, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
]).default([...findingCategories]);
export const entitySchema = z.object({
  name, key: name, sources: z.record(name, sourceSchema),
  compare: z.record(name, ruleSchema).default({}),
  aggregates: z.array(aggregateSchema).default([]),
  failOn: failOnSchema,
}).strict().superRefine((v, ctx) => {
  if (Object.keys(v.sources).length < 2) ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Configure at least two sources; the first is the reference' });
  for (const [source, config] of Object.entries(v.sources)) {
    if (!Object.hasOwn(config.fields, v.key)) ctx.addIssue({ code: 'custom', path: ['sources', source, 'fields'], message: `Map the entity key ${v.key}` });
  }
  const reference = Object.values(v.sources)[0];
  const names = new Set<string>();
  for (const [index, aggregate] of v.aggregates.entries()) {
    const path = ['aggregates', index];
    if (names.has(aggregate.name)) ctx.addIssue({ code: 'custom', path: [...path, 'name'], message: 'Aggregate names must be unique within an entity' });
    names.add(aggregate.name);
    for (const field of [...Object.keys(aggregate.where), ...(aggregate.type === 'sum' ? [aggregate.field] : [])]) {
      if (!reference || !Object.hasOwn(reference.fields, field)) ctx.addIssue({ code: 'custom', path, message: `Map aggregate field ${field} in the reference source` });
    }
    if (aggregate.type === 'sum') {
      const rule = v.compare[aggregate.field];
      if (!rule || !['number', 'money'].includes(rule.type)) ctx.addIssue({ code: 'custom', path: [...path, 'field'], message: 'Sum requires a number or money comparison rule for its field' });
      if (rule?.type === 'money' && !Number.isSafeInteger(aggregate.tolerance)) ctx.addIssue({ code: 'custom', path: [...path, 'tolerance'], message: 'Money aggregate tolerance must be an integer in minor units' });
    }
  }
});
export const configSchema = z.object({
  version: z.literal(1), environment: z.enum(['test', 'staging']).default('test'),
  entities: z.array(entitySchema).min(1), variables: z.record(name, z.string()).default({}),
  report: z.object({ outputs: z.array(z.enum(['console', 'html', 'junit', 'json', 'markdown'])).min(1).default(['console', 'json']), dir: name.default('./logiparity-report') }).strict().default({ outputs: ['console', 'json'], dir: './logiparity-report' }),
}).strict().refine((v) => new Set(v.entities.map((e) => e.name)).size === v.entities.length, 'Entity names must be unique');
export type SourceConfig = z.infer<typeof sourceSchema>;
export type RestConfig = Extract<SourceConfig, { type: 'rest' }>;
export type FileConfig = Extract<SourceConfig, { type: 'csv' | 'xlsx' }>;
export type UiConfig = Extract<SourceConfig, { type: 'ui' }>;
export type SqlConfig = Extract<SourceConfig, { type: 'sql' }>;
export type ComparisonRule = z.infer<typeof ruleSchema>;
export type EntityConfig = z.infer<typeof entitySchema>;
export type AggregateConfig = z.infer<typeof aggregateSchema>;
export type Config = z.infer<typeof configSchema>;
export interface LoadedConfig { config: Config; baseDir: string; file: string }

export class ConfigError extends Error {}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadYaml(file: string, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const absolute = resolve(file);
  let content: string;
  try { content = await readFile(absolute, 'utf8'); }
  catch { throw new ConfigError(`${absolute}: cannot read configuration; check the file path and permissions.`); }
  const doc = parseDocument(content, { uniqueKeys: true });
  if (doc.errors.length) throw new ConfigError(`${absolute}: ${doc.errors.map((e) => e.message).join('; ')} Fix the YAML syntax.`);
  let raw: unknown;
  try { raw = doc.toJS({ maxAliasCount: 50 }); }
  catch { throw new ConfigError(`${absolute}: too many YAML aliases; use a plain configuration.`); }
  const walk = (value: unknown, transform: (s: string) => string): unknown => {
    if (typeof value === 'string') return transform(value);
    if (Array.isArray(value)) return value.map((v) => walk(v, transform));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, transform)]));
    return value;
  };
  raw = walk(raw, (s) => s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => {
    const value = Object.hasOwn(env, key) ? env[key] : undefined;
    if (!value) throw new ConfigError(`${absolute}: environment variable ${key} is missing or empty; set it before running check.`);
    return value;
  }));
  return raw;
}

export async function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): Promise<LoadedConfig> {
  const absolute = resolve(file);
  let raw = await loadYaml(absolute, env);
  const walk = (value: unknown, transform: (s: string) => string): unknown => {
    if (typeof value === 'string') return transform(value);
    if (Array.isArray(value)) return value.map((v) => walk(v, transform));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, transform)]));
    return value;
  };
  const vars = raw && typeof raw === 'object' && 'variables' in raw ? raw.variables : {};
  raw = walk(raw, (s) => s.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, key: string) => {
    if (!vars || typeof vars !== 'object' || !Object.hasOwn(vars, key)) throw new ConfigError(`${absolute}: variables.${key} is missing; define the template variable.`);
    const value: unknown = Reflect.get(vars, key);
    if (typeof value !== 'string') throw new ConfigError(`${absolute}: variables.${key} must be a quoted string.`);
    return value;
  }));
  const result = configSchema.safeParse(raw);
  if (!result.success) throw new ConfigError(`${absolute}: invalid configuration:\n${formatConfigIssues(configSchema, raw, result.error)}\nFix the listed configuration paths.`);
  return { config: result.data, baseDir: dirname(absolute), file: absolute };
}

/** Report unknown properties using the public Zod schema shape, including selected unions. */
export function formatConfigIssues(schema: z.ZodType, raw: unknown, error: z.ZodError): string {
  const unwrap = (input: z.ZodType, value: unknown, key?: PropertyKey): z.ZodType => {
    if (input instanceof z.ZodDefault || input instanceof z.ZodOptional || input instanceof z.ZodNullable) { const inner = input.unwrap(); return inner instanceof z.ZodType ? unwrap(inner, value, key) : input; }
    if (input instanceof z.ZodUnion) {
      const options = input.options.filter((option): option is z.ZodType => option instanceof z.ZodType);
      const chosen = options.find((option) => option instanceof z.ZodObject && value && typeof value === 'object' && option.shape.type instanceof z.ZodType && option.shape.type.safeParse(Reflect.get(value, 'type')).success)
        ?? options.find((option) => option instanceof z.ZodObject && key !== undefined && Object.hasOwn(option.shape, key))
        ?? options.find((option) => option instanceof z.ZodObject && option.loose().safeParse(value).success);
      return chosen ? unwrap(chosen, value, key) : input;
    }
    return input;
  };
  return error.issues.map((issue) => {
    let current = schema; let value = raw;
    for (const key of issue.path) {
      current = unwrap(current, value, key);
      const next = current instanceof z.ZodObject ? current.shape[String(key)] as unknown : current instanceof z.ZodArray ? current.element : current instanceof z.ZodRecord ? current.valueType : undefined;
      if (!(next instanceof z.ZodType)) break;
      current = next; value = value && typeof value === 'object' ? Reflect.get(value, key) : undefined;
    }
    current = unwrap(current, value);
    const keys = current instanceof z.ZodObject ? Object.keys(current.shape).sort() : [];
    return `  ${issue.path.join('.') || '<root>'}: ${issue.message}${issue.code === 'unrecognized_keys' && keys.length ? `. Valid keys: ${keys.join(', ')}` : ''}`;
  }).join('\n');
}
