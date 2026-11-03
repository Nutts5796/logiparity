import type { Finding, Report } from './types.js';
const budgets = new WeakMap<Report, number>();
export class FindingsLimitError extends Error {}
export function limitFindings(report: Report, limit: number): void {
  budgets.set(report, limit);
}
export function appendFinding(report: Report, finding: Finding): void {
  const limit = budgets.get(report) ?? 10000;
  if (report.findings.length >= limit)
    throw new FindingsLimitError(
      `Report truncated at maxFindings (${limit}). Reduce the export or increase the reviewed limit.`,
    );
  report.findings.push(finding);
}
