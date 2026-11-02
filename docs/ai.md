# Optional AI assistance

AI commands create draft Parity YAML, scenario YAML or a Markdown explanation. They are **off by default**, including when provider variables happen to be set. Normal `check`, `scenario run`, `init` and help do not invoke AI. Test/staging scope still applies.

## Preview locally

After `npm run build`, these commands work without provider configuration:

```sh
./node_modules/.bin/logiparity ai suggest-config --openapi examples/ai/openapi.yaml --entity shipment
./node_modules/.bin/logiparity ai scenario --from "Two vans broke down during the afternoon peak"
./node_modules/.bin/logiparity ai explain examples/ai/report.json --ai-config examples/ai/settings.yaml
```

The CLI prints the destination endpoint/model (or environment placeholders), a masked Authorization header and the exact JSON request body. This includes all system instructions and the redacted user data. Without `--send`, it makes no request, creates no draft/directory and exits 0. The shipped inputs are [handwritten synthetic fixtures](../examples/ai/README.md), not live requests or provider-generated examples.

## Generate a draft

Set all three variables using your environment/secret-management mechanism:

| Variable | Meaning |
| --- | --- |
| `LOGIPARITY_AI_BASE_URL` | API base, e.g. `https://provider.example/v1`; `/chat/completions` is appended under this exact prefix. |
| `LOGIPARITY_AI_MODEL` | Your provider's explicit model identifier; no default or automatic model selection. |
| `LOGIPARITY_AI_API_KEY` | Request credential, sent only in the Bearer Authorization header, omitted from previews. |

Use HTTPS for remote services. HTTP is supported for local/explicitly configured providers. URLs must not embed credentials, query strings or fragments. Configure an API base, not the complete chat-completions URL. Missing variables prevent a send and return 2. Credentials/model/URL values are not interpolated into input files; no dotenv loader or auto-discovery is used.

Review a local preview first, then add `--send`:

```sh
./node_modules/.bin/logiparity ai suggest-config \
  --openapi examples/ai/openapi.yaml --entity shipment \
  --ai-config examples/ai/settings.yaml --send --output logiparity-ai-drafts/parity-draft.yaml

./node_modules/.bin/logiparity ai scenario \
  --from "Two vans broke down during the afternoon peak" \
  --send --output logiparity-ai-drafts/scenario-draft.yaml

./node_modules/.bin/logiparity ai explain examples/ai/report.json \
  --ai-config examples/ai/settings.yaml --send --output logiparity-ai-drafts/explanation.md
```

Each send rebuilds its input, flushes its request preview to stdout and then makes **one** provider request. It does not prompt interactively or retry. `--send` is explicit authorization for that invocation; changing input/settings between invocations changes the displayed payload. Preview and actual request body are compared in e2e tests. Authentication is the only intentionally hidden request value. Handle preview logs as sensitive test artifacts.

Generated output always begins with:

```text
# AI-generated draft: review before use
```

The CLI writes a new file with mode 0600. YAML outputs require `.yaml`/`.yml`; explanations require `.md`/`.markdown`. `--output` is used for sends; preview mode does not create it. Without `--output`, the CLI uses a unique UUID filename under ignored `logiparity-ai-drafts/`. New parent directories use mode 0700 (existing directory permissions are unchanged). Existing files/symlinks are rejected before the provider call, and an exclusive write protects against files created concurrently. The input report/spec is never modified.

Draft YAML is parsed with duplicate-key/alias checks and validated against the existing Parity/scenario schema. For Parity structural validation only, environment placeholders are replaced in memory with a synthetic URL; no real variables or referenced files are read. Placeholders remain literal in the written draft. This supports conventional URL/file placeholders, not arbitrary environment-substituted numbers or port fragments. A malformed draft exits 2 without a file. A single surrounding YAML/Markdown fence is stripped if supplied by a provider.

Validation establishes structure, not correctness or safety of proposed mappings. Review generated fields, currency/timezone assumptions, paths, targets, steps and custom modules. Nothing runs the draft, loads its fixtures/modules, fetches its suggested targets or changes an existing configuration. A later manual `check` or `scenario run` is a separate user action.

## Settings and redaction

Pass `--ai-config <settings.yaml>`; this is separate from Parity's `--config`:

```yaml
version: 1
redactFields:
  - customer_email
  - $.report.findings[*].key
  - $.openapi.components.schemas.Shipment.properties.customer_id.example
timeoutMs: 30000
maxFindings: 100
```

Defaults are no additional redactFields, timeout 30 seconds and 100 included findings. `timeoutMs` accepts 1–300000; `maxFindings` accepts 1–1000. Unknown settings are errors. Provider credentials stay in environment variables, not settings files.

Additional fields can be repeated or comma-separated on the CLI and are merged with settings:

```sh
./node_modules/.bin/logiparity ai explain examples/ai/report.json \
  --redact-fields customer_email --redact-fields '$.report.findings[*].key'
```

