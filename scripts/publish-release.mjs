import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { githubRelease, npmRelease } from './release-state.mjs';
const execute = promisify(execFile);
const run = (command, args) => execute(command, args, { maxBuffer: 4 * 1024 * 1024 });
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const tag = process.env.TAG;
if (tag !== `v${version}`) throw new Error('Release tag must match package.json');
const directory = resolve('output/release');
const requireExisting = process.env.IMAGE_ONLY === 'true';
if (process.argv[2] === 'github') console.log(await githubRelease({ tag, version, directory, run, requireExisting }));
else if (process.argv[2] === 'npm')
  console.log(
    await npmRelease({ version, archive: resolve(directory, `logiparity-${version}.tgz`), run, requireExisting }),
  );
else throw new Error('Choose github or npm');
