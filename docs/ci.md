# Continuous integration

The repository workflow runs lint, strict typecheck, Vitest core coverage (minimum 85%), CLI e2e, build, documentation checks, offline package-install smoke and a clean-source quickstart on Node 20/22. PostgreSQL integration uses an ephemeral PostgreSQL 16 service; Chromium and xmllint are installed explicitly. AI tests use isolated loopback mocks and synthetic credentials, never a real provider.

A separate Docker job builds the image and checks non-root execution, Chromium, report generation and offline AI with the container network disabled. These are configured jobs; local validation results are in [MILESTONE_REPORT.md](../MILESTONE_REPORT.md). No remote CI badge or successful hosted run is claimed before the owner creates/pushes the repository.

## Use LogiParity in another repository

The [GitHub Actions template](../templates/github-actions.yml) and [GitLab CI template](../templates/gitlab-ci.yml) install the exact released CLI and run `check --config parity.yaml`. Copy the relevant template and adapt it to an explicitly configured test/staging target. They reference logiparity@1.0.0, which must be published by the owner first; until then use the locally verified tarball (see [release guide](release.md)). They do not fetch exports, deploy software or publish anything.

Your YAML must use environment: test or staging, map at least two sources and set report outputs/dir, for example:

```yaml
report:
  outputs: [console, html, junit, json, markdown]
  dir: ./logiparity-report
```

Set target URLs and credentials in CI variables/secrets referenced by the config. Supply files before the comparison; an old export is a different snapshot. Never commit tokens, browser storageState or real customer data. Keep uploaded reports/screenshots in restricted CI artifacts appropriate to the test data. Both templates retain reports even when comparison fails; they do not turn failures into success.

Exit 0 passes, exit 1 fails for blocking findings, exit 2 fails for configuration/runtime/source/output errors. Use failOn thresholds in the config for intended allowances, rather than a shell `|| true`. JUnit marks source errors separately; GitLab consumes the configured junit.xml report and both platforms retain HTML/JSON/Markdown. GitHub does not natively turn this XML into an inline test dashboard; add a separately reviewed integration if needed.

## Browser and SQL prerequisites

For UI sources install the matching bundled Chromium version with:

```sh
node node_modules/logiparity/node_modules/playwright/cli.js install --with-deps chromium
```

Restore a securely supplied staging storageState file and configure allowed origins/readiness explicitly. The install runs during CI setup, never during a check. The Docker image already includes matching Chromium. The source-checkout command remains `npx playwright install --with-deps chromium`.

For SQL sources, configure a dedicated SELECT-only staging role through connectionEnv. The read adapter never provisions database fixtures. Repository tests require a disposable loopback database named logiparity_test; that fixture-writing helper is separate from the installed CLI and must not target business databases. No real AI credentials are required for any repository test.

## Scenario jobs

After reviewing a mutation target, a job can run:

```sh
./node_modules/.bin/logiparity scenario run scenarios/breakdown.yaml \
  --target targets/staging.yaml --report-dir ./scenario-report
```

Retain scenario-report/ and publish scenario-report/junit.xml as the job's JUnit artifact. Run scenarios serially against a shared mutable target and arrange the fixture/reset policy. Exit codes have the same meaning as the parity job. See [scenario reference](scenarios.md) for canonical state and partial failures. AI drafts have no automatic CI execution hook.
