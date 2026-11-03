#!/usr/bin/env node
try {
  await import('../dist/main.js');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `LogiParity could not start: ${message}\nRun npm run build from the repository root, then retry.\n`,
  );
  process.exitCode = 2;
}
