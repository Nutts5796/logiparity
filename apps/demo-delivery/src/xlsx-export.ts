import { deflateRawSync } from 'node:zlib';
const crcTable = Array.from({ length: 256 }, (_, number) => {
  let value = number;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 255] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const filename = Buffer.from(name),
      data = Buffer.from(contents),
      compressed = deflateRawSync(data),
      checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const index = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
const xml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// This small writer serves only the fixed-size synthetic demo. Production XLSX ingestion stays streaming.
export function demoWorkbook(rows: readonly string[][]): Buffer {
  const sheet = rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row.map((value, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`,
    )
    .join('');
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Shipments" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  });
}
