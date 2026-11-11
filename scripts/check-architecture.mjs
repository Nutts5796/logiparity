import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../packages/core/src', import.meta.url)));
const levels = {
  foundation: 0,
  values: 1,
  configuration: 2,
  presentation: 3,
  causes: 4,
  reconciliation: 4,
  matching: 5,
  reporters: 6,
};
const compatibility = {
  'human.ts': 'presentation/human.js',
  'money-display.ts': 'presentation/money-display.js',
  'html-patterns.ts': 'reporters/html-patterns.js',
};
const files = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = resolve(path, entry.name);
    if (entry.isDirectory()) await walk(name);
    else if (name.endsWith('.ts')) files.push(name);
  }
}
await walk(root);
const failures = [];
let runtime = 0,
  types = 0;
for (const file of files) {
  const path = relative(root, file).split(sep).join('/'),
    layer = path.split('/')[0];
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  if (!path.includes('/') && path !== 'index.ts') {
    const destination = compatibility[path];
    if (
      !destination ||
      source.statements.length !== 1 ||
      !ts.isExportDeclaration(source.statements[0]) ||
      source.statements[0].moduleSpecifier?.text !== './' + destination
    )
      failures.push(`${path}: root files are index.ts and the three exact compatibility re-exports only`);
  } else if (path.includes('/') && levels[layer] === undefined)
    failures.push(`${path}: declare a concern and its direction before adding a directory`);
  function edge(specifier, typeOnly = false) {
    if (/@logiparity\/|#logiparity\//.test(specifier)) {
      failures.push(`${path}: core must not depend on workspace entry points (${specifier})`);
      return;
    }
    if (!specifier.startsWith('.')) return;
    const destination = relative(root, resolve(dirname(file), specifier))
      .split(sep)
      .join('/');
    if (destination.startsWith('../')) {
      failures.push(`${path}: imports outside core are forbidden (${specifier})`);
      return;
    }
    if (!path.includes('/')) return;
    const target = destination.split('/')[0];
    if (!destination.includes('/')) {
      failures.push(`${path}: import the implementation, not a root compatibility entry (${specifier})`);
      return;
    }
    if (typeOnly) {
      types++;
      return;
    }
    runtime++;
    if (
      levels[target] === undefined ||
      levels[target] > levels[layer] ||
      (levels[target] === levels[layer] && target !== layer)
    )
      failures.push(`${path}: runtime dependency ${destination} points against concern direction`);
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isExportDeclaration(node)
        ? !!node.isTypeOnly
        : !!node.importClause &&
          (node.importClause.isTypeOnly ||
            (!node.importClause.name &&
              ts.isNamedImports(node.importClause.namedBindings) &&
              node.importClause.namedBindings.elements.length > 0 &&
              node.importClause.namedBindings.elements.every((e) => e.isTypeOnly)));
      edge(node.moduleSpecifier.text, typeOnly);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      edge(node.argument.literal.text, true);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]))
        failures.push(`${path}: computed imports cannot be checked`);
      else edge(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (failures.length) throw new Error('Architecture violations:\n' + failures.sort().join('\n'));
console.log(
  `Architecture passed: ${files.length} core files, ${runtime} runtime and ${types} type edges; no reversed runtime or outer-package dependencies.`,
);
