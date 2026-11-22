# TomTom two-account operations

The ingest service can use two independent TomTom accounts without treating
their allowances as one unsafe counter. The existing `TOMTOM_API_KEY` is the
`primary` account. The optional second account is `secondary`.

The secondary account is disabled by default. Do not enable it merely because
the credential is valid. Enable it only after the TomTom dashboard shows that
its monthly traffic-vector allowance is available again.

## Capacity model

The monthly settings are per account:

```dotenv
TRAFFIC_MONTHLY_REQUEST_TARGET=190000
TRAFFIC_MONTHLY_REQUEST_HARD_STOP=195000
TRAFFIC_MONTHLY_REQUEST_ALLOWANCE=200000
```

With one enabled account, those values produce a 190,000 target, a 195,000
application hard stop, and the provider's 200,000 allowance. With two enabled
and healthy accounts, the effective totals are 380,000, 390,000, and 400,000.
The 10,000-request difference between the application hard stops and provider
allowances is kept for dashboard discrepancies, manual checks, and other
untracked activity.

### Provider-counter reconciliation

The provider dashboard is authoritative for actual allowance. Reconcile direct
diagnostic activity outside the application ledger from the last confirmed reset.
[Dated comparison records](traffic-flow-profile-evaluation.md) document earlier
manual usage; those adjustments are not permanent monthly deductions.

Each account has its own durable row for every TomTom product and calendar
month. Existing pre-upgrade rows migrate to `primary`, so an upgrade does not
erase the current account's application-side usage.

The committed production profile is zoom 10 every 60 seconds with CDOT
incidents every 15 minutes. At the current eight-tile footprint, its 31-day
projection is about 357,120 TomTom vector requests. Primary reaches the 195,000
application hard stop after roughly 16.9 days of continuous polling, then
secondary serves the remaining projected 162,120 requests. That leaves about
42,880 requests below the combined provider allowance for retries, startup
checks, manual checks, and provider-counter drift.

The I-70 MM 259–274 extension adds tile `10/213/388` to I-70's corridor set,
but that tile is already part of the I-25 pass. Cross-corridor tile
deduplication therefore keeps the combined production footprint at eight
requests per complete flow batch and does not change the monthly projection.

## Source precision

The default profile preserves provider precision. Opt-in `I70_EXCLUSIVE_1KPH`
affects only exclusive I-70 tiles and keeps the same eight-request batch.
[Flow source profiles](traffic-flow-profile-evaluation.md) owns eligibility,
V28 provenance, saved-capture evidence and configuration rollback.

## How requests are assigned

- A tile polling batch is reserved against one account before fan-out begins.
- Every tile in that batch uses the same credential.
- Accounts are considered in fixed order: `primary`, then `secondary`.
- Primary continues serving requests until its 195,000 application hard stop
  is reached or the account is quarantined by a provider failure.
- If primary cannot fund the entire planned tile batch, its small remainder is
  left unused and secondary is tried before any request is issued. The unused
  application budget is therefore always smaller than one batch: at most seven
  calls with the current eight-tile plan.
- Secondary serves that complete batch after rollover. If no account can fund
  a complete batch, flow polling pauses instead of lowering the source zoom.
- A new application budget month starts with primary again. Provider reset
  probes still determine whether an upstream exhausted account is truly ready.
- Retries and non-tile TomTom products reserve against an account for every
  actual HTTP attempt.
- When a tile batch fails partway through, unissued initial requests return to
  that batch's account. A separately reserved retry does not consume another
  slot from the initial batch.
- A duplicate secondary credential is ignored and does not increase capacity.
- Credentials are never placed in health details, metrics, logs, or database
  quota identities.

## Staged activation

For the combined production profile, configure both independent accounts:

```dotenv
TOMTOM_SECONDARY_API_KEY=replace-with-the-second-account-key
TOMTOM_SECONDARY_ENABLED=true
TRAFFIC_FLOW_POLL_SECONDS=60
TRAFFIC_FLOW_TILE_ZOOM=10
```

After both TomTom dashboards show available vector allowance:

1. Set `TOMTOM_SECONDARY_ENABLED=true`.
2. Restart `ingest-service`.
3. Confirm startup validation passes for both `primary` and `secondary`.
4. Inspect the `quotaPressure` health details and confirm both accounts report
   `AVAILABLE`.
5. Confirm `accountSelection=primary-first-rollover` and
   `activeAccount=primary`.
6. Leave the 60-second cadence in place. The secondary vector counter should
   remain still until rollover; it is not expected to balance with primary.

Do not shorten the cadence without recalculating the actual tile footprint.
The 60-second profile intentionally uses most of the combined allowance while
retaining enough headroom for routine operational traffic.

## Failure behavior

Startup checks every enabled account separately. A rejected secondary account
is quarantined while a healthy primary continues polling. Polling halts only
when no enabled account remains usable.

An authorization failure quarantines that account until the configuration is
fixed and the service is restarted. A provider credit-exhaustion response
quarantines that account until a successful recovery probe confirms that
traffic credits are available again. The service does not assume that a UTC
calendar month boundary restores the allowance.

The availability circuit is intentionally process-local. Durable request
counters survive restarts, but an upstream account quarantine is re-evaluated
after restart. The application hard stop still prevents a restart from
resetting its request ledger.

## Application account-transition evidence

Complete flow-batch reservations maintain a durable, credential-free audit
trail. `INITIAL_SELECTION` identifies the first account selected after this
feature is deployed, `ACCOUNT_HANDOFF` identifies a change between accounts in
one budget period, and `MONTH_BOUNDARY` identifies the first reservation in a
new application calendar month. Repeated batches on the same account update a
single state row and do not create repeated history events.

