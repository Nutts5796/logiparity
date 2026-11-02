import { parse } from 'pgsql-ast-parser';

const readStatements = new Set(['select', 'with', 'with recursive', 'union', 'union all']);
const forbiddenStatements = new Set(['insert', 'update', 'delete', 'truncate table', 'copy', 'show', 'prepare', 'deallocate', 'do', 'explain', 'refresh materialized view', 'values', 'begin', 'start transaction', 'commit', 'rollback', 'raise', 'set', 'set timezone', 'set names', 'tablespace']);
// Deliberately small, documented read-only builtin function surface. Custom and
// operational functions (set_config, nextval, dblink, pg_* administration) fail closed.
const sqlFunctions = new Set(['count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'greatest', 'least', 'lower', 'upper', 'trim', 'btrim', 'ltrim', 'rtrim', 'length', 'char_length', 'concat', 'concat_ws', 'substring', 'replace', 'round', 'abs', 'ceil', 'ceiling', 'floor', 'date_trunc', 'to_char', 'extract', 'current_setting', 'generate_series', 'row_number', 'rank', 'dense_rank']);

export function validateReadOnlySql(query: string): void {
  let statements: unknown[];
  try { statements = parse(query); }
  catch { throw new Error('SQL is not a supported single SELECT or WITH ... SELECT; correct the syntax and remove writes, SELECT INTO and unsupported SQL constructs.'); }
  if (statements.length !== 1 || !statements[0] || typeof statements[0] !== 'object' || !('type' in statements[0]) || !readStatements.has(String(statements[0].type))) throw new Error('SQL source requires exactly one SELECT or WITH ... SELECT statement; remove other statements.');
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const child of value) walk(child); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    const type = typeof node.type === 'string' ? node.type : '';
    if (forbiddenStatements.has(type) || /^(create|alter|drop|set) /.test(type)) throw new Error(`SQL contains a forbidden ${type} operation; every CTE and subquery must be read-only SELECT.`);
    if (type === 'select' && (node.for || node.into)) throw new Error('SQL SELECT INTO and row-locking clauses are forbidden; remove INTO/FOR UPDATE/FOR SHARE.');
    if (type === 'call') {
      const fn = node.function as { name?: unknown; schema?: unknown } | undefined;
      if (!fn || typeof fn.name !== 'string' || !sqlFunctions.has(fn.name) || (fn.schema !== undefined && fn.schema !== 'pg_catalog')) throw new Error('SQL calls a function outside the read-only builtin allowlist; use documented builtin functions, not custom/operational functions.');
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(statements[0]);
}
