import type { Finding } from './types.js';
export function keyText(key: string, parts?: readonly string[]): string {
  return parts ? parts.join(' · ') : key;
}
export function findingKey(finding: Finding): string {
  return keyText(finding.key, finding.keyParts);
}
