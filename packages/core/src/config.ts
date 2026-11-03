import {
  redactSecrets,
  secretValues,
  referencedEnvironment,
  rememberEnvironment,
  shortSecretWarnings,
} from './diagnostics.js';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { normalize, sourceRule } from './normalize.js';
import { validAllowedHost } from './hosts.js';
import { findingCategories } from './policy.js';

const name = z.string().min(1);
const locale = name.refine((value) => {
  try {
    return Intl.NumberFormat.supportedLocalesOf([value]).length === 1;
  } catch {
    return false;
  }
}, 'Use a valid supported locale, e.g. en-US or de-DE');
const timezone = name.refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Use a valid IANA timezone');
const numberFormat = z
  .object({ decimal: z.string().length(1), group: z.string().length(1).optional() })
  .strict()
  .refine((value) => value.decimal !== value.group, 'Decimal and grouping separators must differ');
const sourceFormatting = {
  currencyField: name.optional(),
  locale: locale.optional(),
  numberFormat: numberFormat.optional(),
  datetimeFormat: name.optional(),
};

const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const fieldSchema = z.union([name, z.object({ path: name, label: name.optional() }).strict()]);
const fields = z.record(name, fieldSchema).refine((v) => Object.keys(v).length > 0, 'Map at least one field');
const httpUrl = z.url().refine((v) => {
  const u = new URL(v);
  return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
}, 'Use an HTTP(S) URL without embedded credentials');
const pageSize = z.number().int().min(1).max(10000).default(200);
const completionSignals = { totalPath: name.optional(), totalPagesPath: name.optional(), hasMorePath: name.optional() };
export const keySchema = z.union([
  name,
  z
    .array(name)
    .min(1)
    .refine((items) => new Set(items).size === items.length, 'Key fields must be unique'),
]);
const scalarFilter = z.union([z.string(), z.number().finite(), z.boolean(), z.null()], {
  error: 'Expected a scalar: string, number, boolean or null',
});
const filterChoice = z.union([scalarFilter, z.array(scalarFilter).min(1)]);
export const rowFilterSchema = z.record(
  name,
  z.union([filterChoice, z.object({ not: filterChoice }).strict()], {
    error: 'Expected a scalar, a nonempty list of scalar values, or {not: value}',
  }),
);
const rollup = z
  .object({
    by: keySchema,
    where: rowFilterSchema.default({}),
    sum: z.array(name).default([]),
    first: z.array(name).default([]),
    duplicates: z
      .object({
        by: z
          .array(name)
          .min(1)
          .refine((items) => new Set(items).size === items.length, 'Duplicate identity fields must be unique'),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      new Set([...keyFields(v.by), ...v.sum, ...v.first]).size ===
      keyFields(v.by).length + v.sum.length + v.first.length,
    'Rollup fields must be unique and disjoint',
  );
const pagination = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('page'),
      ...completionSignals,
      allowShortFirstPage: z.boolean().default(false),
      pageParam: name.default('page'),
      sizeParam: name.default('limit'),
      size: pageSize,
      start: z.number().int().min(0).default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('offset'),
      ...completionSignals,
      allowShortFirstPage: z.boolean().default(false),
      offsetParam: name.default('offset'),
      sizeParam: name.default('limit'),
      size: pageSize,
    })
    .strict(),
  z
    .object({
      type: z.literal('cursor'),
      cursorParam: name.default('cursor'),
      next: name,
      sizeParam: name.default('limit'),
      size: pageSize,
    })
    .strict(),
  z.object({ type: z.literal('link') }).strict(),
]);
export const headerEnvSchema = z.union([
  envName,
  z.object({ env: envName, prefix: z.literal('Bearer ').default('Bearer ') }).strict(),
]);
const auth = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bearer'), tokenEnv: envName }).strict(),
  z.object({ type: z.literal('basic'), usernameEnv: envName, passwordEnv: envName }).strict(),
]);
export const sourceSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('rest'),
      label: name.optional(),
      rollup: rollup.optional(),
      where: rowFilterSchema.default({}),
      caseSensitive: z.boolean().default(false),
      ...sourceFormatting,
      unique: z.array(name).default([]),
      baseUrl: httpUrl,
      path: name,
      fields,
      items: name.default('$.data[*]'),
      headers: z
        .record(name, z.string())
        .default({})
        .refine(
          (v) => !Object.keys(v).some((k) => /^(authorization|proxy-authorization|cookie|x-api-key)$/i.test(k)),
          'Use auth or headersEnv for secrets',
        ),
      headersEnv: z.record(name, headerEnvSchema).default({}),
      auth: auth.optional(),
      pagination: pagination.optional(),
      timeoutMs: z.number().int().min(1).max(300000).default(10000),
      retries: z.number().int().min(0).max(10).default(3),
      backoffMs: z.number().int().min(1).max(10000).default(100),
      maxPages: z.number().int().min(1).max(1000000).default(10000),
      maxResponseBytes: z
        .number()
        .int()
        .min(1)
        .max(1024 * 1024 * 1024)
        .default(64 * 1024 * 1024),
    })
    .strict(),
  z
    .object({
      type: z.literal('csv'),
      label: name.optional(),
      rollup: rollup.optional(),
      where: rowFilterSchema.default({}),
      caseSensitive: z.boolean().default(false),
      ...sourceFormatting,
      unique: z.array(name).default([]),
      file: name,
      fields,
      delimiter: z.string().length(1).default(','),
      quote: z.string().length(1).default('"'),
      encoding: z.enum(['utf8', 'utf16le', 'latin1']).default('utf8'),
      headerRow: z.number().int().min(1).default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('xlsx'),
      label: name.optional(),
      rollup: rollup.optional(),
      where: rowFilterSchema.default({}),
      caseSensitive: z.boolean().default(false),
      ...sourceFormatting,
      unique: z.array(name).default([]),
      file: name,
      fields,
      sheet: name,
      headerRow: z.number().int().min(1).default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('ui'),
      label: name.optional(),
      rollup: rollup.optional(),
      where: rowFilterSchema.default({}),
      caseSensitive: z.boolean().default(false),
      ...sourceFormatting,
      unique: z.array(name).default([]),
      url: httpUrl,
      storageState: name.optional(),
      table: name,
      rows: name.default('tbody tr'),
      fields,
      nextPage: name.optional(),
      readySelector: name.optional(),
      allowedOrigins: z
        .array(httpUrl.refine((v) => new URL(v).origin === v, 'Use an origin without a path, query or fragment'))
        .default([]),
      timeoutMs: z.number().int().min(1).max(300000).default(10000),
      maxPages: z.number().int().min(1).max(100000).default(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal('sql'),
      label: name.optional(),
      rollup: rollup.optional(),
      where: rowFilterSchema.default({}),
      caseSensitive: z.boolean().default(false),
      ...sourceFormatting,
      unique: z.array(name).default([]),
      connectionEnv: envName,
      query: name,
      fields,
      params: z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).default([]),
      timeoutMs: z.number().int().min(1).max(300000).default(10000),
      batchSize: z.number().int().min(1).max(10000).default(1000),
    })
    .strict(),
]);
export const ruleSchema = z
  .object({
    type: z.enum(['string', 'number', 'money', 'datetime', 'enum']),
    allowCurrencySymbol: z.boolean().default(false),
    negativeParentheses: z.boolean().default(false),
    format: z.union([name, z.record(name, name)]).optional(),
    allowNumber: z.boolean().default(false),
    caseFold: z.boolean().default(false),
    emptyAsNull: z.boolean().default(true),
    locale: locale.optional(),
    numberFormat: numberFormat.optional(),
    currencyField: name.optional(),
    round: z.enum(['half-up', 'half-even']).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    tolerance: z.number().finite().nonnegative().default(0),
    toleranceSeconds: z.number().finite().nonnegative().default(0),
    sourceTimezones: z.record(name, timezone).default({}),
    map: z.record(z.string(), z.string()).default({}),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'money' && !v.currency)
      ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Money requires a currency (e.g. USD)' });
    if (v.type === 'money' && !Number.isSafeInteger(v.tolerance))
      ctx.addIssue({
        code: 'custom',
        path: ['tolerance'],
        message: 'Money tolerance must be an integer in minor units',
      });
  });
