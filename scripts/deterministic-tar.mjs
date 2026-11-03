import { Buffer } from 'node:buffer';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
export async function deterministicArchive(directory, name, destination) {
  const chunks = [];
  const entry = async (relative, folder) => {
    const header = Buffer.alloc(512);
    const full = relative + (folder ? '/' : '');
    const split = full.length > 100 ? full.lastIndexOf('/', full.length - 2) : -1;
    const short = split < 0 ? full : full.slice(split + 1),
      prefix = split < 0 ? '' : full.slice(0, split);
    if (Buffer.byteLength(short) > 100 || Buffer.byteLength(prefix) > 155)
      throw new Error('Offline archive path is too long');
    const content = folder ? Buffer.alloc(0) : await readFile(join(directory, relative.slice(name.length + 1)));
    header.write(short, 0, 100);
    const octal = (value, offset, length) =>
      header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length);
    octal(folder ? 0o755 : 0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(content.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header.write(folder ? '5' : '0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(prefix, 345, 155);
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
    if (folder)
      for (const child of (
        await readdir(join(directory, relative === name ? '' : relative.slice(name.length + 1)), {
          withFileTypes: true,
        })
      ).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        if (!child.isFile() && !child.isDirectory())
          throw new Error('Offline archive only accepts regular files and directories');
        await entry(relative + '/' + child.name, child.isDirectory());
      }
  };
  await entry(name, true);
  chunks.push(Buffer.alloc(1024));
  await writeFile(destination, gzipSync(Buffer.concat(chunks), { level: 9 }));
}
