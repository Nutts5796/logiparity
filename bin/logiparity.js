#!/usr/bin/env node
try {
  await import('@logiparity/cli');
} catch {
  process.stderr.write('LogiParity could not start. Reinstall the built package, or run npm ci and npm run build in a source checkout.\n');
  process.exitCode = 2;
}
