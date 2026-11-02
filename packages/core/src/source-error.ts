export class SourceError extends Error {
  readonly screenshot?: string;
  constructor(message: string, screenshot?: string) {
    super(message);
    if (screenshot !== undefined) this.screenshot = screenshot;
  }
}
