# Dashboard experiment status

Read `AGENTS.md` and [the experimental delivery workflow](experimental-delivery-workflow.md)
before changing this experiment. The accepted integration destination is
`experiment/dashboard-reconstruction`, not `main`.

## Current state

The experimental sidecar runs accepted
`a9e3b926890994085e1006a97cb0c6883ca8b8ae`, verified October 8, 2026 in Denver
(05:36 UTC October 9).
Focused topics #194, #196, #197 and #198 improve retained coverage, finite
same-time preparation, visible-demand scheduling and chart payload size. Each
passed all 20 checks and merged separately into `experiment/dashboard-reconstruction`.
Retry-controls #200 passed all 20 exact-head checks and merged separately into
experimental. Retry now unlocks at the server deadline without fetching failed
intervals automatically; explicit recovery removes the stale rate warning.
See the [smoothing contract and historical assessment](dashboard-history-smoothing.md)
and [current verified release record](dashboard-history-retry-release.json).

Continuous prepared loading defaults on at `/dashboard-experimental/`; no URL
flags are needed. Historical Scroll starts disabled on every load. Missing or
evicted intervals still need bounded reads. Animations, full-DPR charts, request
allowances and provider budgets are unchanged. Production stays on `main` at
`8e48acc`; its containers, private configuration, routing and history were
unchanged. Sidecar image `9818b77` is preserved for rollback.

The PR #114 promotion was reverted through #117. The reconstructed baseline
released October 7 is historical evidence in the
[original release record](dashboard-recovery-release.json), not the current
runtime. Subsequent scrolling and prepared-history topics are accounted for in
the ledger. No experimental UI promotion to main occurred.

[Recovery status](dashboard-recovery.md) and the
[machine-readable ledger](dashboard-recovery-ledger.json) account for sources,
topic ownership, accepted PRs, validation, and remaining work. Original branches
and tagged checkpoints remain preserved. Do not re-merge their reverted ancestry.

## Product constraints

- Keep I-25 and I-70 side by side, with corridor summaries, speed charts, incident
  tables, health, and focused maps. Do not make the dashboard map-first.
- Preserve the Black Forest, Goldenrod, Burnt Rose, Ivory, and Almond Silk palette,
  readable light/dark themes, high-resolution charts, and accepted visual motion.
- Keep incident first/last-seen, active state, source, corridor, and mile-marker
  semantics truthful. Missing coverage and old observations are not live data.
- Estimate freshness from successful observations, not whether speeds changed.
  Every degraded state needs a concrete reason and useful next action.
- Preserve provider-free local demo/retained/replay review modes as they are
  reconstructed. Do not add provider requests for dashboard validation.
- Keep production storage, ingestion, geometry, and quota foundations intact.
  They are not automatically topics to replay simply because old experimental
  history contains an earlier version.

## Parked work

The old speed-limit context, I-70 validation, I-25 tile-projection, and semantic
zone experiments are not implied dependencies. They may affect ingestion, schema,
or budgets and remain parked. Safety/reversion branches are checkpoints, not
active product changes.

## Local scrolling experiment

Historical scrolling is implemented and locally assessed through separate
topics, not a wholesale merge of draft #116. Local fixture banners identify
synthetic responses, not live traffic. Existing user previews and containers on
ports 8080 and 8091 were not replaced by the latest smoothing task. Its isolated
bounded assessment preview was stopped after verification. Wheel/keyboard
navigation affects only the graph window; cards, tables,
health and maps retain their selected current window. All five ranges, both
mounts, failures and responsive layouts were checked without provider requests.

The authorized smoothing release, assessment and retry cleanup are complete.
Release evidence and current contract were reconciled separately from the code
topic. A newer documentation-only integration tip does not require rebuilding
or restarting this exact accepted application image. Cold HTML
bootstrap remains separately tracked in #192; no ongoing benchmark or renderer
rewrite is running. Production UI promotion still requires a separate explicit
task and authority, not an automatic consequence of experimental integration.
