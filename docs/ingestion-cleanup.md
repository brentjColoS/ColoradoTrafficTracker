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
| 6 | Isolate pure flow matching, route sampling, speed zones, slowdown signals, signatures, and collection profiles. | Direct projection tests and retained protobuf-to-publication contracts; shared tile tag/geometry helpers have one owner and new owners join the mutation gate. |
| 7 | Separate flow sample assembly and publication from provider polling. | Source metadata, incident snapshot metadata, per-sample/zone transactions, evidence-before-sample order, and batch map publication retain their existing boundaries; failure-order regression added. |
| 8 | Give optional TomTom tile incidents their own provider orchestration and mapping. | Flow and incidents share one access object for quota metrics, HTTP execution, and cached geometry; the unused coupled pull is removed, with independent incident fixtures and retained flow contracts. |
| 9 | Isolate legacy point HTTP, sampling, incident filtering, and sample persistence. | The scheduler keeps leases, cycle guards, metadata sync, per-corridor isolation, and metrics. Existing point-mode/fallback tests remain; average reduction has one input-order-preserving implementation. |
| 10 | Separate provider probe transport and pure failure classification from guard state transitions. | Startup/account isolation, recovery probes, credit-vs-auth classification and guard transition tests retained; probe requests still pass through the same budget governor. Status persistence and transaction ownership stay in the guard service. |

The first batch retains polling cadence, tile footprint, precision policy,
persistence transactions, and HTTP contracts, with a deliberate retry-refund
correction. Before the second batch, two existing defects are fixed: missing
TomTom accounts now produce actionable quota health rather than an exception;
incident configuration explicitly binds its canonical constructor so overrides
apply. Missing nested settings and the legacy Java constructor retain defaults.
Review enabled/provider/cadence overrides before a future ingestion rollout.

Segments 6–10 separate pure projection, publication, independent incident polling,
legacy point mode, and guard probe transport/classification. Flow and tile
incidents share one quota/HTTP/geometry access object. Publication retains the
per-sample/zone transaction and existing evidence/map failure boundaries. Guard
status persistence and transaction ownership remain in the guard service.

New owners join the existing ingestion mutation gate; thresholds are unchanged.
Combined verification uses synthetic provider responses and a disposable
PostgreSQL database with live provider tests disabled. Report runtime movement
and net deletion separately from tests and this record. Exact accepted revisions,
checks, runtime comparisons and recovery evidence remain in the recovery ledger.

After review/reconciliation, reassess incident event normalization/lifecycle/SQL
and guard cycle-state policy as separate bounded work. Production ingestion
promotion requires a separate decision.