const where = rowFilterSchema.default({});
export const aggregateSchema = z.discriminatedUnion('type', [
  z
    .object({
      name,
      label: name.optional(),
      type: z.literal('count'),
      where,
      tolerance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    })
    .strict(),
  z
    .object({
      name,
      label: name.optional(),
      type: z.literal('sum'),
      field: name,
      where,
      tolerance: z.number().finite().nonnegative().default(0),
    })
    .strict(),
]);
const category = z.enum(findingCategories);
export const failOnSchema = z
  .union([z.array(category), z.partialRecord(category, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))])
  .default([...findingCategories]);
export const entitySchema = z
  .object({
    name,
    label: name.optional(),
    pluralLabel: name.optional(),
    key: keySchema,
    sources: z.record(name, sourceSchema),
    compare: z.record(name, ruleSchema).default({}),
    aggregates: z.array(aggregateSchema).default([]),
    failOn: failOnSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.keys(v.sources).length < 2)
      ctx.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Configure at least two sources; the first is the reference',
      });
    for (const [source, config] of Object.entries(v.sources)) {
      if (keyFields(v.key).some((field) => !Object.hasOwn(config.fields, field)))
        ctx.addIssue({
          code: 'custom',
          path: ['sources', source, 'fields'],
          message: `Map the entity key ${keyFields(v.key).join(', ')}`,
        });
    }
    for (const [source, config] of Object.entries(v.sources)) {
      for (const field of [
        ...Object.keys(config.where),
        ...Object.keys(config.rollup?.where ?? {}),
        ...config.unique,
        ...(config.currencyField ? [config.currencyField] : []),
        ...Object.values(v.compare).flatMap((rule) => (rule.currencyField ? [rule.currencyField] : [])),
      ])
        if (!Object.hasOwn(config.fields, field))
          ctx.addIssue({
            code: 'custom',
            path: ['sources', source],
            message: `Map filter or uniqueness field ${field}`,
          });
    }
    for (const [source, config] of Object.entries(v.sources))
      if (config.rollup) {
        const r = config.rollup;
        const fields = new Set([
          ...keyFields(r.by),
          ...r.sum,
          ...r.first,
          ...(r.duplicates?.by ?? []),
          ...Object.keys(config.where),
          ...Object.keys(r.where),
          ...(config.currencyField ? [config.currencyField] : []),
          ...Object.values(v.compare).flatMap((rule) => (rule.currencyField ? [rule.currencyField] : [])),
        ]);
        if (r.duplicates && keyFields(r.by).some((field) => !r.duplicates?.by.includes(field)))
          ctx.addIssue({
            code: 'custom',
            path: ['sources', source, 'rollup', 'duplicates', 'by'],
            message: 'Duplicate identity must include the rollup key',
          });
        if (JSON.stringify(keyFields(r.by)) !== JSON.stringify(keyFields(v.key)))
          ctx.addIssue({
            code: 'custom',
            path: ['sources', source, 'rollup', 'by'],
            message: 'Rollup by must match the entity key',
          });
        for (const field of new Set([...fields, ...Object.keys(config.fields)]))
          if (!fields.has(field) || !Object.hasOwn(config.fields, field))
            ctx.addIssue({
              code: 'custom',
              path: ['sources', source, 'rollup'],
              message: `Mapped field ${field} must appear in rollup by, sum, first, duplicates.by or where`,
            });
        for (const field of config.unique)
          if (![...keyFields(r.by), ...r.first].includes(field))
            ctx.addIssue({
              code: 'custom',
              path: ['sources', source, 'unique'],
              message: `Unique field ${field} must be retained in rollup by or first`,
            });
        for (const field of r.sum)
          if (!['money', 'number'].includes(v.compare[field]?.type ?? ''))
            ctx.addIssue({
              code: 'custom',
              path: ['sources', source, 'rollup', 'sum'],
              message: `Rollup sum field ${field} requires a number or money rule`,
            });
      }
    for (const [source, config] of Object.entries(v.sources)) {
      const filters = [config.where, config.rollup?.where ?? {}, ...v.aggregates.map((item) => item.where)];
      for (const filter of filters)
        for (const [field, condition] of Object.entries(filter)) {
          const choice =
            condition !== null && typeof condition === 'object' && !Array.isArray(condition)
              ? condition.not
              : condition;
          for (const value of Array.isArray(choice) ? choice : [choice]) {
            try {
              normalize(value, sourceRule(v.compare[field], config), source);
            } catch {
              ctx.addIssue({
                code: 'custom',
                path: ['sources', source, 'where', field],
                message: `Filter value must match the ${v.compare[field]?.type ?? 'string'} field type`,
              });
            }
          }
        }
    }
    const reference = Object.values(v.sources)[0];
    const names = new Set<string>();
    for (const [index, aggregate] of v.aggregates.entries()) {
      const path = ['aggregates', index];
      if (names.has(aggregate.name))
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'name'],
          message: 'Aggregate names must be unique within an entity',
        });
      names.add(aggregate.name);
      for (const field of [...Object.keys(aggregate.where), ...(aggregate.type === 'sum' ? [aggregate.field] : [])]) {
        if (!reference || !Object.hasOwn(reference.fields, field))
          ctx.addIssue({ code: 'custom', path, message: `Map aggregate field ${field} in the reference source` });
      }
      if (aggregate.type === 'sum') {
        const rule = v.compare[aggregate.field];
        if (!rule || !['number', 'money'].includes(rule.type))
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'field'],
            message: 'Sum requires a number or money comparison rule for its field',
          });
        if (rule?.type === 'money' && !Number.isSafeInteger(aggregate.tolerance))
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'tolerance'],
            message: 'Money aggregate tolerance must be an integer in minor units',
          });
      }
    }
  });
