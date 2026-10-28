# Dashboard window summaries

`GET /dashboard-api/traffic/dashboard/window-summary` accepts `corridors`,
`hours` (2, 6, 24, 168 or 720), and an `asOf` timestamp. The authenticated
`/api` equivalent uses the same contract. `progressive=true` streams NDJSON
frames so speed and travel fields can arrive before incident calculations.

Reads use retained, archive-inclusive observations. They do not contact providers
or alter stored traffic. Cold statistics are serialized; reconstructed incident
reads share a ten-second deadline, bounded weekly caches and query timeouts.
Unavailable fields remain unavailable rather than becoming zero or borrowing
the live summary. Results are cached by corridor, resolution and minute.

Travel time uses complete speed-zone buckets when available. Older windows can
estimate travel time from retained corridor-average speeds and the recorded
corridor extent. These estimates do not represent an individual vehicle's trip.

Incident coverage is checked separately for each corridor. A window starting at
or after that corridor's first durable observation counts durable events. An
earlier window reconstructs episodes from retained observations. Mixed windows
use legacy episodes strictly before the corridor's durable boundary and durable
events from the boundary onward. A legacy episode with the same provider
identity continuing within three minutes of an event at the seam is counted
only on the durable side; earlier, separate episodes remain counted. Later
compatibility copies are not added again. Legacy rows without provider IDs keep
their existing approximate location/category identities and cannot be proven to
match a durable identity. Mixed and reconstructed totals are therefore marked
`RECONSTRUCTED_EPISODES`: estimates, not exact unique provider events. If either
source fails, an incomplete count is not substituted.

No migrations, scheduler changes or provider requests are required for this
endpoint. Existing dashboard clients remain compatible; the progressive client
can be delivered independently after this additive backend.
