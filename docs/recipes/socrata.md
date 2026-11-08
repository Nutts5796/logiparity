# Comparing Socrata data

Socrata can omit null-valued JSON properties, return pages without completion metadata and publish calendar dates in different formats. Configure each behavior explicitly. The public FMCSA [Company Census File](https://data.transportation.gov/d/az4n-8mr2) and [SMS motor carrier census](https://data.transportation.gov/d/kjg3-diqy) illustrate these shapes.

Use `$order` on the unique key when paging with `$offset`. Order does not freeze a changing dataset: compare the same filter and dataset version, and check update metadata before/after the run. A source fragment for Company Census is:

```yaml
type: rest
baseUrl: https://data.transportation.gov
path: "/resource/az4n-8mr2.json?$select=dot_number,power_units,mcs150_date&$where=phy_state='IA'&$order=dot_number"
items: $[*]
pagination:
  type: offset
  offsetParam: $offset
  sizeParam: $limit
  size: 5000
  allowShortFirstPage: true
fields:
  id: $.dot_number
  units: {path: $.power_units, missing: null}
  filing_date: {path: $.mcs150_date, missing: null}
```

Map these fields in a second source and add entity rules such as `units: {type: number}` and `filing_date: {type: date, format: yyyyMMdd}`. For SMS versus Company Census, date formats can instead be `{sms: dd-MMM-yy, census: yyyyMMdd}`. Two-digit years use the fixed 1969–2068 window. Per-field `missing: null` tolerates absent properties selectively; source `absentAsNull: true` opts in for all mapped fields. Keys must still be present and valid.

No total-count metadata is returned in the owner's Socrata observations. `allowShortFirstPage` accepts a small first page but does not verify completeness; a later short page also ends the read. LogiParity emits a warning in each report. Make a separate count request with the same filter and compare it with the physical source count:

```sh
curl --get 'https://data.transportation.gov/resource/az4n-8mr2.json' \
  --data-urlencode '$select=count(*)' \
  --data-urlencode "\$where=phy_state='IA'"
```

Use the matching `$where` for every source, including an active-record filter where applicable. A count from another dataset version cannot prove the earlier extraction complete. There is no automatic count request in LogiParity 1.2.0.

The owner's archived 2026-11-08 investigation compared Iowa and Vermont. Company Census JSON and CSV matched on all 25 selected fields for 58,074 Iowa records and 8,378 Vermont records; independent server-side counts agreed. These are historical observations, not results of the smaller example above or claims about current counts. Both representations came from the same Socrata engine, so this checks extraction consistency rather than registration accuracy.

SMS versus active Company Census produced 5,173 Iowa and 856 Vermont findings in that 1.1.0 investigation. Different populations, snapshot timing and field definitions matter: the hazmat definitions differ, and repeated power-unit changes do not imply a vocabulary mapping. Read the data dictionaries before treating one publication as authoritative. This recipe quotes only aggregates from the owner's `fmcsa_parity/findings.md`, with no carrier names or contact fields.
