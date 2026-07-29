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

## How requests are assigned

- A tile polling batch is reserved against one account before fan-out begins.
- Every tile in that batch uses the same credential.
- The account with the most remaining application quota is chosen first.
- Retries and non-tile TomTom products reserve against an account for every
  actual HTTP attempt.
- A duplicate secondary credential is ignored and does not increase capacity.
- Credentials are never placed in health details, metrics, logs, or database
  quota identities.

## Staged activation

Keep the current deployment on the fresh primary account:

```dotenv
TOMTOM_SECONDARY_API_KEY=
TOMTOM_SECONDARY_ENABLED=false
TRAFFIC_FLOW_POLL_SECONDS=125
TRAFFIC_FLOW_TILE_ZOOM=10
```

The older credential can be added to the secret environment while remaining
disabled:

```dotenv
TOMTOM_SECONDARY_API_KEY=replace-with-the-older-key
TOMTOM_SECONDARY_ENABLED=false
```

After its TomTom dashboard shows the allowance has reset:

1. Set `TOMTOM_SECONDARY_ENABLED=true`.
2. Restart `ingest-service`.
3. Confirm startup validation passes for both `primary` and `secondary`.
4. Inspect the `quotaPressure` health details and confirm both accounts report
   `AVAILABLE`.
5. Leave the 125-second cadence in place long enough to confirm both counters
   advance and polling remains stable.
6. Move to 70 seconds first. A 65-second cadence can follow after observed
   usage and retry volume leave adequate headroom.

Do not switch directly to a faster profile merely because the combined
allowance is theoretical. The selector only includes enabled, non-quarantined
accounts in runtime capacity planning.

## Failure behavior

Startup checks every enabled account separately. A rejected secondary account
is quarantined while a healthy primary continues polling. Polling halts only
when no enabled account remains usable.

An authorization failure quarantines that account until the configuration is
fixed and the service is restarted. A provider credit-exhaustion response
quarantines that account until the next UTC calendar month boundary. TomTom's
dashboard remains authoritative; if its reset differs from the application's
calendar estimate, keep the secondary account disabled or restart after the
dashboard confirms availability.

The availability circuit is intentionally process-local. Durable request
counters survive restarts, but an upstream account quarantine is re-evaluated
after restart. The application hard stop still prevents a restart from
resetting its request ledger.

## Monitoring

`/actuator/health` includes a `quotaPressure` component with:

- combined usage, target, hard stop, and allowance;
- one entry for each configured account;
- account state, requests used, remaining headroom, and reset estimate;
- a retry date when an account is quarantined for exhausted credits.

One unavailable account reports degraded health while another remains usable.
Quota health becomes out of service only when every enabled account is
unavailable or critical.

To roll back, set `TOMTOM_SECONDARY_ENABLED=false`, restart the ingest service,
and retain the conservative single-account cadence.
