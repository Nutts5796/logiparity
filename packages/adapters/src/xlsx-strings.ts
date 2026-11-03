import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cacheLimit = 2 * 1024 * 1024;
const blockSize = 64 * 1024;

// Store both text and its fixed-width offset index on disk. Only a bounded LRU and one index block stay in RAM.
export class SharedStrings {
  private pending: Buffer[] = [];
  private indexes: Buffer[] = [];
  private pendingBytes = 0;
  private offset = 0;
  private count = 0;
  private cache = new Map<number, { value: string; bytes: number }>();
  private cacheBytes = 0;
  private indexBlock = Buffer.alloc(0);
  private indexStart = -1;
  private constructor(private directory: string, private data: FileHandle, private index: FileHandle) {}
  static async create(): Promise<SharedStrings> {
    const directory = await mkdtemp(join(tmpdir(), 'logiparity-xlsx-'));
    try { return new SharedStrings(directory, await open(join(directory, 'strings'), 'w+'), await open(join(directory, 'index'), 'w+')); }
    catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
  async add(value: string): Promise<void> {
    const bytes = Buffer.from(value);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('An XLSX shared string exceeds the 8 MiB cell limit.');
    const index = Buffer.alloc(16); index.writeBigUInt64LE(BigInt(this.offset)); index.writeUInt32LE(bytes.length, 8);
    this.pending.push(bytes); this.indexes.push(index); this.pendingBytes += bytes.length; this.offset += bytes.length; this.count++;
    if (this.pendingBytes >= blockSize || this.indexes.length * 16 >= blockSize) await this.flush();
  }
  async flush(): Promise<void> {
    if (!this.indexes.length) return;
    await this.data.writeFile(Buffer.concat(this.pending));
    await this.index.writeFile(Buffer.concat(this.indexes));
    this.pending = []; this.indexes = []; this.pendingBytes = 0;
  }
  async get(id: number): Promise<string> {
    if (!Number.isSafeInteger(id) || id < 0 || id >= this.count) throw new Error(`Invalid XLSX shared string index ${id}.`);
    const cached = this.cache.get(id);
    if (cached) { this.cache.delete(id); this.cache.set(id, cached); return cached.value; }
    const position = id * 16;
    if (position < this.indexStart || position + 16 > this.indexStart + this.indexBlock.length) {
      this.indexStart = Math.floor(position / blockSize) * blockSize;
      const buffer = Buffer.alloc(blockSize);
      const {bytesRead} = await this.index.read(buffer, 0, buffer.length, this.indexStart);
      this.indexBlock = buffer.subarray(0, bytesRead);
    }
    const record = this.indexBlock.subarray(position - this.indexStart, position - this.indexStart + 16);
    if (record.length !== 16) throw new Error('Truncated XLSX shared string index.');
    const start = Number(record.readBigUInt64LE()); const length = record.readUInt32LE(8);
    const bytes = Buffer.alloc(length); let read = 0;
    while (read < length) { const result = await this.data.read(bytes, read, length - read, start + read); if (!result.bytesRead) throw new Error('Truncated XLSX shared string data.'); read += result.bytesRead; }
    const value = bytes.toString('utf8');
    const size = length + 64;
    if (size <= cacheLimit) {
      while (this.cacheBytes + size > cacheLimit) { const first = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(first)!.bytes; this.cache.delete(first); }
      this.cache.set(id, {value, bytes:size}); this.cacheBytes += size;
    }
    return value;
  }
  async close(): Promise<void> {
    try { await Promise.all([this.data.close(), this.index.close()]); }
    finally { await rm(this.directory, { recursive: true, force: true }); }
  }
}
