import { jsonPathTokens } from './jsonpath.js';

type Frame = { kind: 'array' | 'object'; path: string[]; key: string; index: number; expectsKey: boolean };
/** Count selected rows while the response is still bytes, before JSON.parse can
 * allocate millions of objects. Syntax validation remains JSON.parse's job. */
export class JsonRowLimit {
  private readonly tokens: string[];
  private readonly stack: Frame[] = [];
  private rows = 0;
  private inString = false;
  private escaped = false;
  private keyText: string | undefined;
  private scalar = false;
  constructor(
    path: string,
    private readonly limit: number,
    private readonly message: string,
  ) {
    this.tokens = jsonPathTokens(path);
    if (this.tokens.at(-1) !== '*') this.tokens.push('*');
  }
  private valuePath(): string[] {
    const parent = this.stack.at(-1);
    if (!parent) return [];
    if (parent.kind === 'array') return [...parent.path, String(parent.index++)];
    return [...parent.path, parent.key];
  }
  private beginValue(): string[] {
    const path = this.valuePath();
    if (
      this.tokens.length === path.length &&
      this.tokens.every((token, index) => token === '*' || token === path[index])
    ) {
      if (++this.rows > this.limit) throw new Error(this.message);
    }
    return path;
  }
  consume(text: string): void {
    for (const char of text) {
      if (this.inString) {
        if (this.keyText !== undefined) {
          this.keyText += char;
          if (this.keyText.length > 256 * 1024) throw new Error('JSON object key exceeds 256 KiB.');
        }
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') {
          this.inString = false;
          if (this.keyText !== undefined) {
            const parent = this.stack.at(-1);
            if (parent) parent.key = JSON.parse(this.keyText) as string;
            this.keyText = undefined;
          }
        }
        continue;
      }
      if (this.scalar) {
        if (!/[\s,\]}]/.test(char)) continue;
        this.scalar = false;
      }
      if (/\s/.test(char)) continue;
      const parent = this.stack.at(-1);
      if (char === '"') {
        this.inString = true;
        if (parent?.kind === 'object' && parent.expectsKey) this.keyText = '"';
        else this.beginValue();
      } else if (char === '{' || char === '[') {
        const path = this.beginValue();
        if (this.stack.length >= 256) throw new Error('JSON nesting exceeds 256 levels.');
        this.stack.push({ kind: char === '{' ? 'object' : 'array', path, key: '', index: 0, expectsKey: char === '{' });
      } else if (char === '}' || char === ']') this.stack.pop();
      else if (char === ':' && parent) parent.expectsKey = false;
      else if (char === ',' && parent?.kind === 'object') parent.expectsKey = true;
      else if (char !== ',') {
        this.beginValue();
        this.scalar = true;
      }
    }
  }
}
