# Vendored ExcelJS Node runtime

Upstream: [exceljs 4.4.0](https://registry.npmjs.org/exceljs/-/exceljs-4.4.0.tgz), MIT, copyright Guyon Roche.

Registry integrity: `sha512-XctvKaEMaj1Ii9oDOqbW/6e1gXknSY4g/aLCDicOXqBE4M0nRWkUu0PTp++UPNzoFY12BNHMfs/VadKIS6llvg==`.

The Node entry, lib directory, TypeScript declarations and LICENSE are copied byte-for-byte from that archive. Browser bundles and upstream development tooling are omitted. The private packaging name is @logiparity/exceljs, version 4.4.0-logiparity.1. Runtime dependency requirements for unzipper and uuid are explicitly 0.12.5 and 11.1.1; the remaining upstream requirements are retained. These are the dependency versions previously tested through root overrides. No runtime source is patched.

The private package is bundled inside LogiParity. Its dependency manifest agrees with the bundled tree, so consumers do not need overrides. Keep the upstream license and this provenance record when updating or redistributing it.
