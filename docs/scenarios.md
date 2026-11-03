# Scenario reference

Run from the built checkout against an explicitly selected test/staging target:

```sh
export DEMO_API_URL=http://127.0.0.1:3010
./node_modules/.bin/logiparity scenario run examples/demo/scenarios/02-vehicle-breakdown.yaml \
  --target examples/demo/target.yaml
```

The command writes console output and `scenario.html`, `scenario.md`, `scenario.json`, `junit.xml` under `logiparity-scenario-report/02-vehicle-breakdown/`. Override the output directory with `--report-dir <directory>` (relative to the working directory). Post-scenario Parity has its own `parity/` directory, with the existing four file formats; downloaded artifacts live in `artifacts/`. JSON Parity schema v1 and normalized values are unchanged. Money and datetime presentation in HTML/Markdown uses the Parity configuration.

Exit codes: **0** all invariants and Parity pass; **1** at least one invariant or blocking Parity finding; **2** invalid configuration, state/source/module/HTTP/timeout/report error. Reports contain completed steps and runtime errors after execution begins. Preflight configuration errors go to stderr and do not create a successful result. JUnit exposes each invariant and post-scenario Parity as checks; runtime failures are errors. Time is explicitly unmeasured.

## Scenario YAML

```yaml
version: 1
name: Vehicle breakdown with orders on board
target: demo
setup:
  fixture: ../fixtures/day-55-drivers.json
events:
  - step: 1
    type: vehicle_breakdown
    params: {driver: D17, at: "13:20"}
wait:
  until: {replan_status: completed}
  timeoutSeconds: 60
  pollSeconds: 2
invariants:
  - no_order_lost
  - single_assignment
  - capacity_respected
  - eta_updated_for_affected
  - customer_notified_for_affected
  - {sla_window_violations: {max: 0}}
afterwards:
  parity: ../parity-scenario.yaml
```

`setup`, `afterwards` and `wait` are optional. Wait was previously required. Omit it to compare immediately after events/replan, or use `wait: {seconds: 2}` for a fixed real delay. Completion polling keeps the source/until form below. Invariant names must be unique. Events execute in ascending unique positive `step` order; `at` is a target parameter, not an instruction to sleep. Steps are sent once without automatic retry. The optional target replan request follows all events. Wait polls one configured singleton state source (`source: meta` by default), comparing every `until` field by exact scalar equality. Polling stops at the timeout. The demo advances virtual time by the poll interval (bounded by remaining time); other targets use real delays. Each source/request also has its own configured timeout; an in-flight read may finish after the polling deadline.

File references resolve relative to their YAML: fixture, custom module and afterwards Parity paths use the scenario directory; adapter paths use their containing target/Parity directory. `${ENV_VAR}` interpolation occurs in parsed YAML scalars. Request placeholders use a separate grammar, described below. Unknown fields, duplicate YAML keys and missing environment values are errors.

## Target mapping and mutation scope

[The complete demo target](../examples/demo/target.yaml) maps six event types to HTTP templates, setup/replan/clock requests, adapter state sources and fresh artifacts. Target files require `environment: test` or `staging`, **`allowMutations: true`**, and a matching scenario target name. These declarations are explicit configuration consent; they do not classify a hostname as production. Choose only test/staging URLs and credentials. Setup/events/replan can change data. There is no automatic rollback or retry; after a partial failure inspect the target before rerunning. Each shipped demo scenario explicitly resets its synthetic fixture first. Run scenarios serially against a shared demo instance.

```yaml
version: 1
name: staging-delivery
environment: staging
allowMutations: true
baseUrl: ${STAGING_API_URL}
headersEnv: {Authorization: {env: STAGING_API_TOKEN, prefix: "Bearer "}} # Reuse the raw token.
events:
  vehicle_breakdown:
    method: POST
    path: /test/drivers/{{params.driver}}/breakdown
    body: {reason: synthetic-test, at: "{{params.at}}"}
  http:
    method: PATCH
    path: "{{params.path}}"
    body: "{{params.body}}"
# Add state sources with the contract below, wait, optional setup/replan/clock/artifacts.
```

Methods are literal `GET`, `POST`, `PUT`, `PATCH` or `DELETE` in the trusted target file; GET cannot have a body. `http` is a configurable custom request, with its method fixed by the mapping. Only mapped events can execute. A whole-value placeholder preserves the JSON type (arrays, objects, numbers, booleans); embedded placeholders require scalars. Embedded path values are URL-encoded. An exact path placeholder allows an event to select a path, still subject to the same-origin check. Placeholder roots are `params` and `step` for events, `fixture` for setup, `seconds` for clock advances. Property access is own-property only; prototype names, malformed/unknown tokens and cross-origin/credential-bearing URLs fail before injection. Redirects are rejected. Target credentials belong in `headersEnv`, not literal headers or event parameters; reports omit request bodies and response bodies.

The runner loads YAML, fixture, custom modules and Parity configuration and renders HTTP plans before setup. State validation and affected-key derivation occur after optional setup but before events, using the baseline snapshot. Configured adapters may access their own explicitly configured origins; the event HTTP same-origin restriction does not rewrite adapter targets. A running custom module is trusted local code with Node permissions, without a sandbox or execution timeout.

