# Docker

Prepare the checksummed artifact, then supply its version to both targets:

```sh
npm ci
npm run release:prepare
VERSION=$(node -p "require('./package.json').version")
docker build --build-arg VERSION="$VERSION" --tag "logiparity:$VERSION" .
docker build --build-arg VERSION="$VERSION" --target slim --tag "logiparity:$VERSION-slim" .
```

Both images install the checksum-verified release tarball, without compiling another copy of the source. The build context contains only release inputs. The Node base is pinned by digest. The full image includes browser/database adapters and Chromium; slim supports CSV, XLSX and REST without those optional peers. Release builds add revision/created OCI labels and attest linux/amd64 and linux/arm64 indexes.

```sh
docker run --rm --network=none "logiparity:$VERSION" --version
docker run --rm --init --shm-size=1g \
  --mount type=bind,src="$PWD",dst=/work \
  --env STAGING_API_URL --env STAGING_API_TOKEN \
  "logiparity:$VERSION" check --config parity.yaml
```

Images run as UID 1000. Config paths resolve inside `/work`; select a directory writable by that UID or the appropriate user/group. Pass credentials through explicit environment variables. The entrypoint is `logiparity`. Loopback inside a container refers to that container; use a reachable staging host, Docker network service or `host.docker.internal` when supported. The synthetic demo binds loopback, so port mapping alone does not expose it outside the container.

`npm run test:docker` builds both variants locally and checks non-root operation, the full browser, absent slim peers, API/file checks, report generation and local AI previews. It never pushes. Set `LOGIPARITY_DOCKER_IMAGE` to select a review tag. Use [release notes](release.md) for verified image digests and provenance verification. CI templates require `LOGIPARITY_IMAGE` with a version tag and immutable digest; the CLI version is derived from that reference.

Reports default to file mode 0600. For bind mounts shared with another host UID/group, configure a quoted octal `report.fileMode: '0640'` (or `'0o640'`) and matching container group ownership. Unquoted integers are rejected. UI evidence uses that same mode.
