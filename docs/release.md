# Release preparation and retries

Before tagging 1.0.1, run lint, type checks, unit tests and end-to-end tests on Node 20 and 22. Run `npm run test:package` with npm 10.9.9 and 11.6.0. The packaging check creates a fresh project and runs plain install, removes node_modules, runs plain npm ci and runs plain npm audit. All three must succeed and the audit must report zero vulnerabilities. The separate empty-cache offline installation remains covered.

`npm run check:third-party` compares the remaining development schema fixture and its license with an immutable upstream tarball. No vendored runtime code remains. Review the [dependency audit](dependency-audit.md).

## One-time npm setup

For the existing public `logiparity` package on npmjs.com, open package Settings, choose Trusted publishing and select GitHub Actions. Enter user `Nutts5796`, repository `logiparity` and workflow filename `release.yml`. Leave the environment blank because this workflow declares none. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for account requirements. The workflow uses npm 11.6.0 and Node 22, with OIDC and `--provenance`; no npm publish token is stored in GitHub secrets.

## Prepare the artifact

```sh
npm ci --ignore-scripts
npm run release:prepare
```

This creates `output/release/logiparity-1.0.1.tgz`, its SHA-256 file and a CycloneDX SBOM from an offline consumer installation. The SBOM lists the bundled runtime tree and excludes the development fixture writer. These commands do not publish.

After owner review, an annotated `v1.0.1` tag starts the release workflow. Its order is:

1. Run CI against that tag, including both consumer npm versions.
2. Prepare the tarball and verify its checksum.
3. Create the GitHub release or verify matching existing assets.
4. Publish npm with provenance or verify the existing version's SHA-512 integrity.
5. Build and push both images from that exact checksummed tarball.

The Dockerfile does not compile a second source tree. It mounts the prepared tarball, checks SHA-256 inside the build and installs the same bytes offline. Full and slim images support linux/amd64 and linux/arm64. Buildx attaches provenance and SBOM attestations. The full image adds Chromium; the slim image contains no browsers. Image index digests are written to the GitHub release notes.

GH_TOKEN is scoped to the steps that read or update the GitHub release or authenticate GHCR. Only the release job has write permissions and OIDC access.

## Safe re-runs

An ordinary workflow re-run checks existing GitHub assets and npm integrity before skipping completed work. A different tarball, checksum, SBOM dependency inventory or registry integrity stops the run. Existing SBOM bytes are retained when only generated timestamps or serial numbers differ. Release notes preserve existing prose and replace only the generated image-digest section.

For an image-only retry, open Actions, select Versioned release, choose Run workflow, supply the existing tag and leave images_only enabled. CI runs against that tag. Both the existing GitHub assets and the published npm version must match; this mode cannot create a release or publish a missing npm version. It then rebuilds the images from the verified tarball and updates their digest section.

Container templates ship with the version tag `ghcr.io/nutts5796/logiparity:1.0.1-slim`; they contain no digest placeholder. For immutable pinning, append `@sha256:` followed by the verified index digest in the release notes. LOGIPARITY_IMAGE can override the default reference. The GitHub container job uses UID 0 only because checkout and artifact actions need access to runner-owned workspace mounts; normal image runs default to UID 1000.

## Verify distribution

In a fresh project, install the published version, run npm ci and npm audit, and check the CLI version. To verify a downloaded tarball on macOS, run `shasum -a 256 --check logiparity-1.0.1.tgz.sha256`; on Linux use `sha256sum --check`. Compare npm provenance, the bundled SBOM and container index digests with the release notes. Never overwrite or delete a published npm version to resolve a mismatch.