export const configSchema = z
  .object({
    version: z.literal(1),
    maxInvalidRows: z.number().int().min(0).max(1000000).default(50),
    publicEnv: z.array(envName).default([]),
    secretEnv: z.array(envName).default([]),
    allowedHosts: z
      .array(name.refine(validAllowedHost, 'Use host or host:port without a URL scheme or path'))
      .min(1)
      .optional(),
    patterns: z
      .object({ minCount: z.number().int().min(3).default(3) })
      .strict()
      .default({ minCount: 3 }),
    environment: z.enum(['test', 'staging']).default('test'),
    entities: z.array(entitySchema).min(1),
    variables: z.record(name, z.string()).default({}),
    report: z
      .object({
        outputs: z
          .array(z.enum(['console', 'html', 'junit', 'json', 'markdown']))
          .min(1)
          .default(['console', 'json']),
        displayTimezone: name
          .refine((value) => {
            try {
              new Intl.DateTimeFormat('en-US', { timeZone: value });
              return true;
            } catch {
              return false;
            }
          }, 'Use a valid IANA timezone')
          .default('UTC'),
        dir: name.default('./logiparity-report'),
      })
      .strict()
      .default({ outputs: ['console', 'json'], dir: './logiparity-report', displayTimezone: 'UTC' }),
  })
  .strict()
  .refine((v) => new Set(v.entities.map((e) => e.name)).size === v.entities.length, 'Entity names must be unique');
