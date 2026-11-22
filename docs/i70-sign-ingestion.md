# I-70 variable speed signs

The feature reads 42 reviewed CDOT devices on I-70 MM 206–274. Scheduled ingestion
stores source and read timestamps; browser requests read that stored state.
Sign readings supplement traffic observations without changing corridor speed
calculations, baselines or zone boundaries.

## Collection and request bounds

One shared lease selects a due, least-recently-attempted ID using `id` and
`limit=2`. Each sign is attempted once per six hours by default, staggered across
the interval: approximately one request every nine minutes. There are no broad
discovery reads, automatic retries or per-visitor CDOT calls.

Successful and failed attempts persist their attempt times. The thirty-second
scheduler check contacts CDOT only when shared spacing and per-sign refresh are
both due, so restarts and failures cannot trigger early retries. The first sweep
takes about six hours plus request/scheduler latency, without a startup burst.

A dedicated single-thread scheduler prevents slow signs from blocking flow or
incident collection. Each sign read uses a fresh connection with transport retries
disabled, a twenty-second overall/HTTP deadline and a 16 KiB response limit.
Failures remain unconfirmed until the next normally scheduled successful read.
Safe failure categories retain causes without logging credential-bearing URLs.

| Setting | Meaning |
| --- | --- |
| `CDOT_VSL_ENABLED` | Defaults false; enables the reviewed catalog's collector. |
| `CDOT_VSL_REFRESH_SECONDS` | Defaults 21,600 seconds per device; hard minimum 3,600. |
| `CDOT_VSL_HISTORY_ENABLED` | Defaults false; appends retained observations from existing reads. |

`CDOT_VSL_POLL_SECONDS` is obsolete. Provider credentials belong only to ingestion.

## Current and last-reported state

`GET /dashboard-api/traffic/map/variable-speed-limits/current?corridor=I70`
and the protected `/api` alias expose direction, source update, last successful
read, communication state and explicit unknown/failed/stale/unavailable values.
V27 maintains one bounded current-state row per sign.

Current validity lasts one hour. With six-hour collection, readings are normally
stale for part of the cycle; a longer collection interval does not extend validity.
Source state-update time and successful read time remain different facts.

Only available numeric readings different from their configured regular reference
create current map badges. Older successful values appear in Last-reported limits
with read timestamps and an unconfirmed label. Blank, failed and communication-error
values do not establish restrictions. Historical charts hide current sign context.

Eastbound badges use `E→`, westbound `←W`, with stems to device locations. Nearby
chips form collision-checked areas; panning/zooming/resizing uses loaded data.
Popups preserve directional values and source/read times. Gaps between devices
are not verified continuous restriction boundaries. Configured reference labels
remain independent of sign availability.

### Regular reference exception

The configured reference is not a CDOT per-sign clear-weather maximum. Westbound
devices `OpenTMS-Sign465279` at MM237 and `OpenTMS-Sign465294` at MM237.05 use
65mph instead of the combined-direction 60mph segment reference.
[CDOT OTIS inventory](https://dtdapps.codot.gov/otis/API/TRANSYS/SpeedLimit/070A/236.9/237.1.json)
was checked October 19, 2026: MM236.918–237.087 lists primary 60 and secondary
65mph, with secondary corresponding to westbound/southbound. The exception is
scoped to identity, direction and location. It does not infer a regular maximum
from repeated readings; a future 60mph reading there still represents a difference.

## Retained sign history

V29 adds `traffic_variable_speed_sign_history`. Opt-in capture retains normalized
payloads and original read timestamps from the existing schedule, including normal,
failed and unavailable results. It does not backfill current state or make requests.
History begins at the first retained observation, not migration/deployment time.

Current state commits before an independent append transaction. A history failure
leaves an explicit gap and an actionable log without rolling back current state
or retrying the provider. Transactions have a three-second deadline, two-second
statement limit and one-second lock limit. Identical retries cannot duplicate a
record; conflicts cannot overwrite it. Late reads cannot rewind current state.

At the default cadence, growth is about 168 rows/day or 61,320/year. Payloads are
limited to 4,096 characters; indexes/table overhead are additional. There is no
automatic deletion. Monitor actual row count and `pg_total_relation_size`; full
database backups include the table.

`GET /dashboard-api/traffic/map/variable-speed-limits/history` accepts `windowHours`
from 1 to 720 and optional `asOf`. It includes one hour of left-edge context,
uses a five-second deadline and caps responses at 6,000 rows. Oversized windows
return 422; unavailable storage returns 503 independently of current sign reads.

I-70 Speed Zones draws dashed history only at the location/direction of a confirmed
reduced reading. Validity ends at the next contradictory reading or one hour after
success, whichever comes first. Gaps remain unconfirmed; six-hour sampling cannot
establish an exact change time or a restriction across an entire speed zone.

## Activation, verification and rollback

Use a checksum-verified backup and disposable restore before additive database
changes. Preserve reviewed images and private configuration under the
[deployment procedure](cloud-vps-deployment.md). API and ingestion must carry
matching applied migration resources; never edit or reverse an applied migration.

Verify current updates with history capture disabled first. Enable capture only
in the private ingest environment, then inspect the next normally scheduled read.
Check both corridor flows, CDOT/provider freshness, quota state, source/read times
and retained history continuity. Do not accelerate the sweep or add provider probes.
Reader roles need SELECT on the new table and no write privileges.

Stop history capture with `CDOT_VSL_HISTORY_ENABLED=false`; stop sign collection
with `CDOT_VSL_ENABLED=false`, recreating only the affected ingest service with
its reviewed image. Preserve V27/V29 state and history during rollback. A missed
append cannot be reconstructed from a later current snapshot.

The saved-sign demo exporter validates the catalog, strips private fields,
disables replay and refuses overwrites. Normal hosting does not load it.
[Optional readers](dashboard-sidecar-operations.md) retain read-only roles,
disabled Flyway and no provider credentials.