## Canonical state for built-in invariants

Each named state source uses the existing REST, CSV, XLSX, UI or SQL adapter configuration. Map the fields required by the selected invariants below. The collection table shows the union of fields used by the full demo. IDs are nonempty strings and unique within each collection; missing collections, malformed scalar types or duplicate IDs are runtime errors. Quantities accept finite nonnegative numbers or plain nonnegative decimal strings; flags accept booleans or the exact strings `true`/`false`. Times must be ISO instants with an offset. The raw adapter snapshots remain available to custom checks.

| Source          | Required fields                                               |
| --------------- | ------------------------------------------------------------- |
| `orders`        | `id`, `status`, `units`, `zone`, `eta`, `delivery_end`        |
| `drivers`       | `id`, `vehicle_id`, `available`                               |
| `vehicles`      | `id`, `capacity`, `operational`                               |
| `assignments`   | unique `id`, `order_id`, `driver_id` (one row per assignment) |
| `notifications` | unique `id`, `order_id`, `type`, `created_at`                 |
| `meta`          | one row: `id`, `replan_status`, `clock`                       |

Active orders exclude `delivered` and `cancelled`. Cancellation retains the order record and removes its assignment. Completed deliveries keep their historical single assignment. Separate assignment rows allow double assignment to be detected even when the order's primary driver looks normal.

Affected keys are derived from the **baseline** and event parameters: `driver` for no-show/breakdown, `zone` for traffic, `orders` for cancellation, and `driver` or `vehicle` for capacity changes. The custom HTTP event can declare `affectedKeys`; the target does not supply the built-in affected set. Affected ETA and notification checks validate their baseline references before events.

| Invariant                         | Checks                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no_order_lost`                   | Every baseline order ID is still present, including cancelled orders.                                                                                    |
| `single_assignment`               | Each noncancelled order has exactly one assignment; cancelled orders have zero; assignment orders exist; requested cancellations are reflected in state. |
| `capacity_respected`              | Active assignment units per vehicle do not exceed capacity; each active assignment uses an available driver and operational vehicle.                     |
| `eta_updated_for_affected`        | Each affected active order has a changed ETA instant. Cancelled orders are exempt.                                                                       |
| `customer_notified_for_affected`  | Every affected order, including cancellations, has a notification ID absent from baseline, with timestamp at/after the baseline clock.                   |
| `sla_window_violations: {max: 0}` | Number of active orders whose ETA exceeds delivery end is within the inclusive maximum.                                                                  |

Every result has `name`, `passed`, `affectedKeys` and `explanation`. Failing keys are sorted; a passing SLA check with a nonzero allowance can still list observed violations. These checks establish the documented snapshot properties, not optimization quality or proof of customer message delivery.

## Select only the state you need

Built-ins validate and read only their required sources and fields. Unknown or malformed required data fails before event injection. Unrelated configured sources are not read. `wait.source` can be any configured singleton source with the fields in `wait.until`; it does not need to be named meta or include the canonical clock fields.

| Invariant                        | State sources and required fields                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no_order_lost`                  | orders: id.                                                                                                                                                      |
| `single_assignment`              | orders: id, status; assignments: id, order_id, driver_id.                                                                                                        |
| `capacity_respected`             | orders: id, status, units; assignments: id, order_id, driver_id; drivers: id, vehicle_id, available; vehicles: id, capacity, operational.                        |
| `eta_updated_for_affected`       | orders: id, status, eta; assignments: id, order_id, driver_id, plus the event-dependent fields below.                                                            |
| `customer_notified_for_affected` | orders: id, status; assignments: id, order_id, driver_id; notifications: id, order_id, created_at; singleton meta: id, clock, plus event-dependent fields below. |
| `sla_window_violations`          | orders: id, status, eta, delivery_end.                                                                                                                           |

Affected-order checks additionally need orders.zone for traffic_delay, or drivers.id and drivers.vehicle_id when capacity_change identifies a vehicle. Driver-based events derive affected keys from assignments. single_assignment verifies cardinality, cancellation and order references; capacity_respected verifies driver and vehicle resources. Custom modules and JSONPath checks can access any configured source, so a run containing a custom check reads all configured sources.

Orders and assignments alone cannot establish that replanning executed: unchanged snapshots can satisfy both `no_order_lost` and `single_assignment` even if no replan ran. Add a completion source that identifies the requested run, a custom check of reassignment away from the absent driver, or appropriate ETA/resource checks for the intended behavior.

A minimal no-show scenario can use `invariants: [no_order_lost, single_assignment]` with only orders, assignments and its chosen wait source. See the [bring-your-own-API target](../examples/staging/driver-no-show-target.yaml) and [scenario](../examples/staging/driver-no-show.yaml). Their paths, IDs and payloads are placeholders to replace with your staging contract; they use no demo-specific replan or clock endpoint.

## Custom checks

