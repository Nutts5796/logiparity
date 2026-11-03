# CI integration

Copy the [npm job](../templates/github-actions.yml) or [container job](../templates/github-actions-container.yml) into your repository. Both run manually or nightly, annotate exit 1 as findings and exit 2 as configuration/source failure, append report.md to the GitHub step summary and retain reports for seven days. Enable PR checks only for isolated test targets. Tokens belong only to export/check steps. The starter's bearer option and the templates both use `STAGING_API_TOKEN`; uncomment it in parity.yaml for an authenticated API.

For the npm job, prepare and commit a small `tools/logiparity` installation manifest and integrity lockfile in your consuming repository:

```sh
mkdir -p tools/logiparity
cd tools/logiparity
npm init -y
npm install --save-dev --save-exact logiparity
# For UI: npm install --save-dev --save-exact playwright@1.64.1
# For SQL: npm install --save-dev --save-exact pg@8.23.1 pg-query-stream@4.17.1 pgsql-ast-parser@12.0.2
```

Review the published version and commit both package.json and package-lock.json. CI uses `npm ci --prefix tools/logiparity --ignore-scripts`, which checks lockfile integrity and never chooses a new dependency graph. Do this after the intended release is published; do not invent an integrity hash for an unpublished registry version. During pre-release review, install the checksummed local tarball instead. The repository's package checks verify this flow with the actual artifact. `logiparity install-browser` installs Chromium when the optional Playwright peer is installed.

For containers, set the Actions variable `LOGIPARITY_IMAGE` to `ghcr.io/nutts5796/logiparity:<version>-slim@sha256:<verified index digest>` from that version's release notes. The version component is a tag; the digest pins immutable bytes. A tag alone can change. Both templates derive the expected CLI version from the image reference. The full image includes optional adapters and Chromium; the slim image supports REST/files. The GitHub job explains its root override for runner-owned workspace mounts; ordinary Docker runs use UID 1000.

The [GitLab template](../templates/gitlab-ci.yml) defines only hidden `.logiparity`. Include it, then extend it in a job and select your existing stage. It never overrides `stages`. Set protected `LOGIPARITY_IMAGE`, `STAGING_API_URL` and `STAGING_API_TOKEN` variables; schedule the pipeline or run it manually.

Every download uses a bounded timeout and retries. Snapshot both sources at the same cutoff time or compare a closed day. Report artifacts and UI evidence may contain test data; restrict retention and access to your needs.

GitHub step summaries and attached reports are visible to anyone with permission to read the repository. Keep sensitive source data out of summaries and use appropriate repository access and artifact retention.
