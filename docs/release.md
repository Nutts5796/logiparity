# Release procedure

Release only reviewed changes. Version 1.1.0 is dated 2026-11-03; 1.0.1 was never published and its notes are folded into 1.1.0. Local preparation never pushes, tags or publishes. Use `npm run pack:artifact` for the sanitized CLI alone or `npm run release:prepare` for the complete release assets. Direct workspace `npm pack`/`npm publish` is rejected so a manifest with development fields cannot be distributed accidentally; release jobs publish the reviewed tarball.

## One-time setup

First-party code ships under lib/ inside the root CLI; consumers do not install private registry packages. Create the GitHub environment **npm** and configure the root package’s npm trusted publisher: owner **Nutts5796**, repository **logiparity**, workflow **release.yml**, environment **npm**. Use the same environment name on both services and configure required reviewers in GitHub. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/); no long-lived npm token is needed. Grant this repository write access in GHCR’s **Manage Actions access** settings and review registry visibility and attestation permissions.

## Prepare and publish

```sh
# Set VERSION to the intended release version first.
npm run release:bump -- "$VERSION"
npm install --package-lock-only --ignore-scripts
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run check:docs
npm run check:third-party
npm run check:release-text
npm run test:package
npm run test:quickstart
npm run test:docker
npm run release:prepare
```

Use the intended next version in the bump command. It updates all first-party manifests, lockfile records and the CLI version module. Review changelog and generated assets, confirm the planned publication date (2026-11-03 for 1.1.0), and commit. After release approval:

```sh
(
  set -e
  VERSION=$(node -p "require('./package.json').version")
  test -n "$VERSION"
  node -e 'if (!/^\d+\.\d+\.\d+$/.test(process.argv[1])) process.exit(2)' "$VERSION"
  git tag -a "v$VERSION" -m "LogiParity $VERSION"
  git push origin main
  git push origin "v$VERSION"
)
```

The ref guard runs without a checkout. A small lookup job with contents:write reads draft metadata and downloads existing assets; it never runs npm or repository scripts. Reusable CI runs next. The read-only build job verifies provenance for downloaded assets or prepares a new tarball once and passes it as an artifact. A separate job attests newly prepared assets only; a contents-only job creates a draft GitHub release. The npm job has OIDC publishing permission. Image jobs have registry and attestation permissions, install that same checksum-verified archive, and add OCI revision/created labels, provenance and SBOMs. The notes job publishes the draft only after npm and both images succeed. Build jobs have no write permissions; all checkouts disable persisted credentials. Release jobs pin Node exactly. The reusable CI matrix uses the npm cache; release preparation has no cache action. npm subprocesses receive no GH_TOKEN, GITHUB_TOKEN or NODE_AUTH_TOKEN from the release job.

## Retries

Use Re-run failed jobs or Re-run all jobs on the original tag workflow to resume publication safely. Explicit downstream conditions allow npm to run when reused assets skip attestation; the registry integrity must match the existing archive. Existing GitHub tarball, checksum and SBOM assets are downloaded and verified instead of rebuilding. Missing or mismatched assets fail for explicit investigation.

Manual `workflow_dispatch` is image-only. Select the exact existing tag as the workflow ref and supply that same tag input. Other refs are rejected before checkout. It requires existing GitHub assets and the matching npm version; it never publishes npm. Existing versioned image digests are reused only after checking their provenance against the repository, release workflow, tag and source commit. If provenance is missing, re-run failed jobs in the original image-building workflow run: its run ID and revision annotations permit repairing the attestation. An unrelated manual dispatch cannot attest an old image as its own build. Missing images are built; retries do not replace existing digests.

For 1.1.0, copy the verified image index digests from the release notes into `LOGIPARITY_IMAGE` CI variables. The supplied templates read the CI variable directly, so updating that variable needs no repository commit. A consumer that chooses a literal reference can pin it in its own configuration. Example text such as `sha256:<verified index digest>` is documentation, never a runnable image or a fabricated digest. Do not substitute an older CLI image.

## Verify

```sh
VERSION=$(node -p "require('./node_modules/logiparity/package.json').version")
gh release download "v$VERSION" --repo Nutts5796/logiparity --pattern "logiparity-$VERSION.tgz" --pattern "logiparity-$VERSION.tgz.sha256"
shasum -a 256 -c "logiparity-$VERSION.tgz.sha256"
gh attestation verify "logiparity-$VERSION.tgz" --repo Nutts5796/logiparity
npm audit signatures
docker buildx imagetools inspect "$LOGIPARITY_IMAGE"
gh attestation verify "oci://$LOGIPARITY_IMAGE" --repo Nutts5796/logiparity
docker run --rm "$LOGIPARITY_IMAGE" --version
```

Set `LOGIPARITY_IMAGE` to a digest-pinned full or slim reference from the release notes. Verify both linux/amd64 and linux/arm64 index members. `npm audit signatures` verifies a consumer installation's registry signatures; local file tarballs have no npm registry signature until publication. GitHub provenance verification is separate. See [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

## Offline installation

The CLI bundles first-party code only. A standalone CLI tarball cannot resolve unbundled dependencies without registry access or a populated cache. The release therefore includes `logiparity-offline-<version>.tgz` and its SHA-256 file. The kit contains the identical CLI archive, verified registry tarballs and consumer locks generated during release preparation for two profiles. It contains no Chromium binaries.

```sh
VERSION=1.1.0 # Set this explicitly to the version in the downloaded kit filename.
shasum -a 256 -c "logiparity-offline-$VERSION.tgz.sha256"
tar -xzf "logiparity-offline-$VERSION.tgz"
node "logiparity-offline-$VERSION/install.mjs" default /absolute/path/to/empty/project
# Or select full to include Playwright and all three PostgreSQL peers.
```

Run these commands from a directory containing downloaded or locally prepared release assets. The installer refuses nonempty destinations, verifies each local file, creates an empty temporary npm cache, seeds it only from local integrity-checked tarballs, and runs `npm ci --offline --no-audit` for integrity-verified installation; no online vulnerability audit is performed. The cache is removed afterwards. Normal online `npm install`, `npm ci` and `npm audit` are checked independently for both profiles on npm 10 and 11. `npm audit signatures` verifies registry-installed dependencies after publication; local kit archives are protected by checksums and GitHub provenance. Docker full and slim builds consume the same kit.

Offline kits use sorted entries, fixed ownership and zero timestamps. Gzip carries no source filename or clock and sets its OS byte to 255, so rebuilding the same kit on macOS and Linux produces the same bytes. Offline installation verifies local dependency integrity; online auditing is a separate consumer check.
