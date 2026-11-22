# Traffic flow source profiles

The selected profile is zoom 10 every sixty seconds. With the current deduplicated
eight-tile footprint, that projects to 357,120 vector requests in a 31-day month.
Primary-first rollover uses separate account allowances; the
[account runbook](tomtom-two-account-operations.md) owns configured limits,
reservations, retries and recovery.

Source zoom, cadence, decoding precision and matching are different properties.
More precise provider steps do not establish independently measured traffic
accuracy. Collection profiles retain that provenance instead of rewriting history.

## Opt-in I-70 source precision

`TRAFFIC_FLOW_PRECISION=DEFAULT` preserves the existing provider requests.
The opt-in `I70_EXCLUSIVE_1KPH` mode adds `trafficLevelStep=1` only to zoom-10
tiles exclusively used by I-70. With the current geometry, four I-70 tiles use
the finer source and shared tile `10/213/388` stays at provider default. I-25's
four inputs remain unchanged; the full flow batch is still eight requests.

Both corridor geometries and both zoom-10 coverage plans must be available.
Otherwise all requests remain at default precision. Existing quota planning,
account rollover, per-attempt retry accounting, cadence, route sampling and
both corridor matchers remain unchanged. A rejected finer request fails the
batch; it does not silently retry at another precision or save partial samples.

Migration V28 adds nullable internal collection-profile metadata without
rewriting history or changing website copy or public response contracts.
Profiles identify the matcher and each requested tile's precision. Legacy
profiles remain unknown (`NULL`). Retention copies profiles into the archive;
speed-zone observations retain their existing sample-reference linkage.
`traffic_sample_collection_profiles` provides an archive-inclusive audit view.
Current map metadata records the profile; hourly map aggregates become `mixed`
when different or unknown profiles meet, and stay mixed after rollback.

Deploying this code does not enable finer requests. Activation is a separate
production ingestion decision, not an experimental API-reader deployment.
Apply V28 before using the new writer. Roll back by setting the mode to
`DEFAULT`, not by deleting columns, rolling back migrations or rewriting data.
Older sample writers can omit the nullable profile column, but binary rollback
is not a substitute for the tested configuration rollback: an older map writer
cannot maintain the new profile metadata.

Finer precision is not independent speed accuracy. Legacy baselines remain
legacy comparisons, not converted measurements. Profile records permit
later audit of that boundary. I-25 remains at default precision because its current
blend is segmentation-sensitive and can dilute zero-speed observations.

Local validation can replay saved captures with `CTT_PRECISION_CAPTURES` pointing
to the directory containing the I-25 and I-70 capture folders. The opt-in
PostgreSQL test accepts only a loopback `CTT_PRECISION_DB_URL` and creates a
unique test schema; use a disposable database. Neither test contacts TomTom.

## Recorded compatibility check

[PR #244](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/244) records
the opt-in producer implementation. The
[October 26 replay record](evidence/i70-source-precision-replay-2026-10-26.json)
retains source revision, test results and default/candidate/rollback comparisons.
The check used saved captures and a fake provider, with no new TomTom calls.
I-25 inputs/results remained unchanged; the I-70 result changed where exclusive
tiles used finer source steps. Rollback reproduced original arrays and map cells.
The captures were not simultaneous ground truth or an accuracy benchmark.

## July 28, 2026 zoom comparison

Run date: July 28, 2026

| Profile | Requests per cycle | 31-day projection | I-25 samples/zones | I-70 samples/zones |
|---|---:|---:|---:|---:|
| z10 every 125s | 8 | 171,418 | 123 / 3 | 105 / 6 |
| z9 every 60s | 4 | 178,560 | 123 / 3 | 105 / 6 |

Both profiles returned usable data for both corridors. The first pair also produced similar p10, p50, and p90 speeds, although the I-25 p10 differed slightly between resolutions.

This is only a baseline. It shows that lower zoom did not reduce the application-level sample or speed-zone count in that cycle, but it does not establish valid-cycle rate, percentile stability, localized-slowdown quality, or behavior during an incident. Repeat the comparison across different traffic conditions before changing the default.

Manual provider usage for this first session was 13 vector requests: one authorization probe plus the 12-request paired comparison.

## September 22, 2026 manual usage

A bounded zoom comparison made 52 direct primary-account vector requests outside
the application ledger. That dated adjustment applied until the next confirmed
provider allowance reset; it is not a permanent deduction from every later month.
Reconcile current out-of-ledger activity against provider counters and confirmed
reset evidence rather than carrying old adjustments forward automatically.

## Bounded live comparison

`TrafficFlowProfileLiveTest` is separate from routine verification and skipped
unless `TOMTOM_LIVE_PROFILE_TEST=true`. The default request ceiling is twenty.
It makes one flow-only cycle per compared profile using configured corridor
geometry. Load credentials through private environment configuration before use.

```bash
TOMTOM_LIVE_PROFILE_TEST=true \
TOMTOM_LIVE_PROFILE_MAX_REQUESTS=20 \
./mvnw -q -pl ingest-service -am \
  -Djacoco.skip=true -Dtest=TrafficFlowProfileLiveTest \
  -Dsurefire.failIfNoSpecifiedTests=false test
```

Check provider usage before and after a deliberate comparison and account for
manual probes. Never enable this flag in CI or routine `verify` commands. Prefer
saved-capture replay when checking decoder, policy or persistence compatibility.
