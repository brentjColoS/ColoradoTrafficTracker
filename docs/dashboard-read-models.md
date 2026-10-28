# Dashboard read models

Dashboard snapshots include `/traffic/database/observations`: authoritative
I-25/I-70 scalar observation totals across live and archived rows, their sum,
and the earliest observation date. A single statement sees both tiers at one
database snapshot, so retention does not make the counter jump. Reads have a
one-second database timeout and a shared sixty-second snapshot cache, including
failure results. No additional provider reads or write model are introduced.
These totals are not per-graph samples, zone rows or incident events.

The incident coverage boundary uses Hibernate's native PostgreSQL `Instant`
result, converting to UTC offsets only for repository query parameters. The
disposable `IncidentBoundaryDatabaseTest` exercises the real JPA repository,
including a corridor with no durable observations. Like the counter fixture it
requires an explicitly disposable `CTT_COUNTER_DISPOSABLE_DB_URL`; never set
that variable to a production database. The test creates a session-local table.

Incident projections expose the already-stored reported start/end mile markers.
CDOT descriptions retain their original case; the client presents compact facts
and keeps the full source report available on demand. No parser or stored record
is rewritten.

The variable-sign response retains the conservative one-hour `AVAILABLE`
boundary. With the existing six-hour per-device collector, older successful
reports are normally `STALE`. A snapshot containing only those reports has
`status: LAST_REPORTED`, with a separate `lastReportedSignCount`; neither
`availableSignCount` nor `belowRegularSignCount` treats them as current. All
source/read timestamps and failure states remain present. Clients must label
old values as unconfirmed last reports, not live restrictions. This is an
additive response field/status; existing per-sign status semantics remain intact.

No migration, collector, scheduler, credentials or precision changes are part of
these read models. The reviewed dashboard presentation consumes them separately.
