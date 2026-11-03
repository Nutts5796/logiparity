import { lstat, open, rename, rm } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicReportFile(
  destination: string,
  content: string | AsyncIterable<Uint8Array>,
  options: { mode?: number; maxBytes?: number } = {},
): Promise<void> {
  const existing = await lstat(destination).catch((error: unknown) => {
    if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return undefined;
    throw error;
  });
  if (existing?.isSymbolicLink()) throw new Error('Refusing a symlink report destination.');
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    const mode = options.mode ?? 0o600;
    const handle = await open(temporary, 'wx', mode);
    try {
      await handle.chmod(mode);
      const limit = options.maxBytes ?? Number.POSITIVE_INFINITY;
      if (typeof content === 'string') {
        if (Buffer.byteLength(content) > limit) throw new Error('File exceeds its byte limit.');
        await handle.writeFile(content, 'utf8');
      } else {
        let bytes = 0;
        for await (const chunk of content) {
          bytes += chunk.byteLength;
          if (bytes > limit)
            throw new Error(`Artifact exceeds maxBytes (${(limit / (1024 * 1024)).toLocaleString('en-US')} MiB).`);
          await handle.writeFile(chunk);
        }
      }
    } finally {
      await handle.close();
    }
    // Rename replaces the directory entry, so a raced symlink is never followed.
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
