# Continuous integration

The repository workflow checks lint, strict types, core coverage, CLI integration, packaging and quickstart behavior on Node 20 and 22. Tests use actual Chromium, disposable PostgreSQL fixtures and mock AI providers. Shared staging jobs use separate consumer templates.

## Install and prepare data

The [GitHub Actions template](../templates/github-actions.yml) and [GitLab template](../templates/gitlab-ci.yml) install the CLI from the versioned release asset:

```sh
npm install --no-save --ignore-scripts https://github.com/Nutts5796/logiparity/releases/download/v1.0.0/logiparity-1.0.0.tgz
```

Attach that artifact to the release before using the URL. During development, build it with `npm pack --pack-destination output/release` and install the local tarball instead. After npm publication, `npm install logiparity@1.0.0` becomes the registry option.

Keep `parity.yaml` in your repository and set test URLs and credentials through protected CI variables. Download a current export before comparing it with the API. The templates show an authenticated curl download; change the endpoint and filename to match the source mapping.

```yaml
report:
  outputs: [console, html, junit, json, markdown]
  dir: ./logiparity-report
```

The GitHub template runs manually or nightly. Pull requests are an opt-in for isolated targets. The GitLab template uses scheduled or manually launched web pipelines. Do not run concurrent scenario mutations against shared staging state.

## Exit codes and artifacts

Exit 0 passes. Exit 1 means blocking data findings. Exit 2 means a source, configuration or runtime error. The templates retain reports after failure and show which category failed. Use `failOn` for intended allowances rather than ignoring every nonzero result.

GitLab consumes junit.xml through its JUnit report setting. GitHub retains the HTML and other report files as artifacts; an additional test-dashboard integration can consume XML if needed. Protect uploaded reports and screenshots according to the sensitivity of your test data. Never upload saved browser authentication.

## Browser and SQL sources

For UI checks, install the matching bundled browser during setup:

```sh
node node_modules/logiparity/node_modules/playwright/cli.js install --with-deps chromium
```

Supply a private staging storageState file and configure readiness and allowed origins. The Docker image already includes matching Chromium. A source checkout uses `npx playwright install --with-deps chromium`.

SQL checks use a dedicated SELECT-only staging role named through connectionEnv. The installed read adapter does not provision database fixtures. Contributor tests use only a disposable loopback database named logiparity_test.

## Scenario jobs

```sh
./node_modules/.bin/logiparity scenario run scenarios/no-show.yaml \
  --target targets/staging.yaml --report-dir ./scenario-report
```

Retain scenario-report/ and expose scenario-report/junit.xml as the JUnit artifact. Choose the state sources required by your selected invariants, as listed in the [scenario reference](scenarios.md). Review each mapped mutation and fixture policy before running it. AI drafts have no automatic execution hook.
