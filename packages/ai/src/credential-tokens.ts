import { isSecretName, normalizedSecretName } from '@logiparity/core';
const masked = '[REDACTED]';
const decoded = (text: string) => {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return text;
  }
};
function quotedEnd(text: string, start: number): number {
  const quote = text[start];
  let end = start + 1;
  while (end < text.length) {
    if (text[end] === '\\') end += 2;
    else if (text[end++] === quote) break;
  }
  return end;
}
function valueEnd(text: string, start: number, header = false): number {
  if (text[start] === '"' || text[start] === "'") return quotedEnd(text, start);
  let end = start;
  while (end < text.length && !(header ? /[\r\n"'<>}]/ : /[\s,;&#?<>}"']/).test(text[end] ?? '')) end++;
  return end;
}
// Scan names and their values as tokens. Preserve delimiters and quotes so
// scrubbing JSON twice remains valid JSON and cannot turn a mask into a key.
export function redactCredentialTokens(input: string, collect: (...values: string[]) => void): string {
  const text = input.replace(/\p{Cf}/gu, '');
  let output = '',
    index = 0;
  const mask = (value: string) => {
    if (!value.includes(masked)) collect(value, decoded(value));
    return masked;
  };
  while (index < text.length) {
    const rest = text.slice(index);
    const url = rest.match(/^[a-z][a-z0-9+.-]*:\/\/[^/\s?#"'<>]*@/i);
    if (url) {
      const scheme = url[0].indexOf('://') + 3;
      const userinfo = url[0].slice(scheme, -1),
        colon = userinfo.indexOf(':');
      if (colon >= 0) {
        mask(userinfo.slice(0, colon));
        mask(userinfo.slice(colon + 1));
        output += url[0].slice(0, scheme) + masked + ':' + masked + '@';
      } else output += url[0].slice(0, scheme) + mask(userinfo) + '@';
      index += url[0].length;
      continue;
    }
    const userFlag = rest.match(/^(?:-u|--user)(?:\s+|=)/);
    if (userFlag && (index === 0 || /\s/.test(text[index - 1] ?? ''))) {
      const start = index + userFlag[0].length,
        end = valueEnd(text, start);
      const quote = /["']/.test(text[start] ?? '') ? (text[start] ?? '') : '';
      const credentials = text.slice(start + quote.length, end - quote.length),
        colon = credentials.indexOf(':');
      output +=
        userFlag[0] +
        quote +
        (colon >= 0 ? credentials.slice(0, colon) + ':' + mask(credentials.slice(colon + 1)) : mask(credentials)) +
        quote;
      index = end;
      continue;
    }
    const nameToken = rest.match(
      /^(?:(["'])([A-Za-z_][A-Za-z0-9_.-]*)\1|([A-Za-z_][A-Za-z0-9_.%-]*))([ \t]*[=:][ \t]*)/,
    );
    if (nameToken) {
      const name = normalizedSecretName(decoded(nameToken[2] ?? nameToken[3] ?? ''));
      if (
        isSecretName(name) ||
        name === 'bearer' ||
        (['key', 'sig'].includes(name) && /[?&#]/.test(text[index - 1] ?? ''))
      ) {
        const start = index + nameToken[0].length,
          header = /^(?:proxyauthorization|authorization|cookie|setcookie|wwwauthenticate)$/.test(name);
        let end = valueEnd(text, start, header);
        if (header && !/["']/.test(text[start] ?? '')) {
          const outer = text[index - 1];
          end = outer === '"' || outer === "'" ? quotedEnd(text, index - 1) - 1 : text.indexOf('\n', start);
          if (end < start) end = text.length;
        }
        const quote = /["']/.test(text[start] ?? '') ? (text[start] ?? '') : '';
        const value = text.slice(start + quote.length, end - quote.length);
        if (header) {
          const credential = value.match(/^\S+\s+(.+)$/)?.[1];
          if (credential) collect(credential, decoded(credential));
          for (const token of value.matchAll(/=(["'])(.*?)\1/g)) if (token[2]) collect(token[2]);
        }
        const scheme = /^(?:proxyauthorization|authorization)$/.test(name)
          ? (value.match(/^([A-Za-z][A-Za-z0-9.+-]*\s+)/)?.[1] ?? '')
          : '';
        output += nameToken[0] + quote + scheme + mask(value) + quote;
        index = end;
        continue;
      }
      // Leave a non-secret key intact, but continue scanning its value: it may
      // itself contain nested JSON, URLs or another credential pair.
      output += nameToken[0];
      index += nameToken[0].length;
      continue;
    }
    const scheme = rest.match(/^(Bearer|Digest)[ \t]+/i);
    if (scheme && (index === 0 || /[\s:]/.test(text[index - 1] ?? ''))) {
      const start = index + scheme[0].length,
        end = valueEnd(text, start, scheme[1]?.toLowerCase() === 'digest');
      output += scheme[0] + mask(text.slice(start, end));
      index = end;
      continue;
    }
    const word = rest.match(/^[A-Za-z0-9_.%-]+/)?.[0];
    if (word) {
      output += word;
      index += word.length;
    } else output += text[index++];
  }
  return output;
}
