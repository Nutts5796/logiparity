import { rmSync } from 'node:fs';
const directories = new Set<string>();
let listening = false;
const cleanup = () => {
  for (const directory of directories) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      /* Process shutdown cannot await open handles. */
    }
  }
  directories.clear();
};
export function registerXlsxTemp(directory: string): void {
  directories.add(directory);
  if (listening) return;
  listening = true;
  process.once('exit', cleanup);
  for (const [signal, status] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    const existing = process.listenerCount(signal);
    process.once(signal, () => {
      cleanup();
      if (!existing) process.exit(status);
    });
  }
}
export function unregisterXlsxTemp(directory: string): void {
  directories.delete(directory);
}
