import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LineCounter, parseDocument } from 'yaml';

export const maxInputBytes = 16 * 1024 * 1024;
export function parseStructured(content: string, label: string): unknown {
  const lines = new LineCounter();
  const doc = parseDocument(content, { uniqueKeys: true, lineCounter: lines });
  const error = doc.errors[0];
  if (error) {
    const position = lines.linePos(error.pos[0]);
    throw new Error(
      `${label}:${position.line}:${position.col}: invalid YAML/JSON (${error.code}); fix the syntax and duplicate keys. Input content is omitted.`,
    );
  }
  try {
    const value: unknown = doc.toJS({ maxAliasCount: 50 });
    JSON.stringify(value, (_, child: unknown) => {
      if (typeof child === 'bigint' || (typeof child === 'number' && !Number.isFinite(child)))
        throw new Error('non-JSON');
      return child;
    });
    return value;
  } catch {
    throw new Error(
      `${label}: excessive/cyclic YAML aliases or non-JSON values; use a plain finite JSON-compatible document.`,
    );
  }
}
export async function readStructured(file: string): Promise<unknown> {
  const absolute = resolve(file);
  let content: string;
  try {
    const metadata = await stat(absolute);
    if (!metadata.isFile() || metadata.size > maxInputBytes) throw new Error('size');
    content = await readFile(absolute, 'utf8');
  } catch {
    throw new Error(
      `${absolute}: cannot read AI input; use an existing regular file up to 16 MiB and check permissions.`,
    );
  }
  if (Buffer.byteLength(content) > maxInputBytes)
    throw new Error(`${absolute}: AI input exceeds 16 MiB; reduce the document before retrying.`);
  return parseStructured(content, absolute);
}
