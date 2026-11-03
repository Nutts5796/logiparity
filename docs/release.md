# Release procedure

Release only reviewed changes. The 1.1.0 work is unreleased; 1.0.1 was never published and its notes are folded into 1.1.0. Local preparation never pushes, tags or publishes.

## One-time setup

The owner created the `logiparity` npm organization on 2026-11-03; the scope is claimed. First-party packages stay private and ship with the root CLI. Configure the root package's npm trusted publisher for GitHub repository `Nutts5796/logiparity`, workflow `release.yml` and the intended environment. Use npm's [trusted publishing setup](https://docs.npmjs.com/trusted-publishers/); no long-lived npm token is needed. In GHCR package settings, check **Manage Actions access** grants this repository write access. Review GitHub Actions attestation permissions and registry visibility.

## Prepare and publish

```sh
npm run release:bump -- 1.1.0
npm install --package-lock-only --ignore-scripts
npm ci --ignore-scripts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run check:docs
npm run check:third-party
npm run test:package
npm run test:quickstart
npm run test:docker
npm run release:prepare
```

Use the intended next version in the bump command. It updates all first-party manifests, lockfile records and the CLI version module. Review changelog and generated assets, set the publication date only when publishing, and commit. After release approval:

```sh
VERSION=$(node -p "require('./package.json').version")
git tag -a "v$VERSION" -m "LogiParity $VERSION"
git push origin main
git push origin "v$VERSION"
```

A tag push builds the tarball once and passes it as an artifact. A separate job attests it; a contents-only job creates a draft GitHub release. The npm job has OIDC publishing permission. Image jobs have registry and attestation permissions, install that same checksum-verified archive, and add OCI revision/created labels, provenance and SBOMs. The notes job publishes the draft only after npm and both images succeed. Build jobs have no write permissions; all checkouts disable persisted credentials. Node is pinned exactly and release jobs do not use the npm cache action.

## Retries

Re-run a failed tag workflow to resume npm publication safely: the registry integrity must match the existing archive. Existing GitHub tarball, checksum and SBOM assets are downloaded and verified instead of rebuilding. Missing or mismatched assets fail for explicit investigation.

Manual `workflow_dispatch` is image-only. Select the exact existing tag as the workflow ref and supply that same tag input. Other refs are rejected before checkout. It requires existing GitHub assets and the matching npm version; it never publishes npm. Existing versioned images are inspected and their digests reused. Missing images are built; retries do not replace existing digests.

After publishing 1.1.0, copy the verified image index digests from the release notes into `LOGIPARITY_IMAGE` CI variables. A small follow-up commit can pin those references. Placeholder text such as `sha256:<verified index digest>` is documentation, never a runnable image or a fabricated digest. Do not substitute an older CLI image.

## Verify

```sh
VERSION=$(node -p "require('./package.json').version")
gh release download "v$VERSION" --repo Nutts5796/logiparity --pattern "logiparity-$VERSION.tgz" --pattern "logiparity-$VERSION.tgz.sha256"
shasum -a 256 -c "logiparity-$VERSION.tgz.sha256"
gh attestation verify "logiparity-$VERSION.tgz" --repo Nutts5796/logiparity
npm audit signatures
docker buildx imagetools inspect "$LOGIPARITY_IMAGE"
gh attestation verify "oci://$LOGIPARITY_IMAGE" --repo Nutts5796/logiparity
docker run --rm "$LOGIPARITY_IMAGE" --version
```

Set `LOGIPARITY_IMAGE` to a digest-pinned full or slim reference from the release notes. Verify both linux/amd64 and linux/arm64 index members. `npm audit signatures` verifies a consumer installation's registry signatures; local file tarballs have no npm registry signature until publication. GitHub provenance verification is separate. See [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).
