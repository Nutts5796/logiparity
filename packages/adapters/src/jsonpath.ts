// Deliberately non-evaluating JSONPath subset. No scripts, filters or recursive descent.
export function selectJson(value: unknown, path: string): unknown[] {
  if (!path.startsWith('$')) throw new Error(`Invalid JSONPath ${path}; start with $.`);
  const tokens: string[] = [];
  const rest = path.slice(1);
  const pattern = /\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+|\*)\]|\['([^']+)'\]|\["([^"]+)"\]/gy;
  let offset = 0;
  while (offset < rest.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(rest);
    if (!match)
      throw new Error(`Unsupported JSONPath ${path}; use properties, quoted properties, array indexes and [*].`);
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
    offset = pattern.lastIndex;
  }
  let nodes: unknown[] = [value];
  for (const token of tokens) {
    nodes = nodes.flatMap((node) => {
      if (token === '*') {
        if (!Array.isArray(node))
          throw new Error(`JSONPath ${path}: [*] requires an array; correct the extraction path.`);
        return node as unknown[];
      }
      if (!node || typeof node !== 'object' || !Object.hasOwn(node, token))
        throw new Error(`JSONPath ${path}: property ${token} is missing; correct the field mapping.`);
      return [Reflect.get(node, token) as unknown];
    });
  }
  return nodes;
}

export function selectOne(value: unknown, path: string): unknown {
  const nodes = selectJson(value, path);
  if (nodes.length !== 1) throw new Error(`JSONPath ${path} selected ${nodes.length} values; map exactly one scalar.`);
  return nodes[0];
}
