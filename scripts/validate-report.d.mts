export function assertReport(value: unknown): void;
export function parseCheckedJson(...args: Parameters<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
export function checkedReport<T>(pending: Promise<T>): Promise<T>;
