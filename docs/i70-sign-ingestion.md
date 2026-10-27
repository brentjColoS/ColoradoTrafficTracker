# Scoped I-70 variable speed sign backend

This main prerequisite supplies live sign state to the separate experimental
map preview in PR #232. Its source is the checked feature revision `244c914`;
it does not promote the experimental dashboard or alter traffic calculations.
The production deployment and live collection were requested on October 14,
2026. Issue #233 tracks the prerequisite and verification.

The catalog contains 42 reviewed CDOT VSL IDs on I-70 MM 206–274. One shared
scheduler lease reads one least-recently-attempted ID, at least 30 seconds apart,
using `id` and `limit=2`. There are no broad discovery reads, inline retries,
or per-visitor CDOT requests. A timeout, connection failure, HTTP 408 or 5xx gets
one recovery read in the next normal scheduled slot; a second failure resumes
the sweep. Authorization, rate-limit and invalid-payload failures do not get
priority retries. The shared lease still permits only one request per interval,
and a failed value remains explicitly unconfirmed until a successful read.
The pending recovery slot is process-local; a restart resumes the durable sweep.
Sign reads use a dedicated single-thread scheduler, so a slow response cannot
block flow polling or incident work. Safe failure categories retain the cause
without logging credential-bearing URLs. Sign responses have a dedicated
twenty-second HTTP/overall deadline and a 16 KiB limit. The first sweep takes
approximately 21 minutes plus request latency.
The sign-only deadline accommodates delayed upstream responses without extending
TomTom or incident deadlines. A sign that exceeds it is still failed and
unconfirmed; its single recovery read must wait for the next normal slot.

`CDOT_VSL_ENABLED=false` remains the default; deliberately enable it on ingestion
with `CDOT_VSL_ENABLED=true` after deployment. `CDOT_VSL_POLL_SECONDS=30` has a
hard floor of 30 seconds. Existing provider keys remain only on ingestion.

V27 creates one bounded current-state row per sign and preserves existing
traffic, incident, quota, and archived datasets. The API now carries exact copies
of already-applied V25/V26 from ingestion so Flyway can validate all migrations
on a restart. Those migrations are not edited or reapplied to production.

`GET /dashboard-api/traffic/map/variable-speed-limits/current?corridor=I70` and
its protected `/api` alias read the database. Responses include direction,
source update, last successful read, communication state, and explicit unknown,
failed, stale, or unavailable limits. Reads older than one hour cannot confirm
changes. The configured regular road reference is not a per-sign clear-weather
maximum. No weather cause, crash correlation, or historical limit is inferred.

The separate static experimental preview can consume this public read-only
endpoint while its traffic data continues to use the existing experimental API.
The experimental container keeps its existing read-only role and disabled
Flyway, and does not require sign collection credentials or a restart.

Before rollout, take a checksummed database backup and verify a disposable
restore, preserve the existing API/ingestion images and private configuration,
and hold the updater lock. Deploy the reviewed main revision and replace only
ingestion and the primary API. Enable the sign poller, then verify fresh flow
on both corridors, CDOT/provider metadata, quota status, frozen history identity
counts, the new table, scoped sign attempts and source/read times, and timers.
Do not accelerate the initial sweep or issue diagnostic provider requests.

Rollback disables sign collection and restores the saved application images,
configuration, and main revision. Preserve V27 and captured sign state; do not
drop the table or reverse applied migrations. Keep API migration validation
in mind when restoring an older image whose resources stop before V27.

The deployment ledger records exact source/merge SHAs, PR checks, backup and
restore evidence, previous images, live scope, and final verification. Local
validation and the focused PR are recorded at delivery checkpoints.

Validation before review (October 14, 2026): `./mvnw clean verify` passed,
including the scoped client/poller and API tests; all 336 main dashboard tests
and `./scripts/verify-resilience.sh` passed. A fresh 262,860,979-byte production
backup matched SHA-256 `18b94bb940c0eafaf87a3497bc6cec5ad5002a09062aa89fd17ff8bb455d8082`.
Its full restore into the matching isolated TimescaleDB image succeeded. The
rebuilt API started, validated existing migrations, applied V27, and returned 42
explicitly unobserved signs. Six historical identity fingerprints matched before
and after migration. Production remained at V26 during this verification.
