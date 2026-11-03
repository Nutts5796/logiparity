import { lstat, open, rename, rm } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicReportFile(destination: string, content: string): Promise<void> {
  const existing = await lstat(destination).catch((error: unknown) => {
    if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return undefined;
    throw error;
  });
  if (existing?.isSymbolicLink()) throw new Error('Refusing a symlink report destination.');
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    // Rename replaces the directory entry, so a raced symlink is never followed.
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
