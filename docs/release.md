# Release checklist

1. Run the contributor checks on Node 20 and 22, including package, quickstart and both Docker targets. Review the [dependency audit](dependency-audit.md). Confirm the version in package.json matches the intended tag.
2. Create and push the annotated version tag when the source is ready to distribute:

   ```sh
   git tag -a v1.0.0 -m 'LogiParity 1.0.0'
   git push origin v1.0.0
   ```

   [The release workflow](https://github.com/Nutts5796/logiparity/blob/main/.github/workflows/release.yml) first runs the reusable CI workflow, then builds the package and both images. Its publishing job alone has contents: write and packages: write permissions. It attaches the tarball and SHA-256 file and records full/slim GHCR image digests in the release notes.
3. Download and verify the release assets before installation:

   ```sh
   base=https://github.com/Nutts5796/logiparity/releases/download/v1.0.0
   curl --fail --silent --show-error --location "$base/logiparity-1.0.0.tgz" --output logiparity-1.0.0.tgz
   curl --fail --silent --show-error --location "$base/logiparity-1.0.0.tgz.sha256" --output logiparity-1.0.0.tgz.sha256
   sha256sum --check logiparity-1.0.0.tgz.sha256
   npm install --no-save --ignore-scripts ./logiparity-1.0.0.tgz
   ./node_modules/.bin/logiparity --version
   ```

   On macOS, use `shasum -a 256 --check` in place of sha256sum. Check both image digests against the release notes and run the package smoke checks against the downloaded artifact.
4. Publish the verified tarball to npm when registry access is configured:

   ```sh
   npm publish ./logiparity-1.0.0.tgz --access public
   npx logiparity@1.0.0 --version
   ```

   Confirm the printed version is 1.0.0 in a fresh consumer directory. Until publication, installation uses the verified release tarball. Update availability links after distribution succeeds.