export type SourceConfig = z.infer<typeof sourceSchema>;
export type RestConfig = Extract<SourceConfig, { type: 'rest' }>;
export type FileConfig = Extract<SourceConfig, { type: 'csv' | 'xlsx' }>;
export type UiConfig = Extract<SourceConfig, { type: 'ui' }>;
export type SqlConfig = Extract<SourceConfig, { type: 'sql' }>;
export type ComparisonRule = z.infer<typeof ruleSchema>;
export type EntityConfig = z.infer<typeof entitySchema>;
export type AggregateConfig = z.infer<typeof aggregateSchema>;
export type Config = z.infer<typeof configSchema>;
export interface LoadedConfig {
  config: Config;
  baseDir: string;
  file: string;
  secrets: string[];
  referencedEnv: string[];
  missingEnv: string[];
  warnings: string[];
}
export interface LoadOptions {
  allowMissingEnv?: boolean;
  command?: 'validate' | 'check' | 'scenario';
}

export class ConfigError extends Error {}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadYaml(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
  options: LoadOptions = {},
): Promise<unknown> {
  const absolute = resolve(file);
  let content: string;
  try {
    content = await readFile(absolute, 'utf8');
  } catch {
    throw new ConfigError(
      redactSecrets(
        `${absolute}: cannot read configuration; check the file path and permissions.`,
        secretValues(undefined, env),
      ),
    );
  }
  const doc = parseDocument(content, { uniqueKeys: true });
  if (doc.errors.length)
    throw new ConfigError(`${absolute}: ${doc.errors.map((e) => e.message).join('; ')} Fix the YAML syntax.`);
  let raw: unknown;
  try {
    raw = doc.toJS({ maxAliasCount: 50 });
  } catch {
    throw new ConfigError(`${absolute}: too many YAML aliases; use a plain configuration.`);
  }
  const secrets = secretValues(raw, env);
  const references = referencedEnvironment(raw);
  let missingSubstitution = false;
  const walk = (value: unknown, field = ''): unknown => {
    if (typeof value === 'string')
      return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => {
        const item = Object.hasOwn(env, key) ? env[key] : undefined;
        if (!item) {
          missingSubstitution = true;
          return field === 'baseUrl' || field === 'url' || /URL$/i.test(key)
            ? 'https://missing-env.invalid'
            : 'LOGIPARITY_MISSING_ENV';
        }
        return item;
      });
    if (Array.isArray(value)) return value.map((item) => walk(item, field));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, key)]));
    return value;
  };
  raw = walk(raw);
  rememberEnvironment(raw, { secrets, references });
  if (missingSubstitution && !options.allowMissingEnv) validateEnvironment(raw, env, options, absolute);
  return raw;
}

