# Incident event operations

The incident transition tables preserve provider events independently from the
one-minute traffic samples. Existing normalized incident rows and embedded sample
payloads remain available while the durable reads are compared with them.

## Parity check

`GET /api/traffic/incidents/parity` compares each corridor's latest embedded
incident snapshot with the active durable event and corridor rows. The endpoint
uses the normal API-key protection when API security is enabled.

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

Before changing a current-event API to the durable reader, verify clean parity
through repeated incident refreshes, including at least one event appearance,
payload change, and disappearance when those naturally occur. Keep the
compatibility tables and views in place during the first cutover so the read path
can be reverted without restoring data.

## Current map incidents

`GET /api/traffic/map/incidents` and its dashboard alias read active event and
corridor state from the durable tables. The response keeps the existing display
fields and adds `firstSeenAt`, `lastSeenAt`, and `active` so the UI can describe
freshness without relying on a duplicated sample row.

`windowMinutes` is a freshness boundary against the event's last observation,
not an instruction to include resolved events. Results are limited to active
matches with mile markers inside the configured tracked corridor range. Existing
rows in `traffic_incident`, `traffic_incident_history`, and
`traffic_incident_all` remain available for historical and compatibility reads.
