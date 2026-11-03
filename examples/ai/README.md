# Synthetic AI inputs

These are AI-generated static fixtures for local previews, not results from a provider or claims about an observed production/demo defect. The OpenAPI document describes a small synthetic shipment surface; the Parity report also includes hypothetical email data for redaction demonstration. Every record and address is synthetic.

After building, from the repository root:

```sh
./node_modules/.bin/logiparity ai suggest-config --openapi examples/ai/openapi.yaml --entity shipment --ai-config examples/ai/settings.yaml
./node_modules/.bin/logiparity ai scenario --from "Two vans broke down during the afternoon peak"
./node_modules/.bin/logiparity ai explain examples/ai/report.json --ai-config examples/ai/settings.yaml
```

These commands make no provider requests or output files. For generated drafts, configure the three provider environment variables and add `--send`; see [AI reference](../../docs/ai.md). No provider URL, model or credential is enabled by these fixtures.
