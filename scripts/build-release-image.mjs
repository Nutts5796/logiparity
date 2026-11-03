import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { verifyChecksum } from './release-state.mjs';
const execute = promisify(execFile);
const run = (command, args, options = {}) =>
  execute(command, args, { maxBuffer: 16 * 1024 * 1024, timeout: 3300000, ...options });
const {
  VERSION: version,
  IMAGE: image,
  TARGET: target,
  SUFFIX: suffix = '',
  GH_TOKEN: token,
  GITHUB_ACTOR: actor,
} = process.env;
if (
  !/^\d+\.\d+\.\d+$/.test(version ?? '') ||
  !['runtime', 'slim'].includes(target) ||
  !/^ghcr\.io\/[a-z0-9/_-]+$/.test(image ?? '')
)
  throw new Error('Invalid image build parameters');
const archive = `output/release/logiparity-${version}.tgz`;
verifyChecksum(await readFile(archive), await readFile(archive + '.sha256', 'utf8'), `logiparity-${version}.tgz`);
// execFile does not accept stdin input; keep the token out of command arguments and logs.
const { spawn } = await import('node:child_process');
await new Promise((accept, reject) => {
  const child = spawn('docker', ['login', 'ghcr.io', '--username', actor, '--password-stdin'], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let error = '';
  child.stderr.on('data', (data) => {
    error += data;
  });
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? accept() : reject(new Error(`GHCR login failed (${code}): ${error.replaceAll(token, '[REDACTED]')}`)),
  );
  child.stdin.end(token);
});
const reference = `${image}:${version}${suffix}`;
const repository = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
if (!repository || !/^\d+$/.test(runId ?? ''))
  throw new Error('Image preparation requires its GitHub repository and workflow run ID.');
const revision = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
let digest;
try {
  digest = (
    await run('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{.Manifest.Digest}}'])
  ).stdout.trim();
} catch (error) {
  if (!/not found|manifest unknown/i.test(error.stderr ?? error.message)) throw error;
}
const reused = !!digest;
const metadata = `output/release/${target}-image.json`;
if (!digest) {
  const created = (await run('git', ['show', '-s', '--format=%cI', 'HEAD'])).stdout.trim();
  await run('docker', [
    'buildx',
    'build',
    '--pull',
    '--platform',
    'linux/amd64,linux/arm64',
    '--target',
    target,
    '--annotation',
    `index:io.logiparity.build-run-id=${runId}`,
    '--annotation',
    `index:org.opencontainers.image.revision=${revision}`,
    '--tag',
    reference,
    '--build-arg',
    `VERSION=${version}`,
    '--build-arg',
    `REVISION=${revision}`,
    '--build-arg',
    `CREATED=${created}`,
    '--provenance=mode=max',
    '--sbom=true',
    '--metadata-file',
    metadata,
    '--push',
    '.',
  ]);
  digest = JSON.parse(await readFile(metadata, 'utf8'))['containerimage.digest'];
}
if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid registry image digest');
let needsAttestation = !reused;
let attestationVerified = false;
if (reused) {
  try {
    await run('gh', [
      'attestation',
      'verify',
      `oci://${image}@${digest}`,
      '--repo',
      repository,
      '--signer-workflow',
      `${repository}/.github/workflows/release.yml`,
      '--source-ref',
      `refs/tags/v${version}`,
      '--source-digest',
      revision,
    ]);
    attestationVerified = true;
  } catch (error) {
    if (!/no attestations|attestation.*not found|HTTP 404/i.test(error.stderr ?? error.message)) throw error;
    const manifest = JSON.parse(
      (await run('docker', ['buildx', 'imagetools', 'inspect', `${image}@${digest}`, '--raw'])).stdout,
    );
    const annotations = manifest.annotations ?? {};
    if (
      annotations['io.logiparity.build-run-id'] !== runId ||
      annotations['org.opencontainers.image.revision'] !== revision
    )
      throw new Error(
        'Existing image has no verified provenance from this workflow run. Re-run failed jobs in the original image-building run to repair its attestation.',
      );
    needsAttestation = true;
  }
  await writeFile(
    metadata,
    JSON.stringify({ 'containerimage.digest': digest, reused: true, attestationVerified, buildRunId: runId }) + '\n',
  );
}
await appendFile(
  process.env.GITHUB_OUTPUT,
  `digest=${digest}\nreused=${reused}\nneeds-attestation=${needsAttestation}\n`,
);
console.log(
  `${reused ? (attestationVerified ? 'Reusing image with verified provenance' : 'Reusing this workflow run’s image; provenance repair pending') : 'Built image; provenance attestation pending'}: ${reference}@${digest}`,
);
