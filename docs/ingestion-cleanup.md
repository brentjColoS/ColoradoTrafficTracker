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

Next: extract decoding, coverage planning, geometry resolution, and request
execution, then review the five segments together. Report runtime movement and
net deletion separately from tests and this record.