export async function loadConfig(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
  options: LoadOptions = {},
): Promise<LoadedConfig> {
  const absolute = resolve(file);
  let raw = await loadYaml(absolute, env, options);
  if (raw && typeof raw === 'object' && 'allowMutations' in raw && 'state' in raw)
    throw new ConfigError(
      'This is a scenario target. Use logiparity scenario validate <scenario.yaml> --target <target.yaml>.',
    );
  const references = referencedEnvironment(raw);
  const secrets = secretValues(raw, env);
  const location = redactSecrets(absolute, secrets);
  const walk = (value: unknown, transform: (s: string) => string): unknown => {
    if (typeof value === 'string') return transform(value);
    if (Array.isArray(value)) return value.map((v) => walk(v, transform));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, transform)]));
    return value;
  };
  const vars = raw && typeof raw === 'object' && 'variables' in raw ? raw.variables : {};
  raw = walk(raw, (s) =>
    s.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, key: string) => {
      if (!vars || typeof vars !== 'object' || !Object.hasOwn(vars, key))
        throw new ConfigError(`${location}: variables.${key} is missing; define the template variable.`);
      const value: unknown = Reflect.get(vars, key);
      if (typeof value !== 'string') throw new ConfigError(`${location}: variables.${key} must be a quoted string.`);
      return value;
    }),
  );
  const result = configSchema.safeParse(raw);
  if (!result.success)
    throw new ConfigError(
      redactSecrets(
        `${absolute}: invalid configuration:\n${formatConfigIssues(configSchema, raw, result.error)}\nFix the listed configuration paths.`,
        secrets,
      ),
    );
  rememberEnvironment(result.data, { secrets, references });
  const missingEnv = validateEnvironment(result.data, env, options, absolute);
  return {
    config: result.data,
    baseDir: dirname(absolute),
    file: absolute,
    secrets: secretValues(result.data, env),
    referencedEnv: referencedEnvironment(result.data),
    missingEnv,
    warnings: shortSecretWarnings(result.data, env),
  };
}

