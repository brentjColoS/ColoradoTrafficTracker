# Incident event operations

The incident transition tables preserve provider events independently from the
one-minute traffic samples. Existing normalized incident rows and embedded sample
payloads remain available as historical data after the durable cutover.

## Parity check

`GET /api/traffic/incidents/parity` compared each corridor's latest embedded
incident snapshot with the active durable event and corridor rows. The endpoint
uses the normal API-key protection when API security is enabled.

This is a rollout diagnostic, not an ongoing health check. New traffic samples
no longer contain incident payloads, so `comparisonReady=false` is expected after
the first post-cutover sample reaches each corridor.

The top-level `comparisonReady` value is false until at least one corridor has
data to compare. `inParity` becomes true only when every corridor has a readable
compatibility snapshot with the same provider identities and payloads as the
durable model.

Each corridor reports:

- the traffic-sample and incident-snapshot timestamps;
- compatibility, durable, and matching identity counts;
- provider identities found on only one side;
- identities whose latest JSON payload differs; and
- compatibility rows that do not have a stable provider identity.

An incident poll can finish just before the next flow sample copies that snapshot.
This can produce a short mismatch lasting no more than the normal flow cadence.
A mismatch that remains after two successful flow cycles should be investigated.

The production gate covered repeated refreshes, event appearances, payload
changes, disappearances, and reactivations before the compatibility write path
was stopped. The compatibility tables and views remain in place, so previously
collected data does not require restoration to be queried.

## Refresh timing

`TRAFFIC_INCIDENT_POLL_SECONDS` controls the provider cadence and remains 900
seconds by default. The scheduler checks the persisted lease every
`TRAFFIC_INCIDENT_LEASE_CHECK_SECONDS`, which defaults to 60 seconds. Lease checks
do not call CDOT; they let a restarted instance resume close to the stored due
time without starting an extra provider request.

## Current incident reads

`GET /api/traffic/map/incidents` and its dashboard alias read active event and
corridor state from the durable tables. The response keeps the existing display
fields and adds `firstSeenAt`, `lastSeenAt`, and `active` so the UI can describe
freshness without relying on a duplicated sample row.

`windowMinutes` is a freshness boundary against the event's last observation,
not an instruction to include resolved events. Results are limited to active
matches with mile markers inside the configured tracked corridor range. Existing
rows in `traffic_incident`, `traffic_incident_history`, and
`traffic_incident_all` remain available for historical and compatibility reads.

Dashboard summaries and stagnation windows count durable event identities whose
lifetime overlaps the requested interval. Hotspots group those event identities
and count their recorded payload states instead of treating every speed sample
as a new incident observation. Delay changes participate in the durable payload
hash and therefore create a new event state.

Corridor analytics expose `incidentEventCount` for those durable identities and
`incidentObservationCount` for the sum of active-incident readings stored with
flow samples. The older `totalIncidentCount` field remains as a deprecated alias
for `incidentObservationCount` so existing clients continue to work.

New traffic samples keep the current incident count and incident-source timing,
but leave `incidents_json` empty and do not add rows to `traffic_incident`.
Historical samples, normalized rows, and archives are not deleted or rewritten.
