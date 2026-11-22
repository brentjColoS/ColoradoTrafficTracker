![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

A flow cycle reserves requests for all required corridor tiles before fetching
begins. The reservation selects one TomTom account for the complete batch.

## Reserving a complete batch

[`TileTrafficPoller`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TileTrafficPoller.java)
builds a deduplicated coverage plan across corridors. It then calls
`TomTomAccountQuotaManager.reserveCompleteBatch` before fetching tiles:

1. Consider available accounts in primary-first order.
2. Find an account with room for the entire planned batch.
3. Reserve that batch in the durable request ledger.
4. Issue all initial tile requests with the selected account.

For an eight-request batch, a primary account with three requests left is
skipped. Secondary funds all eight, or the cycle pauses. This deliberately
leaves a small remainder unused instead of changing the coverage plan to spend
the last few requests. The account manager also records credential-free
selection and handoff evidence.

## Atomic reservations in PostgreSQL

The monthly ledger key is `(period_start, provider, account_id, product)`.
Separate accounts and products cannot accidentally spend a shared counter.
Migration [V17](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/resources/db/migration/V17__provider_account_request_budgets.sql)
adds the account dimension and preserves earlier usage as `primary`.

The decisive operation is a conditional update in
[`TrafficRequestBudget.reserveMonthlyForAccount`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TrafficRequestBudget.java):

```sql
update traffic_provider_request_budget_monthly
set requests_used = requests_used + ?, updated_at = now()
where period_start = ?
  and provider = ?
  and account_id = ?
  and product = ?
  and requests_used + ? <= ?
```

The conditional update provides atomicity: an affected-row count of one grants
the reservation. Java selects candidate accounts first, but the SQL predicate
decides whether the batch still fits when collectors reserve concurrently.
A preceding `INSERT ... ON CONFLICT DO NOTHING` creates the counter row if needed.

The account manager's complete-batch method is transactional, including its
account-transition record. The request ledger survives a process restart.

### Why the application stops below the allowance

The [documented account settings](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/tomtom-two-account-operations.md)
use a 190,000-request target and a 195,000-request application hard stop against
a 200,000-request provider allowance, per account. The hard stop leaves 5,000
requests of headroom on each account for accounting differences and traffic
outside the application's ledger. The target is a planning threshold; the
conditional reservation enforces the hard stop.

The provider's counter remains authoritative about actual remaining credits;
the margin allows for differences between that counter and the application ledger.

## Retries and refunds retain their identity

The batch reservation covers initial attempts. Each retry obtains a separate
reservation on the selected account before another HTTP attempt is made.
Retries do not consume a second slot from the initial batch.

The poller counts issued initial attempts and releases unissued slots in a
`finally` block. The refund carries the original reservation's account, product
and month. A batch crossing UTC midnight on the last day of a month therefore
refunds its original ledger bucket, not the new month's counter.

These rules are implemented in `retryReservedVectorTile`,
`rollbackReservedQuota` and the account manager's `release` method. They matter
when a concurrent fetch fails after only some requests have been issued.

The reservation commits before outbound HTTP work. A crash between the two can
leave unused allowance recorded as spent. There is no exactly-once transaction
spanning PostgreSQL and the provider. Each successful reservation spends
allowance, so repeating the call is not idempotent.

## Application months and provider availability

An application counter opening a new UTC month does not establish that the
provider restored its allowance. Account availability is tracked separately:
authorization failures and exhausted credits can quarantine an account while
another continues collecting.

Availability quarantine is process-local and is re-evaluated after restart;
the durable request count is not reset. Recovery probes are budgeted requests.
A successful probe is allowance-reset evidence only in the context of a prior
credit-exhaustion result.

The [two-account runbook](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/tomtom-two-account-operations.md)
documents activation settings, provider headroom and reset evidence. TomTom flow and
CDOT incidents retain independent collection schedules.

## Evidence to inspect

- [`TrafficRequestBudgetPostgresTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/test/java/com/example/ingest_service/TrafficRequestBudgetPostgresTest.java)
  races 12 independent connections reserving ten calls against a test limit of
  70. It expects seven grants and five rejections, then checks that refunds do
  not change another account, product, provider or month.
- [`TomTomAccountQuotaManagerTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/test/java/com/example/ingest_service/TomTomAccountQuotaManagerTest.java)
  covers full-batch rollover, rejection of an unfundable batch, quarantine,
  selection records and refunds to the original account.
- [`TomTomRequestGovernor`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TomTomRequestGovernor.java)
  shows per-attempt reservations for other TomTom request paths.

The connection race is a correctness fixture with a small artificial budget;
it is not a throughput measurement or a claim about VPS session capacity.

[← Architecture](Architecture) · [Historical storage →](Historical-Storage)