Plain field names match object property names at every depth, case-insensitively, and replace the whole value/subtree with `[REDACTED]`. For Parity findings whose `field` matches a plain redaction name, `expected`/`actual` values are also masked. Selected string values of at least eight characters are conservatively scrubbed from other string values, property keys and provider output, including copies in explanatory messages. The configured API credential is also scrubbed from prompt data, output and CLI errors. Numbers and strings shorter than eight characters are never collected as global literal secrets. Their selected fields remain masked, but unrelated IDs and prose retain those short values; `auth_retries: 1` cannot corrupt `L1001`.

Defaults always mask authorization, proxy-authorization, cookie, set-cookie, password, secret, token, apiKey/api_key, access_token, refresh_token and client_secret properties. Additional default names include passwd, pwd, private_key, credential, jwt, subscription_key and api.key. URL query/fragment keys key, sig, signature, X-Amz-Signature, X-Amz-Credential and access_token, URL passwords and free-text Bearer tokens are masked even when short. Long detected credential literals are also removed from copied messages and provider output. This is **not a general PII detector**. Bare prose, secrets under unrelated names and unknown encodings need your review. `--redact-fields description` masks the entire free-text scenario input; there is no semantic text anonymizer.

A scoped path starts at the user-data object: `$.openapi` for the spec, `$.report` for the sampled report and `$.description` for scenario prose. The supported non-evaluating subset is properties/quoted properties, numeric indexes and `[*]`; scripts, filters, recursive descent and whole-root `$` are rejected. Unmatched selectors mask nothing, so inspect `maskedFields` and the preview. Prefer a path to `...example` when masking OpenAPI examples while keeping schema types; a global field name masks the entire matching property definition.

Redaction never mutates source data. Literal scrubbing can mask coincidentally equal/common text; if it makes a returned YAML draft invalid, the command fails without writing it. To keep redaction bounded, more than 5,000 distinct sensitive values or 1 MiB of collected sensitive text is rejected before sending. Paths containing commas should be provided through YAML settings because the CLI splits commas.

## Input selection and limits

Input is a local regular YAML/JSON file, up to 16 MiB. OpenAPI requires a 3.x version string and a `paths` object; this is a lightweight input check, not a complete OpenAPI validator. `$ref` is preserved as text; local/remote references are never resolved. Cyclic/excessive aliases, nonfinite numbers and non-JSON values are rejected. File contents never undergo `${ENV}` interpolation, and no URL is used as an input file fetch.

Explain accepts existing **Parity schemaVersion 1** reports, including the additive groups array. For scenario output, use `parity/report.json`. The user payload contains entity/aggregate summaries, any pattern groups, the first `maxFindings` findings in report order and a `sampling` section with exact full-input totals, blocking count and counts by type. Omitted findings are explicitly counted; only included findings provide record details. Redaction runs on the selected structured payload, including group values and summaries. Money stays in exact minor-unit strings; datetime epochs and the existing report files remain unchanged. Report currency cannot be inferred without configuration context.

The serialized provider body is limited to 256 KiB and response bytes to 1 MiB, including streamed bodies without Content-Length. Oversized requests fail before contacting a provider. Reduce the input or maxFindings and inspect a new preview. Timeouts cover response headers and body. Provider response bodies are omitted from errors; 429/5xx do not trigger automatic paid retries. Redirects are rejected, and requests go only to the configured endpoint. Refusals, tool calls, truncated/nontext/empty completions and malformed responses produce no draft. Provider prose is saved for review, not rendered or executed by LogiParity.

## Provider interface and compatibility

The installed package exposes `logiparity/ai` (source workspace: `@logiparity/ai`), which exports `AiProvider` with `complete(messages): Promise<string>`, `prepareDraft`, `prepareDestination` and `generateDraft`. A custom provider can be injected into the library; the CLI uses `ChatCompletionsProvider`. The interface has no provider SDK dependency.

The built-in adapter sends only `model`, system/user `messages` and `stream: false`, plus a Bearer header. It expects a nonempty string at `choices[0].message.content`, `finish_reason: stop`, and no refusal/tool calls. It follows the documented [Chat Completions request/response contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Providers/models that do not support this text/system-message contract need a custom library provider. Vendor extensions, Responses API, tools, streaming UI, model discovery and automatic provider failover are unsupported by the built-in provider.

Tests inject library mocks and use isolated loopback HTTP providers with synthetic credentials; CI makes no real AI API calls. They exercise all commands, exact preview/body agreement, redaction, disabled behavior with missing variables, non-AI command isolation, non-execution, exclusive output writes and provider failures. No claim is made about response quality or a particular live provider/model.

Exit codes: 0 for a local preview or a saved draft; 2 for input/config/provider/schema/output errors. Exit 1 retains its Parity/scenario finding meaning and is not an AI quality score.

Default redaction normalizes key names by case and by removing hyphens, underscores and dots. Names containing token, secret, password, passwd, pwd, apikey, auth, cookie, session, privatekey, credential, jwt, signature or subscriptionkey are masked, including credential-looking query parameters inside URL strings. Copied masked values are scrubbed from summaries and provider output. AI scenario drafts containing module invariants are rejected before saving.
