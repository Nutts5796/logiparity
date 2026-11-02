# Release checklist

1. Run the contributor checks on Node 20 and 22, including the consumer install/`npm ci`, empty-cache offline install, README quickstart/staging example and both Docker targets. Review the [dependency audit](dependency-audit.md). Confirm package/workspace versions and Docker labels are 1.0.1.
2. Complete the one-time npm trusted publisher setup for the existing public `logiparity` package. On npmjs.com, open **package → Settings → Trusted publishing → GitHub Actions** and enter organization/user `Nutts5796`, repository `logiparity`, workflow filename `release.yml`. Leave environment blank because this workflow declares no GitHub environment. Configure publishing to require 2FA and disallow traditional tokens after verifying trusted publishing. Keep the GitHub repository public for provenance. No npm publish token is needed in GitHub secrets. See [npm's trusted publishing instructions](https://docs.npmjs.com/trusted-publishers/) for account permissions and setup requirements.
3. Review the release changes, then create and push the annotated version tag when the owner authorizes distribution:

   ```sh
   git tag -a v1.0.1 -m 'LogiParity 1.0.1'
   git push origin v1.0.1
   ```

   [The release workflow](https://github.com/Nutts5796/logiparity/blob/main/.github/workflows/release.yml) runs the reusable CI once for the tag; ordinary CI push triggers accept branches only. The release job uses Node 22 and npm 11.6.0, with `id-token: write` for npm OIDC, `contents: write` for GitHub releases and `packages: write` for GHCR. npm trusted publishing requires npm 11.5.1+ and Node 22.14+.

   `npm run release:prepare` builds the tarball, writes its SHA-256 file and a CycloneDX SBOM from an empty-cache offline consumer installation. The SBOM names the installed LogiParity artifact as root and lists bundled runtime dependencies, including the private ExcelJS package; development tooling is excluded. You can run this command locally without publishing anything.

   After checksum verification, the workflow creates the GitHub release with tarball, checksum and SBOM, then publishes that same tarball using `npm publish --access public --provenance` and trusted OIDC. Only after **both** succeed does it push the full image (linux/amd64) and slim image (linux/amd64 and linux/arm64). Image index digests are appended to the GitHub release notes. Buildx/QEMU actions are pinned to commits.
4. Verify distribution from a fresh consumer directory:

   ```sh
   npm install logiparity@1.0.1
   npm ci
   ./node_modules/.bin/logiparity --version
   ```

   Check npm provenance and confirm the CLI prints 1.0.1. To verify the independently downloadable artifact:

   ```sh
   base=https://github.com/Nutts5796/logiparity/releases/download/v1.0.1
   curl --fail --silent --show-error --location "$base/logiparity-1.0.1.tgz" --output logiparity-1.0.1.tgz
   curl --fail --silent --show-error --location "$base/logiparity-1.0.1.tgz.sha256" --output logiparity-1.0.1.tgz.sha256
   sha256sum --check logiparity-1.0.1.tgz.sha256
   npm install --no-save --ignore-scripts ./logiparity-1.0.1.tgz
   ```

   On macOS, use `shasum -a 256 --check`. Download `logiparity-1.0.1.cdx.json` from the same release to inspect bundled dependencies. Check image platforms and digests against the release notes.
5. Make a small follow-up commit replacing `REPLACE_WITH_VERIFIED_1_0_1_SLIM_DIGEST` in both container templates with the verified **1.0.1-slim image index digest** from the release notes. Set CI variable `LOGIPARITY_IMAGE` to the complete `ghcr.io/nutts5796/logiparity:1.0.1-slim@sha256:<verified digest>` reference (GitHub repository Actions variable or GitLab CI variable). This placeholder is intentional while 1.0.1 is being prepared. Do not substitute the 1.0.0 image or install a 1.0.1 CLI into that older image. Each template verifies the bundled CLI version before use.

If npm publication fails, images are not pushed; the GitHub release assets remain available for diagnosis. Inspect the existing release and registry state before resuming a failed workflow. Do not delete or overwrite a published npm version. If npm succeeded but an image build failed, retry only the image steps for the same reviewed source and update the release notes with the resulting digests.
