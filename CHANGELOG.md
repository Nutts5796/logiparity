# Changelog

## [Unreleased]

## [1.0.0] - 2026-11-02

### Added

- Keyed comparisons across REST, CSV, XLSX, browser tables and PostgreSQL, with exact money, timezone conversion, aggregates and failure thresholds.
- Console, HTML, Markdown, JSON and JUnit reports with affected keys and screenshot evidence.
- Disruption scenarios, operational invariants, custom checks and a synthetic delivery demo with reproducible bug switches.
- Optional AI draft commands with payload previews and redaction.
- Standalone package, public library exports, a non-root Docker image and CI templates.

### Changed

- Fail unverified short first pages by default, with an explicit opt-out.
- Roll up one-to-many sources by key, summarize regular missing-record strides, and support fixed or omitted scenario waits.
- Add version and offline configuration-validation commands, a freight settlement example, checksum-verified installation and a slim container target.

- Detect REST page-size caps with explicit completion metadata, and warn on an unverified short first page.
- Accept numeric money only with `allowNumber: true`; reject extra nonzero decimal places.
- Summarize constant datetime offsets, money deltas and status mappings while retaining individual findings. Add JSON groups and HTML finding counts.
- Run selected scenario invariants with only their required state sources.
- Improve missing-column and unknown-key diagnostics, console UTC display, onboarding and staging CI examples.


### Security

- Check every UI redirect origin and reject scenario dot-segments before requests.
- Require explicit opt-in for scenario-local modules; reject executable module invariants in AI drafts.
- Mask normalized secret fields and URL query credentials, redact diagnostic path credentials and remove terminal control characters.

- Restrict SQL to validated read-only operations and browser reads to configured origins.
- Keep AI off by default, require an explicit send, and save generated drafts without execution or overwrites.
- Document test and staging scope, trusted custom modules and dependency audit limitations.
