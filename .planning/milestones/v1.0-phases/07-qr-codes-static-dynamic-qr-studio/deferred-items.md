# Deferred Items — Phase 07 (QR Codes)

Out-of-scope discoveries logged per gsd-executor's scope-boundary rule (not fixed,
just tracked).

## From Plan 07-03

- **REQUIREMENTS.md checkbox drift (pre-existing, not introduced by 07-03):** All
  `QR-0x` checkboxes (`QR-01` through `QR-07`) under `### QR-Codes` are already
  marked `[x]` complete, and the traceability table marks them all `Complete`,
  even though only 07-03 of the 9 planned Phase 7 plans has an executed SUMMARY
  at the time this was discovered. `gsd_run query requirements.mark-complete
  QR-01 QR-05 QR-06` (run at the end of 07-03) reported
  `already_complete: [QR-01, QR-05, QR-06]` rather than `marked_complete`,
  confirming these were checked before this plan ran. Root cause not
  investigated (out of scope for 07-03) — likely an artifact of initial
  REQUIREMENTS.md generation defaulting phase-level requirements to checked.
  Left as-is per the scope-boundary rule; flagging so a later phase-gate/
  verify-work pass over Phase 7 doesn't mistakenly treat this as fully
  implemented before all 9 plans/waves land.
