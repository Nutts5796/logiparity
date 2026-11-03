# JUnit schema fixture

JUnit.xsd is an unmodified copy of Windy Road Technology Pty. Limited's Apache Ant JUnit/JUnitReport schema, retrieved on 2026-11-02 from https://github.com/windyroad/JUnit-Schema (master/JUnit.xsd). Copyright © 2011 Windy Road Technology Pty. Limited. Distributed under Apache-2.0; its LICENSE is included here.

SHA-256: `147ff89ef34a82f9a1b2951e7cad251b98c9a7a48a0e0c8e44937141791f57a8`.

Tests validate offline with `xmllint --nonet --noout --schema tests/fixtures/junit/JUnit.xsd <report.xml>`. No schema fetch occurs during tests. A deliberately invalid report is rejected to verify that schema validation is active. This is a development fixture, not an additional runtime dependency.

CI verifies this schema and its license byte for byte against the upstream tarball at commit `cfa434d4b8e102a8f55b8727b552a0063ee9044e` with `npm run check:third-party`. No runtime vendor directory remains.
