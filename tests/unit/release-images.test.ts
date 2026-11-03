import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
const execute = promisify(execFile);
it.each(['existing', 'new', 'bad checksum'])(
  'preserves image identity and limits release commands: %s',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'logiparity-release-image-'));
    try {
      await mkdir(join(directory, 'bin'));
      await mkdir(join(directory, 'output/release'), { recursive: true });
      const bytes = Buffer.from('reviewed package');
      const name = 'logiparity-1.1.0.tgz';
      await writeFile(join(directory, 'output/release', name), bytes);
      await writeFile(
        join(directory, 'output/release', name + '.sha256'),
        `${mode === 'bad checksum' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex')}  ${name}\n`,
      );
      const stub = `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2);fs.appendFileSync(process.env.COMMAND_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='login'){process.stdin.resume();}
else if(args.includes('inspect')){if(process.env.IMAGE_MODE==='existing')console.log('sha256:'+'a'.repeat(64));else{console.error('manifest unknown');process.exitCode=1;}}
else if(args.includes('build'))fs.writeFileSync(args[args.indexOf('--metadata-file')+1],JSON.stringify({'containerimage.digest':'sha256:'+'b'.repeat(64)}));
else if(args[0]==='rev-parse')console.log('c'.repeat(40));
else if(args[0]==='show')console.log('2026-11-03T10:00:00Z');
`;
      for (const command of ['docker', 'git']) await writeFile(join(directory, 'bin', command), stub, { mode: 0o755 });
      await writeFile(join(directory, 'package.json'), '{"type":"module"}');
      const log = join(directory, 'commands.jsonl'),
        output = join(directory, 'github-output');
      const result = await execute(process.execPath, [resolve('scripts/build-release-image.mjs')], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: join(directory, 'bin') + ':' + process.env.PATH,
          COMMAND_LOG: log,
          IMAGE_MODE: mode,
          VERSION: '1.1.0',
          IMAGE: 'ghcr.io/example/logiparity',
          TARGET: 'runtime',
          SUFFIX: '',
          GH_TOKEN: 'synthetic-token',
          GITHUB_ACTOR: 'tester',
          GITHUB_OUTPUT: output,
        },
      }).then(
        (value) => ({ code: 0, ...value }),
        (error) => error,
      );
      if (mode === 'bad checksum') {
        expect(result.code).not.toBe(0);
        await expect(readFile(log, 'utf8')).rejects.toThrow('ENOENT');
        return;
      }
      expect(result.code, result.stderr).toBe(0);
      const calls = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]);
      expect(JSON.stringify(calls)).not.toContain('synthetic-token');
      const build = calls.find((args) => args.includes('build'));
      if (mode === 'existing') {
        expect(build).toBeUndefined();
        expect(await readFile(output, 'utf8')).toContain('sha256:' + 'a'.repeat(64));
      } else {
        expect(build).toContain('VERSION=1.1.0');
        expect(build).toContain('REVISION=' + 'c'.repeat(40));
        expect(build).toContain('CREATED=2026-11-03T10:00:00Z');
        expect(build).toContain('linux/amd64,linux/arm64');
        expect(build).toContain('--push');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
