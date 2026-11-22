# Collection and provider budgets

The original continuity investigation led to separate flow and incident
collection, durable request accounting, controlled account rollover and explicit
recovery states. This page replaces that completed action plan; the original
investigation is preserved separately.

## Current decisions

TomTom flow and CDOT roadway reports run on independent schedules. A temporary
failure in one source does not discard usable observations from the other.
Provider freshness comes from successful reads, including reads whose values
have not changed.

Each enabled TomTom account has its own monthly counters and limits. A full
tile batch is reserved before requests are sent. Collection uses primary first,
then rolls to secondary when primary cannot afford another full batch. Recovery
probes and retries consume the allowance too.

The guard distinguishes recoverable network/provider failures from conditions
that need operator action. One unavailable account is not an outage while
another account can continue collecting usable traffic.

## Current references

- [Project journey](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Project-Journey)
  describes what the provider constraint changed in the project.
- [Two-account operations](tomtom-two-account-operations.md) owns configuration,
  counters, reset evidence and account handoff procedures.
- [Health monitoring](healthchecks-io-monitoring.md) owns current operational
  thresholds and concrete failure reasons.
- [Data coverage](data-history-coverage.md) records retained-history boundaries.
- [Request accounting](../ingest-service/src/main/java/com/example/ingest_service/TrafficRequestBudget.java)
  and [account rollover](../ingest-service/src/main/java/com/example/ingest_service/TomTomAccountQuotaManager.java)
  provide the implementation.
