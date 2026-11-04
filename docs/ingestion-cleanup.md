# Ingestion cleanup

Integration destination: `experiment/dashboard-reconstruction`. Initial parent:
`5c0a9c628046074bd67ba8943061cf3b50944271`. Work proceeds in five-segment batches,
with combined review and reconciliation before continuing. The
[recovery ledger](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267)
records exact topics, accepted revisions, checks, and runtime state.

Production ingestion is outside this experimental rollout. API-sidecar health
does not validate an ingestion change. Use fixtures and disposable databases;
preserve provider budgets, source precision, leases, transactions, and history.

| Segment | Change | Evidence |
| --- | --- | --- |
| 1 | Characterize decoded zero/moving speeds, source metadata, map publication, malformed payloads, and blocked batches. | Synthetic protobuf and mocked HTTP; existing precision, retry, and account-rollover tests retained. |
| 2 | Give vector-tile decoding and tile coordinates explicit owners. | Direct decoder tests cover tags, zero values, signed deltas, multiple paths, points, polygons, and malformed input; full-pipeline contracts retained. |
| 3 | Isolate tile coverage, budget estimates, zoom overrides, and exclusive I-70 precision selection. | Direct planner tests plus retained eight-request footprint, shared-tile and precision-policy tests. |
| 4 | Share configured/routed geometry resolution while preserving provider-local caches and point-mode sampling fallback. | Resolver tests cover configured geometry, routed persistence/cache, retry after failure, and point-mode bounding-box fallback. |
| 5 | Separate tile HTTP execution from quota configuration, snapshots, reservations, and metrics. Correct refunds after a failed retry. | Before/after regression proves the original four-call batch refunded two unissued calls instead of three; direct client/quota tests retain retry charging, headers, filters, and account isolation. |

The first five segments retain the existing polling cadence, tile footprint,
precision policy, persistence transactions, and HTTP contracts. The retry-refund
correction is the deliberate behavior change. New decoder, planner, resolver,
client, and quota owners are included in the existing ingestion mutation gate;
quality thresholds remain unchanged.

Combined verification uses synthetic provider responses and a disposable
PostgreSQL database, with live provider tests disabled. Report runtime movement
and net deletion separately from tests and this record. Exact acceptance and
runtime evidence remain in the recovery ledger.

After batch review: isolate flow calculations and sample assembly, then finish
provider coordination and legacy point-mode separation. Stop after this batch
until its combined review and reconciliation are complete.
