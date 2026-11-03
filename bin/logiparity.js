#!/usr/bin/env node
try {
  await import('@logiparity/cli');
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`LogiParity startup error: ${detail.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')}\n`);
  process.stderr.write(
    'LogiParity could not start. Reinstall the built package, or run npm ci and npm run build in a source checkout.\n',
  );
  process.exitCode = 2;
}
