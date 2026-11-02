# Release guide

Release artifacts are built from the reviewed source tree. Keep credentials out of Git, Docker build arguments and reports.

## Verify

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run check:docs
npm run test:package
npm run test:quickstart
npm run test:docker
node scripts/dependencies.mjs
npm audit
npm audit --omit=dev
```

The complete suite needs Chromium, xmllint and disposable PostgreSQL prerequisites described in [CONTRIBUTING.md](../CONTRIBUTING.md). The package check installs into an empty-cache consumer directory, tests public APIs and declarations, and checks CLI reports. The quickstart check installs and builds clean source, starts its own synthetic demo and creates reports. [Build history](development/milestones.md) records completed checks.

## Build artifacts

```sh
mkdir -p output/release
npm pack --dry-run
npm pack --pack-destination output/release
docker build --tag logiparity:1.0.0 .
```

The root package bundles compiled private workspaces and their locked runtime dependencies and licenses. Consumer APIs are available as logiparity/core, logiparity/adapters, logiparity/scenarios and logiparity/ai. Internal packages do not need separate publication. The allowlist excludes saved auth state, generated exports, reports and development dependencies. Browser binaries are installed explicitly for the npm package and are included in the Docker image.

Record the source commit and artifact integrity. Review [dependency advisories](dependency-audit.md), third-party notices and the image scan before distribution. Verify every intended container architecture. Re-run checks after changing a dependency or rebuilding the artifact.

## Distribute

Attach logiparity-1.0.0.tgz to the versioned GitHub release so these installation instructions work:

```sh
npm install --no-save --ignore-scripts https://github.com/Nutts5796/logiparity/releases/download/v1.0.0/logiparity-1.0.0.tgz
```

Once an npm package is published, `npm install logiparity@1.0.0` is the registry alternative. Check the published artifact with a fresh installation and verify image pulls by digest. Update release links and availability after distribution succeeds. CI and package scripts build and test; they do not publish automatically.
