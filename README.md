# LogiParity

Keyed data comparisons and disruption tests for logistics software.

The same shipment appears in an API, a dispatcher screen and an accounting export. A missing export row or a one-cent payout difference can survive ordinary endpoint tests. LogiParity compares these records by a shared key and identifies the affected records and fields.

## Why this matters

Delivery and freight systems move operational data between planning, dispatch and accounting. Each handoff can introduce a different defect:

- A payout or settlement rounds differently in the API and accounting export.
- The dispatcher screen keeps an old status after the backend updates it.
- Replanning after a breakdown drops an order or assigns it twice.
- An export loses a row at a page boundary.

An endpoint test can pass while another surface shows different records. A contract test can confirm the response shape without comparing the same day's data across those surfaces. Operational checks also need to verify what happens to affected orders after a disruption. The demo bugs are synthetic reproductions of these failure classes.

## How it differs from tools you already use

| Tool | Typical focus |
| --- | --- |
| [Postman](https://learning.postman.com/docs/tests-and-scripts/write-scripts/intro-to-scripts/) | API requests, scripts and automated API tests. |
| [Playwright](https://playwright.dev/docs/intro) | Browser automation and end-to-end application tests. |
| [Pact](https://docs.pact.io/) | Consumer and provider expectations at integration boundaries. |
| [Great Expectations](https://docs.greatexpectations.io/docs/core/introduction/) | Data validation through expectations and validation workflows. |
| [data-diff style tools](https://github.com/datafold/data-diff) | Record and value differences within or across database tables. |

LogiParity combines keyed record parity across UI, API, exports and SQL with exact money and timezone handling, plus disruption scenarios with operational invariants. YAML defines the sources, mappings, tolerances and failure rules. Reports connect each difference to its source, key and field.

## Install

Install the CLI in your project with Node.js 20 or later:

```sh
npm install --save-dev logiparity@1.0.1
./node_modules/.bin/logiparity --version
```

Versioned tarballs with checksums are another option; see the [release guide](docs/release.md). For the synthetic demo and source development, use the checkout below. CI tests Node 20 and 22.

## Quickstart

Use Node.js 20 or later; CI tests Node 20 and 22. The demo contains 55 synthetic drivers and 2,750 orders. No browser or database installation is needed for this first report.

```sh
git clone https://github.com/Nutts5796/logiparity.git
cd logiparity
npm ci --ignore-scripts
DEMO_PORT=3010 npm run demo
```

`DEMO_PORT` selects the local port. Keep that terminal open. In a second terminal, from `logiparity`:

```sh
export DEMO_API_URL=http://127.0.0.1:3010
npm run demo:export
./node_modules/.bin/logiparity validate --config examples/demo/parity.yaml
./node_modules/.bin/logiparity check --config examples/demo/parity.yaml
```

Expected: zero findings and exit 0. Open `logiparity-report/report.html`. The same directory contains JSON, Markdown and JUnit reports. If you change the port, use the same value in `DEMO_API_URL`.

Stop the demo, run `DEMO_PORT=3010 npm run demo:bugs`, then repeat the export and check commands. The report finds missing rows, payout differences and shifted datetimes. Repeated patterns get one summary line each, for example "1,833 delivered_at values in csv differ by exactly -6h (likely timezone)", and every individual finding stays listed below.

![Synthetic parity report](docs/images/report.png)

<details><summary>Dispatcher screen</summary>

![Authenticated synthetic dispatcher](docs/images/dispatcher.png)

</details>

HTML and Markdown show currency values beside minor units, and ISO UTC beside epoch milliseconds. JSON retains normalized values and adds pattern groups without removing individual findings.

## Try it on your staging

Save this as `parity.yaml`, or generate the identical starter with `./node_modules/.bin/logiparity init`. It works against the running demo without a token; change only `STAGING_API_URL` below to use a different demo port. For your own API, edit paths, mappings and completion metadata to match its contract. Uncomment bearer authentication if your staging API requires it and set `STAGING_API_TOKEN`.

```yaml
# LogiParity starter — TEST AND STAGING ENVIRONMENTS ONLY.
# First source is the reference. Paths resolve relative to this YAML file.
# Set STAGING_API_URL to your test/staging API, then edit path and fields.
# Keep secrets in environment variables; do not write credentials here.
version: 1
environment: test
entities:
  - name: shipment
    key: shipment_id
    sources:
      api:
        type: rest
        baseUrl: ${STAGING_API_URL}
        path: /api/shipments
        items: $.data[*]
        pagination: { type: page, totalPath: $.pagination.total, pageParam: page, sizeParam: limit, size: 200 }
        # auth: { type: bearer, tokenEnv: STAGING_API_TOKEN }
        fields: { shipment_id: $.id, status: $.status, payout: $.driver_payout }
      export:
        type: csv
        file: ./shipments.csv
        headerRow: 1
        fields: { shipment_id: "Shipment ID", status: Status, payout: "Driver payout" }
    compare:
      status: { type: enum, map: { Delivered: delivered, "In transit": in_transit } }
      # Money defaults to decimal strings; numeric input requires allowNumber: true.
      # Tolerance is in minor units.
      payout: { type: money, currency: USD, tolerance: 0 }
    aggregates:
      - { name: delivered_count, type: count, where: { status: delivered } }
      - { name: payout_total, type: sum, field: payout }
    # List: any finding in a selected category fails. [] is report-only.
    failOn: [missing, extra, mismatch, aggregate, duplicate]
    # Or use allowed counts: { missing: 2, mismatch: 10, aggregate: 0 }
    # Runtime/source errors always exit 2, regardless of failOn.
report:
  outputs: [console, html, junit, json, markdown]
  dir: ./logiparity-report
```

Download a current export, validate the configuration, then compare:

```sh
export STAGING_API_URL=http://127.0.0.1:3010
curl --fail --silent --show-error "$STAGING_API_URL/exports/shipments.csv" --output shipments.csv
./node_modules/.bin/logiparity validate --config parity.yaml
./node_modules/.bin/logiparity check --config parity.yaml
```

Read the export and API at the same cutoff time, or compare a closed day to avoid in-flight updates. `totalPath` detects capped pages and confirms completion. Money uses decimal strings by default; opt into numeric input only after reviewing precision. The [configuration reference](docs/configuration.md) also covers SQL, browser sources and `validate --allow-missing-env` for CI lint steps without secrets.

The [npm-based GitHub Actions template](templates/github-actions.yml) installs `logiparity@1.0.1`, downloads a staging export and retains reports for seven days. Tokens are scoped to the download and comparison steps. Shared staging checks run manually or nightly; enable pull requests only with an isolated target. [Container-job](templates/github-actions-container.yml) and [GitLab](templates/gitlab-ci.yml) variants use `LOGIPARITY_IMAGE`; their clearly marked 1.0.1 slim digest placeholder is completed after release as described in the [release guide](docs/release.md).

## Disruption scenarios

Run a disruption against the demo after starting it and setting `DEMO_API_URL`:

```sh
./node_modules/.bin/logiparity scenario run examples/demo/scenarios/02-vehicle-breakdown.yaml --target examples/demo/target.yaml
```

Five examples cover no-show, breakdown, traffic delay, cancellation and capacity reduction. Select the state needed by each check:

- Lost-order checks use orders; single assignment adds assignments.
- Capacity checks add drivers and vehicles.
- ETA and notification checks use affected-order state.

Wait for a configured completion source, use a fixed delay, or omit wait. The [scenario reference](docs/scenarios.md) lists exact dependencies and a bring-your-own-API example. The [freight example](examples/freight/README.md) compares load totals with rolled-up settlement lines.

![Synthetic breakdown scenario](docs/images/scenario.png)

## Safety

Test and staging only. Read-only except scenario events you map yourself. No telemetry. [Security details](SECURITY.md).

## Status

First public release, maintained by one author. Feedback and pilots welcome.

## About

Built by Sergei Orekhovskii, a QA engineer who previously ran transport logistics for a delivery service and worked in railway operations. Developed with AI coding assistants; design decisions, review and testing by the author. Read the [technical design decisions](docs/design-decisions.md).

## Reference

- [Configuration](docs/configuration.md), [scenarios](docs/scenarios.md) and [optional AI drafts](docs/ai.md)
- [Reports](docs/report-formats.md), [JSON schema](docs/report-schema.md) and [adapter development](docs/writing-adapters.md)
- [CI](docs/ci.md), [Docker](docs/docker.md), [FAQ](docs/faq.md) and [release guide](docs/release.md)
- [Dependencies](docs/dependencies.md), [audit notes](docs/dependency-audit.md) and [build history](docs/development/milestones.md)
- [Contributing](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md), [roadmap](docs/roadmap.md) and [changelog](CHANGELOG.md)

MIT © Sergei Orekhovskii.
