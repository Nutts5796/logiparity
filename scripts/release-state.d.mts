export type Runner = (command: string, args: string[]) => Promise<{ stdout: string }>;
export function integrity(bytes: Uint8Array): string;
export function verifyChecksum(bytes: Uint8Array, checksum: string, name: string): void;
export function verifyExistingAssets(local: Record<string, Buffer>, remote: Record<string, Buffer>): void;
export function githubRelease(options: {
  tag: string;
  version: string;
  directory: string;
  run: Runner;
  requireExisting?: boolean;
}): Promise<'existing' | 'created'>;
export function npmRelease(options: {
  version: string;
  archive: string;
  run: Runner;
  requireExisting?: boolean;
}): Promise<'existing' | 'published'>;