The records contain only the `primary` or `secondary` label, product, calendar
period, reserved call count, and application-side usage totals. Read them from
the server-local ingest endpoint:

```shell
curl -s 'http://127.0.0.1:8082/internal/tomtom/account-transitions?limit=90'
```

Or query the database directly:

```sql
select observed_at, event_type, period_start, period_end,
       from_account_id, to_account_id, calls_reserved,
       from_account_requests_used, to_account_requests_used
from tomtom_account_transition
order by observed_at desc, id desc;
```

A `MONTH_BOUNDARY` row proves that the application opened its new UTC calendar
counter and reserved a batch. It does not prove that TomTom reset its provider
allowance. Only a recovery from an actual provider credit-exhaustion response
can supply that evidence.

## Credit-exhaustion recovery evidence

The scheduled probe is a recovery mechanism, not a general detector for the
provider's allowance boundary. An enabled account is eligible only after
TomTom has returned a credit-exhaustion response. The 195,000 application hard
stop normally prevents that response by leaving 5,000 requests of provider
headroom, so an enabled account at the application limit is not probed.

A successful request made from that remaining headroom would prove only that
the account can still serve traffic. It would not prove that an allowance reset
occurred.

A credential can remain in `TOMTOM_SECONDARY_API_KEY` while
`TOMTOM_SECONDARY_ENABLED=false`. It is then unavailable to regular polling but
eligible for a minimal recovery check. At 04:17 UTC each day, the ingest
service records that the recovery scheduler ran. It requests one fixed traffic
vector tile only for each account eligible for recovery. There are no retries.
Database leases keyed by UTC date and account prevent multiple ingest instances
from duplicating the run or check.

```dotenv
TOMTOM_RESET_PROBE_ENABLED=true
TOMTOM_RESET_PROBE_CRON=0 17 4 * * *
```

Provider results contain only the account label, UTC timestamp, outcome, HTTP
status, and TomTom error code. Scheduler-run records contain only the run time
and eligible and attempted account counts. Credentials and response bodies are
not stored. Once a dormant account returns `AVAILABLE`, network checks stop
until that account is enabled and later runs out of credits. Daily scheduler
runs continue to be recorded without calling TomTom.

Read the evidence through the ingest service:

```shell
curl -s 'http://127.0.0.1:8082/internal/tomtom/reset-probes?limit=90'
curl -s 'http://127.0.0.1:8082/internal/tomtom/reset-probes/runs?limit=90'
```

Or query the database directly:

```sql
select account_id, probed_at, outcome, http_status, provider_code
from tomtom_account_reset_probe
order by probed_at desc, id desc;

select ran_at, eligible_account_count, attempted_account_count
from tomtom_reset_probe_run
order by ran_at desc, id desc;
```

The recovery probe has one-day resolution only after the provider has reported
exhaustion. A later change from `CREDITS_EXHAUSTED` to `AVAILABLE` immediately
after a first-of-month boundary is evidence for a calendar reset. A change on
another date is evidence for a rolling or account-specific window. Successful
traffic or probe calls without a preceding provider-exhaustion result are not
reset evidence. Keep several qualifying transitions before treating either
pattern as established.

## Monitoring

`/actuator/health` includes a `quotaPressure` component with:

- combined usage, target, hard stop, and allowance;
- the `primary-first-rollover` selection mode and currently active account;
- one entry for each configured account;
- account state, requests used, remaining headroom, and reset estimate;
- a retry date when an account is quarantined for exhausted credits.

One unavailable account reports degraded health while another remains usable.
Quota health becomes out of service only when every enabled account is
unavailable or has reached its application hard stop. Critical usage remains a
degraded warning while capacity is still available.

The same endpoint includes `tomtomResetProbe`. It identifies the component as
credit-exhaustion recovery, reports whether the daily scheduler has been
observed, shows eligible and attempted counts from its latest run, and explains
why each configured account is or is not eligible. The existing
`awaitingReset` fields remain available for compatibility.

Routine flow completions remain at `INFO` with sample counts, averages, and
minimums. Full speed arrays and periodic per-corridor repetition details are
`DEBUG` diagnostics. The provider guard emits one `WARN` when usable data first
crosses the configured stale-payload threshold, keeps the degraded health state
visible, and logs continued repetition at `DEBUG`. Connection, authorization,
quota, and unusable-payload failures remain warnings or errors.

## Deployment and retained history

The [coverage reference](data-history-coverage.md) owns live/archive identity,
zone durability and incident-history boundaries. Retention moves older samples
without removing them from queryable history. It runs on its dedicated scheduler
in oldest-first transactions: defaults are twenty batches of 500 samples per run.
`TRAFFIC_RETENTION_BATCH_SIZE` bounds a transaction;
`TRAFFIC_RETENTION_MAX_BATCHES_PER_RUN` bounds a scheduled run. A cap warning
means another run may be needed, not permission to delete history.

Follow the [deployment procedure](cloud-vps-deployment.md) for exact revisions,
preserved images/configuration, checksummed backups and disposable restores.
Before and after storage-affecting changes, compare live, archived and combined
counts plus relevant frozen identity/content evidence. Keep the pre-release dump
through the recovery window. Applied migrations and retained observations survive
an application rollback.

To return to one account, disable `TOMTOM_SECONDARY_ENABLED`, choose a cadence
that fits one allowance, and recreate only ingestion with its reviewed image.
The sixty-second zoom-10 profile is budgeted for two enabled allowances.
