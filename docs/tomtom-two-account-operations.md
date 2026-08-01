# TomTom two-account operations

The ingest service can use two independent TomTom accounts without treating
their allowances as one unsafe counter. The existing `TOMTOM_API_KEY` is the
`primary` account. The optional older account is `secondary`.

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

## How requests are assigned

- A tile polling batch is reserved against one account before fan-out begins.
- Every tile in that batch uses the same credential.
- Accounts are considered in fixed order: `primary`, then `secondary`.
- Primary continues serving requests until its 195,000 application hard stop
  is reached or the account is quarantined by a provider failure.
- Secondary begins serving the next complete batch after that rollover.
- A new application budget month starts with primary again. Provider reset
  probes still determine whether an upstream exhausted account is truly ready.
- Retries and non-tile TomTom products reserve against an account for every
  actual HTTP attempt.
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
quarantines that account until a successful reset probe confirms that traffic
credits are available again. The service does not assume that a UTC calendar
month boundary restores the allowance.

The availability circuit is intentionally process-local. Durable request
counters survive restarts, but an upstream account quarantine is re-evaluated
after restart. The application hard stop still prevents a restart from
resetting its request ledger.

## Reset evidence

A credential can remain in `TOMTOM_SECONDARY_API_KEY` while
`TOMTOM_SECONDARY_ENABLED=false`. It is then unavailable to regular polling but
eligible for a minimal reset check. At 04:17 UTC each day, the ingest service
requests one fixed traffic vector tile for each account waiting for a reset.
There are no retries. A database lease keyed by account and UTC date prevents
multiple ingest instances from duplicating the check.

```dotenv
TOMTOM_RESET_PROBE_ENABLED=true
TOMTOM_RESET_PROBE_CRON=0 17 4 * * *
```

The result contains only the account label, UTC timestamp, outcome, HTTP
status, and TomTom error code. Credentials and response bodies are not stored.
Once a dormant account returns `AVAILABLE`, daily checks stop until that
account is enabled and later runs out of credits.

Read the evidence through the ingest service:

```shell
curl -s 'http://127.0.0.1:8082/internal/tomtom/reset-probes?limit=90'
```

Or query the database directly:

```sql
select account_id, probed_at, outcome, http_status, provider_code
from tomtom_account_reset_probe
order by probed_at desc, id desc;
```

The probe has one-day resolution. A change from `CREDITS_EXHAUSTED` to
`AVAILABLE` immediately after a first-of-month boundary is evidence for a
calendar reset. A change on another date is evidence for a rolling or
account-specific window. Keep several transitions before treating either
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
unavailable or critical.

The same endpoint includes `tomtomResetProbe`. It shows whether any account is
waiting for a reset and the most recent result for each configured account.

## History continuity during deployment

The 30-day cleanup moves rows into `traffic_sample_archive` and
`traffic_incident_archive`; it does not discard them. The
`traffic_sample_all` and `traffic_incident_all` views include both live and
archived rows, so the existing history and analytics APIs continue to see the
older traffic patterns after rollover and provider refactoring.

Before deploying a migration to the live server:

1. Create a timestamped `pg_dump` outside the Docker volume and verify it with
   `gzip -t`.
2. Record live, archived, and archive-inclusive row counts.
3. Deploy with `docker compose up -d --build --remove-orphans`; never use
   `docker compose down -v`.
4. Recheck the same counts after Flyway completes. The archive-inclusive count
   must not decrease.
5. Keep the pre-deployment dump through the entire one-month soak window.

To roll back to one account, set `TOMTOM_SECONDARY_ENABLED=false`, restore a
single-account-safe cadence, and restart the ingest service. Do not leave the
60-second z10 profile running against only one allowance.
