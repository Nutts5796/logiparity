export function resourceLimitMessage(path: string, limit: number): string {
  const setting = path.split('.').at(-1) ?? path;
  return `${path}: exceeds ${setting} (${limit.toLocaleString('en-US')}). Reduce the export, or raise ${setting} together with Node memory, for example NODE_OPTIONS=--max-old-space-size=6144.`;
}
