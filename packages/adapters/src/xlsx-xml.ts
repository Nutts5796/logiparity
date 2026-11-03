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
      parser.write(decoder.write(chunk as Buffer));
      yield* events;
      events = [];
    }
    parser.write(decoder.end()).close();
    yield* events;
  } finally {
    stream.destroy();
  }
}
