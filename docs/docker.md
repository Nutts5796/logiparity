# Docker

Prepare the checksummed npm artifact from the repository root before building:

```sh
npm ci --ignore-scripts
npm run release:prepare
docker build --tag logiparity:1.0.1 .
docker build --target slim --tag logiparity:1.0.1-slim .
```

Both images install the tarball under output/release after verifying its SHA-256 checksum inside the build. They do not compile another copy of the source. The Docker context includes only the prepared release files. The Node 22 base is pinned by an immutable manifest digest. Both variants support amd64 and arm64; the full image installs matching Chromium and system libraries, while slim installs no browsers.

```sh
docker run --rm --network=none logiparity:1.0.1 --version
docker run --rm --init --shm-size=1g \
  --mount type=bind,src="$PWD",dst=/work \
  --env STAGING_API_URL --env STAGING_API_TOKEN \
  logiparity:1.0.1 check --config parity.yaml
```

Images run as UID 1000. Config paths resolve inside /work; the report directory must be writable by that UID, or select an appropriate user and group. Credentials are supplied through explicit environment variables and are not baked into images. The entrypoint is logiparity, so pass normal CLI commands and flags after the image name.

localhost inside a container refers to that container. Use a reachable staging hostname, a Docker network service name or host.docker.internal when your engine provides it. The demo binds loopback; port mapping alone does not change that bind.

`npm run test:docker` prepares the artifact, builds both variants and verifies non-root operation, Chromium in the full image, API and file checks, SQL validation, reports and offline AI. No images are pushed. Use LOGIPARITY_DOCKER_IMAGE to choose a local review tag.

Published images include Buildx provenance and SBOM attestations. Use the image index digest in release notes for an immutable reference. The [GitHub container template](../templates/github-actions-container.yml) and [GitLab template](../templates/gitlab-ci.yml) use LOGIPARITY_IMAGE with a version-tag default. GitLab clears the CLI entrypoint for runner shell commands. The GitHub job overrides UID 1000 for checkout and artifact access, with the reason documented in the template. See the [release guide](release.md).