A JSONPath check operates on `{before, after, events, affectedKeys, cancelledKeys}`. It supports the same safe subset as REST extraction: properties, quoted properties, numeric indexes and `[*]`, without scripts or filters. A single selected value is unwrapped; multiple values remain an array. Equality is deep and type-sensitive; a missing path fails the check.

```yaml
invariants:
  - name: replan completed
    jsonPath: $.after.meta[0].replan_status
    expected: completed
  - name: custom order contract
    module: ./invariants/order-contract.ts
```

A custom module receives `InvariantState` with this shape:

```ts
{
  before: Record<string, Record<string, unknown>[]>;
  after: Record<string, Record<string, unknown>[]>;
  events: {step: number; type: string; at?: string; params: Record<string, unknown>}[];
  affectedKeys: string[];
  cancelledKeys: string[];
}
```

The actual exported `ScenarioEvent` type narrows `type` to supported events. `state.events` is the ordered array of configured scenario events (step, type, optional at and params), not HTTP response objects or the target's event log. Source snapshots contain mapped field names. A target state source named `events`, if configured, is instead available as `state.before.events` / `state.after.events`; that source does not replace `state.events`.

TypeScript/JavaScript modules require `scenario run --allow-modules` and must export a default function. Entry paths must be relative to and resolve inside the scenario directory; absolute paths, parent escapes and escaping symlinks are rejected. This opt-in applies to library callers through `{allowModules: true}` in runScenario options, or the third argument to prepareInvariant. Jiti 2.7.0 supplies TypeScript loading on both supported Node versions. Opted-in modules are imported during preflight and may execute top-level code. The function receives a cloned snapshot and must return (or resolve) exactly an `InvariantResult`; thrown exceptions or malformed results exit 2.

```ts
import type { InvariantState, InvariantResult } from 'logiparity/scenarios';
export default function check(state: InvariantState): InvariantResult {
  const orders = state.after.orders ?? [];
  return {
    name: 'order count',
    passed: orders.length === 2750,
    affectedKeys: [],
    explanation: `Observed ${orders.length} synthetic order records.`,
  };
}
```

## Fresh post-scenario Parity

Optional target `artifacts` are GET requests with safe basename filenames ending in `.csv`/`.xlsx`. They are downloaded after invariant evaluation, including when an invariant fails, and before Parity. The runner exposes the absolute artifact directory to that Parity config as `${LOGIPARITY_SCENARIO_ARTIFACT_DIR}` without changing process environment. Downloads use target headers, same-origin/redirect restrictions and the target timeout. Repeated runs replace artifacts in the chosen report directory; all outputs should be treated as sensitive test data.

The existing comparison engine supplies normalization, aggregates and `failOn`. A consistent API/export can pass Parity while an operational invariant fails: losing an order from every surface is still a loss. The five shipped scenarios exercise 55 drivers/2,750 orders with spare capacity and a deterministic synthetic planner. `BUG_REPLAN_LOSES_ORDER` and `BUG_DOUBLE_ASSIGN` reproduce the independent domain failures; see [bug switches](../apps/demo-delivery/BUGS.md).

Rendered request path segments equal to `.` or `..`, including percent-encoded forms, are rejected before URL normalization or sending. Configuration files and opted-in modules are trusted input; the module entry restriction does not sandbox its imports or Node permissions. AI-generated scenario drafts cannot contain module invariants.

For target request headers, `headersEnv: {Authorization: {env: STAGING_API_TOKEN, prefix: "Bearer "}}` reuses the raw token also named by REST `auth.tokenEnv`. A string value remains supported for an environment variable already containing the complete header value. All referenced variables are checked in preflight; configured secret values are redacted from errors and reports.

A scenario that selects only `no_order_lost` and `single_assignment` emits a warning in every scenario report: these invariants cannot detect a replan that never ran. The warning points to the state-selection section above and does not change the exit code. An `affected_reassigned` invariant remains on the roadmap.

## Reassignment and validation

Run `logiparity scenario validate <scenario.yaml> --target <target.yaml>` before injecting events. Validation checks schemas, selected state mappings, request paths, environment names and confined fixture/module paths without opening sources or executing modules. If `validate --config` receives a target file, it prints this command.

`affected_reassigned` reads the pre-event baseline, identifies active orders on the absent driver or broken vehicle, then requires exactly one different driver after replanning. Delivered and cancelled baseline orders are excluded. It fails when the replan never ran. Configure orders, assignments and drivers (including driver vehicle_id for vehicle events). This is the fix for the limitation warning from minimal lost-order/single-assignment checks; the warning appears only when affected_reassigned is absent. The demo no-show and breakdown scenarios and the staging example include it.

`allowedHosts` is required on mutation-enabled targets and applies to state reads and mapped requests before network I/O. `environment: test` is a label. Fixtures must remain inside the scenario directory even through symlinks. Every path placeholder is URL encoded; put literal route separators in the template, for example `/events/{{params.event}}`. Placeholder values cannot contain whitespace or controls.

Set `pagination.sizeParam` explicitly for a staging API; its default is `limit`. Both the configured page size and the API cap must agree.
