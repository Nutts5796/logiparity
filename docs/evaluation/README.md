# Cause evaluation: method, measured results and limits

These are **synthetic ground-truth results**, not real-data accuracy. Run `npm run eval:causes` from a source checkout to print the table and write `output/evaluation/causes.json`. The generator is in [tests/evaluation/causes.ts](https://github.com/Nutts5796/logiparity/blob/main/tests/evaluation/causes.ts); no private data is used. `npm run check:causes` additionally protects every previously correct planted label, without an accuracy threshold. It is also exercised by unit tests and CI.

## Method

Three fixed seeds (7, 42, 1203) and three primary sizes (96, 360, 1024) produce nine reports with mixed families in each report. The independently authored truth records each defect's entity/key/field/finding type and expected cause. Candidate ordering is shuffled. Matching controls include leading-zero keys, equivalent date formats and offset-free timestamp inputs with explicit parsing zones. Missing page rows, regular missing/extra keys, duplicates, stale statuses, case/whitespace/mixed formatting, numeric changes, cent/fixed money differences, date-only differences, time-zone/explicit timestamp offsets, vocabulary changes and blanks coexist. Two-member numeric plants test the minimum support of three.

The sample includes two deliberately difficult, observationally ambiguous families: all statuses are from an old snapshot with no matching anchor, and a vocabulary transformation reuses a reference code for another value. Truth comes from how these datasets were planted, even when two observed snapshots alone cannot establish that cause. These cases expose limitations rather than being removed to improve the score. No cause algorithm was changed for this evaluation.

Found means a planted defect has the corresponding finding; it is different from being correctly grouped. Correct label means all assigned groups agree with independently planted truth. Mislabelled records remain findings; the script prints the wrong assigned label. Ungrouped records have findings but no group. Missed means no corresponding finding. A false group has no member correctly explained by its assigned label, counted under the predicted cause family; this includes a group that identifies a real difference but gives it the wrong cause. Every group has a membership/ground-truth record in the JSON output. Dates, blanks, duplicates and one-off changes are expected individual findings, so their correct-label column is n/a.

## Executed output (2026-11-11)

| Cause / defect          | Planted | Found | Correct label | Mislabelled | Ungrouped | Missed | False groups |
| ----------------------- | ------: | ----: | ------------: | ----------: | --------: | -----: | -----------: |
| blank                   |      30 |    30 |           n/a |           0 |        30 |      0 |            0 |
| case_and_whitespace     |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| case_only               |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| date_only               |      30 |    30 |           n/a |           0 |        30 |      0 |            0 |
| datetime_offset         |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| duplicate               |       9 |     9 |           n/a |           0 |         9 |      0 |            0 |
| extra_sequence          |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| fixed_money             |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| individual              |       9 |     9 |           n/a |           0 |         9 |      0 |            0 |
| missing_sequence        |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| numeric_below_support   |      18 |    18 |             0 |           0 |        18 |      0 |            0 |
| numeric_drift           |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| page_boundary           |     441 |   441 |           441 |           0 |         0 |      0 |            0 |
| rounding                |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| stale_status            |      30 |    30 |            30 |           0 |         0 |      0 |            9 |
| stale_without_anchor    |    3999 |  3999 |             0 |        3999 |         0 |      0 |            0 |
| timezone                |      30 |    30 |            30 |           0 |         0 |      0 |            0 |
| vocabulary              |    3999 |  3999 |          3999 |           0 |         0 |      0 |            9 |
| vocabulary_reused_codes |    3999 |  3999 |          1779 |        2220 |         0 |      0 |            0 |
| whitespace_only         |      30 |    30 |            30 |           0 |         0 |      0 |            0 |

The measured run found 12864 of 12864 planted findings. It assigned 6549 correct and 6219 wrong labels, leaving 96 findings ungrouped; 0 planted findings were missed. On this chosen frequency mix, correct assigned labels / all assigned labels is **51.29%**; correct labels / all groupable plants is **51.22%**. These weighted figures are dominated by deliberately all-row vocabulary/stale cases, not a representative production distribution. The per-family table is the meaningful breakdown; no universal accuracy is claimed.

All 3999 unanchored stale plants were assigned vocabulary labels. 2220 reused-code vocabulary plants were assigned stale-value labels. The 18 two-member numeric plants remained individual because support is below three. Those observations motivate review of source definitions/timing; they are not fixed or disguised by a threshold. The regression guard stores compact membership lists for all 6549 previously correct findings; it does not bless wrong labels as expected truth.

This is an engine evaluation on canonical logical rows, not an adapter-throughput, malformed-file, arbitrary-input or production-accuracy benchmark. A single planted root cause can explain several field findings. Changing defect frequencies changes the aggregate percentages. Existing strict parsing and adapter regressions are separate.

## Real FMCSA sample: awaiting human review

[fmcsa-sample-for-review.csv](fmcsa-sample-for-review.csv) contains 50 deterministic randomly sampled group summaries, with **empty reviewer_verdict and reviewer_note**. Seed 130012 selects from the committed [sanitized population](fmcsa-groups-population.json): 73 groups from the locally available monitor Iowa report plus 12 published top-group summaries for Vermont. The sample has 42 Iowa and eight Vermont groups. Only state, entity/field, cause kind, count and wording are exported; no carrier names, keys, contact fields or individual rows are included.

Source hashes and available run metadata are stored with the population. Iowa's local report has no embedded run timestamp; it is not invented. The Vermont public summary is from 2026-11-08 and is capped to its published top 12 groups, so this is a mixed-snapshot convenience population, biased toward the available Vermont summaries, not a representative sample of all FMCSA differences. Reproducibility is from the committed sanitized population even if external sources change.

Regenerate to a **new** file and compare bytes; existing files are never overwritten:

```sh
npm run sample:causes -- --output /tmp/fmcsa-review-copy.csv
npm run review:causes
```

An owner/human reviewer may enter correct, misleading or wrong and a note after checking the claim against the actual field definitions, update times and supporting evidence. Leave a verdict blank if the summary is insufficient; request context in the note. The summarizer rejects unknown verdicts and keeps realDataAccuracy as **not measured** while any verdict is blank. All 50 are currently unreviewed. No real-data accuracy or reviewer agreement has been measured. Filling the file later estimates only this sampled population's judgments, not all FMCSA findings.

## Setup effort

[setup-time.md](setup-time.md) contains an unfilled manual-versus-suggest stopwatch protocol. Setup time, speedup, learning effects and human effort are **not measured**. Automated CLI duration is not a substitute for a participant measurement.