export function validateEnvironment(
  value: unknown,
  env: NodeJS.ProcessEnv,
  options: LoadOptions = {},
  location = 'Configuration',
): string[] {
  const names = referencedEnvironment(value);
  const missing = names.filter((name) => !Object.hasOwn(env, name) || !env[name]);
  if (missing.length && !options.allowMissingEnv)
    throw new ConfigError(
      redactSecrets(
        `${location}: environment variable${missing.length === 1 ? '' : 's'} ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or empty; set every referenced variable${options.command === 'validate' ? ' or use validate --allow-missing-env' : ''}.`,
        secretValues(value, env),
      ),
    );
  return missing;
}

/** Report unknown properties using the public Zod schema shape, including selected unions. */
export function formatConfigIssues(schema: z.ZodType, raw: unknown, error: z.ZodError): string {
  const unwrap = (input: z.ZodType, value: unknown, key?: PropertyKey): z.ZodType => {
    if (input instanceof z.ZodDefault || input instanceof z.ZodOptional || input instanceof z.ZodNullable) {
      const inner = input.unwrap();
      return inner instanceof z.ZodType ? unwrap(inner, value, key) : input;
    }
    if (input instanceof z.ZodUnion) {
      const options = input.options.filter((option): option is z.ZodType => option instanceof z.ZodType);
      const chosen =
        options.find(
          (option) =>
            option instanceof z.ZodObject &&
            value &&
            typeof value === 'object' &&
            option.shape.type instanceof z.ZodType &&
            option.shape.type.safeParse(Reflect.get(value, 'type')).success,
        ) ??
        options.find(
          (option) => option instanceof z.ZodObject && key !== undefined && Object.hasOwn(option.shape, key),
        ) ??
        options.find((option) => option instanceof z.ZodObject && option.loose().safeParse(value).success);
      return chosen ? unwrap(chosen, value, key) : input;
    }
    return input;
  };
  return error.issues
    .map((issue) => {
      let current = schema;
      let value = raw;
      for (const key of issue.path) {
        current = unwrap(current, value, key);
        const next =
          current instanceof z.ZodObject
            ? (current.shape[String(key)] as unknown)
            : current instanceof z.ZodArray
              ? current.element
              : current instanceof z.ZodRecord
                ? current.valueType
                : undefined;
        if (!(next instanceof z.ZodType)) break;
        current = next;
        value = value && typeof value === 'object' ? Reflect.get(value, key) : undefined;
      }
      current = unwrap(current, value);
      const keys = current instanceof z.ZodObject ? Object.keys(current.shape).sort() : [];
      return `  ${issue.path.join('.') || '<root>'}: ${issue.message}${issue.code === 'unrecognized_keys' && keys.length ? `. Valid keys: ${keys.join(', ')}` : ''}`;
    })
    .join('\n');
}

export type FieldMapping = z.infer<typeof fieldSchema>;
export const fieldPath = (field: FieldMapping): string => (typeof field === 'string' ? field : field.path);
export const fieldPaths = (fields: Record<string, FieldMapping>): Record<string, string> =>
  Object.fromEntries(Object.entries(fields).map(([name, mapping]) => [name, fieldPath(mapping)]));

export function keyFields(key: string | readonly string[]): readonly string[] {
  return typeof key === 'string' ? [key] : key;
}
export type RowFilter = z.infer<typeof rowFilterSchema>;
