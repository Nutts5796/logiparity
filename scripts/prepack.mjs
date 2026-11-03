process.stderr.write(
  'Use npm run pack:artifact or npm run release:prepare to build the sanitized LogiParity tarball. Direct npm pack/publish from the workspace is disabled; publish the reviewed tarball instead.\n',
);
process.exitCode = 2;
