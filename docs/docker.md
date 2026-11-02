# Docker

Build the local image from the repository root:

```sh
docker build --tag logiparity:1.0.0 .
docker run --rm --network=none logiparity:1.0.0 --help
```

The multi-stage Dockerfile builds and packs the same single npm artifact, installs it offline in the runtime stage, installs matching Chromium/system dependencies explicitly at image build, and runs as the existing non-root node user. No credentials are baked into the image. The Docker context allowlist excludes auth state, exports, reports, node_modules and environment files. The Node 22.23.4/Debian base is pinned by an immutable manifest digest. Review/update that digest and scan the final image before publication.

Run a configured test/staging check with a writable report directory:

```sh
docker run --rm --init --shm-size=1g \
  --mount type=bind,src="$PWD",dst=/work \
  --env STAGING_API_URL --env STAGING_API_TOKEN \
  logiparity:1.0.0 check --config parity.yaml
```

Config and source file paths resolve inside /work. The host workspace must permit writes by container UID 1000, or select an appropriate --user UID:GID; do not solve access errors with a privileged container. Keep authentication state read-only/private except the report destination. Pass only required test variables; the image has no automatic AI invocation.

localhost inside a container refers to that container. Use an explicit reachable staging hostname, a user-created Docker network/service name, or host.docker.internal where provided by your engine. On Linux an explicitly reviewed host-gateway mapping may be needed. The demo binds loopback and is not exposed as a hosted service by this Dockerfile. Do not assume Docker port mapping changes its loopback bind.

The image entrypoint is logiparity, so all check/init/scenario/AI commands accept the same flags. An AI preview requires no network; --send requires explicit provider variables and sends only to that configured provider. Configure absolute/container-relative output paths and inspect the draft before separate execution.

`npm run test:docker` builds and checks the image locally: default help, non-root UID, headless Chromium, mismatch exit 1, all report files, money/UTC presentation and offline AI. Smoke containers use --network=none and no host mounts; the build itself downloads its base/npm/browser/system dependencies. It does not push images or alter Docker contexts. Use LOGIPARITY_DOCKER_IMAGE to select a different local test tag. See the [build history](development/milestones.md) for verified platforms.

## Slim image

For API, file and SQL checks without Chromium:

```sh
docker build --target slim --tag logiparity:1.0.0-slim .
docker run --rm --network=none logiparity:1.0.0-slim --version
```

The default runtime target includes Chromium. Both targets run as node. BuildKit bind mounts keep the package tarball and temporary Playwright installer out of image layers; the full runtime copies only the installed package from the package stage. The slim target retains the JavaScript adapter dependencies but installs no browsers or browser system libraries. A UI check needs the full image.
