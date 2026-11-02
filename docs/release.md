# Owner release guide

Version 1.0.0 is a local release candidate until the owner approves M6. No repository, tag, npm package or Docker image is created/published by these instructions being present. The target repository is Nutts5796/logiparity; confirm ownership and package-name availability immediately before release.

## Reproduce local checks

```sh
npm ci
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

The full suite needs Chromium, xmllint and disposable PostgreSQL prerequisites described in CONTRIBUTING.md. test:package builds, inspects the dry-run file set, packs to a temporary directory and installs the tarball offline with an initially empty cache outside the checkout. It checks CLI help/init, public API imports/TypeScript declarations, mismatch exit/report content and offline AI. It removes its test files. test:quickstart copies the clean source file set to a temporary directory, installs/builds and creates all report formats against its own synthetic demo. Cache/network speed affects timing; see the milestone report for observed local results.

## Package contents

The root package is the single public artifact named logiparity. Private @logiparity workspaces and their runtime dependencies/licenses are bundled. They do not need separate publication, and consumers need no private scope access. Internal package versions and the CLI are aligned to 1.0.0. Public library subpaths logiparity/core, logiparity/adapters, logiparity/scenarios and logiparity/ai expose the bundled APIs/types to consumers. The root prepack hook builds TypeScript; the file allowlist includes the executable, user docs/examples/templates and the bundled compiled runtime. Auth state, generated exports/reports, first-party source/tests and developer dependencies are rejected by the package smoke check. Bundled third-party packages retain their upstream files and license notices, including upstream source/types where shipped.

Chromium is not in the npm tarball and is never downloaded during a check. Install it explicitly for UI sources or use the Docker image. The tarball includes the pinned Playwright package. Custom invariant modules are still trusted local code, not sandboxed by packaging.

Inspect and retain the final local artifact:

```sh
npm pack --dry-run
mkdir -p output/release
npm pack --pack-destination output/release
```

This creates output/release/logiparity-1.0.0.tgz locally; it does not publish. Retain its SHA-512 integrity and the tested commit. Avoid rebuilding between approval and publishing a different artifact. The package's dependency bundle reflects the lockfile; re-run package tests after any dependency update. Review remaining moderate advisories in dependency-audit.md before deciding whether the candidate can be published.

## Owner-only publication steps

These steps require the owner's explicit release decision after reviewing MILESTONE_REPORT.md; they were not performed by the agent:

1. Establish confidential conduct/security reporting contacts. Confirm the full MIT/third-party notices, unresolved dependency advisories, npm logiparity name ownership and intended Docker registry/account.
2. Create the GitHub repository Nutts5796/logiparity, add the intended remote and push the reviewed branch. Run/inspect hosted CI including Docker; local results do not replace a remote run. Create the suggested good first issue/help wanted labels and five starter issues from roadmap.md if useful.
3. Review the final 1.0.0 changelog/date and candidate artifacts. Pin/review the container base digest and scan the final image on the intended publication platform. Verify any additional architecture before claiming multi-architecture support.
4. Create and push the v1.0.0 tag and a GitHub release for the exact reviewed commit/artifacts. Do not tag a different unverified build.
5. Authenticate to npm using the owner's account/trusted publishing setup and publish the reviewed output/release/logiparity-1.0.0.tgz. The internal private workspaces remain bundled and unpublished separately. Confirm the installed public package in a new consumer directory.
6. Select and authenticate to the owner's Docker registry. Tag/push the reviewed image as the intended 1.0.0 image, record its digest and test pulling that exact digest. No registry/repository ownership or image availability is claimed here.
7. Update release links/status only after those actions succeed. Keep tokens out of git, reports, Docker build arguments and screenshots.

The root public manifest makes local packing possible and publishable after approval; it is not permission to run npm publish. No repository scripts or CI job publish, push or create releases automatically.
