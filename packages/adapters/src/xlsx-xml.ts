import { XmlBudget, xlsxLimits } from './xlsx-limits.js';
import { StringDecoder } from 'node:string_decoder';
import { SaxesParser } from 'saxes';
import type unzipper from 'unzipper';

export type XmlEvent =
  | { type: 'open'; name: string; attributes: Record<string, string> }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string };
const local = (name: string) => name.slice(name.lastIndexOf(':') + 1);

// Drain one ZIP chunk at a time so neither XML events nor worksheet rows grow with the workbook.
export async function* xmlEvents(entry: unzipper.File): AsyncIterable<XmlEvent> {
  if (entry.uncompressedSize > xlsxLimits.xmlBytes)
    throw new Error('XLSX XML exceeds the 128 MiB decompression quota.');
  if (entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * xlsxLimits.compressionRatio))
    throw new Error('XLSX decompression ratio exceeds 200:1.');
  const budget = new XmlBudget(entry.compressedSize);
  const stream = entry.stream();
  const parser = new SaxesParser();
  const decoder = new StringDecoder('utf8');
  let events: XmlEvent[] = [];
  parser.on('opentag', (tag) => events.push({ type: 'open', name: local(tag.name), attributes: tag.attributes }));
  parser.on('closetag', (tag) => events.push({ type: 'close', name: local(tag.name) }));
  parser.on('text', (text) => events.push({ type: 'text', text }));
  parser.on('cdata', (text) => events.push({ type: 'text', text }));
  parser.on('doctype', () => {
    throw new Error('XLSX XML must not contain a DOCTYPE declaration.');
  });
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      const decoded = decoder.write(buffer);
      budget.consume(decoded, buffer.length);
      parser.write(decoded);
      yield* events;
      events = [];
    }
    parser.write(decoder.end()).close();
    yield* events;
  } finally {
    stream.destroy();
  }
}
