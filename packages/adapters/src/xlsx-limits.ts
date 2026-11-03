// Bounds apply before Saxes can assemble a token and before decompression is consumed.
export const xlsxLimits = {
  xmlBytes: 128 * 1024 * 1024,
  textChars: 256 * 1024,
  tagChars: 32 * 1024,
  cellChars: 1024 * 1024,
  sharedBytes: 64 * 1024 * 1024,
  compressionRatio: 200,
};
export class XmlBudget {
  private inTag = false;
  private quote = '';
  private length = 0;
  private bytes = 0;
  constructor(private compressedBytes: number) {}
  consume(chunk: string, bytes: number): void {
    this.bytes += bytes;
    if (this.bytes > xlsxLimits.xmlBytes) throw new Error('XLSX XML exceeds the 128 MiB decompression quota.');
    if (this.bytes > Math.max(1024 * 1024, this.compressedBytes * xlsxLimits.compressionRatio))
      throw new Error('XLSX decompression ratio exceeds 200:1.');
    for (const character of chunk) {
      if (this.inTag) {
        this.length++;
        if (this.length > xlsxLimits.tagChars) throw new Error('XLSX XML tag or attribute exceeds the 32 KiB limit.');
        if (this.quote) {
          if (character === this.quote) this.quote = '';
        } else if (character === '"' || character === "'") this.quote = character;
        else if (character === '>') {
          this.inTag = false;
          this.length = 0;
        }
      } else if (character === '<') {
        this.inTag = true;
        this.length = 0;
      } else if (++this.length > xlsxLimits.textChars)
        throw new Error('XLSX XML text exceeds the 256 KiB token limit.');
    }
  }
}
