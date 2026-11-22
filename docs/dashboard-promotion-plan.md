# Primary dashboard cutover

On October 10, 2026, [PR #212](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/212)
promoted the accepted dashboard to `/dashboard/`. The release kept older and
experimental readers independently buildable without making them production
dependencies. This is a dated decision record; current procedures live in the
[deployment](cloud-vps-deployment.md) and [sidecar](dashboard-sidecar-operations.md) guides.

## Isolation and reproducibility

The primary application moved to reviewed main. Optional readers use separate
Compose projects, loopback ports, SELECT-only logins, disabled Flyway and no
provider credentials. Their restart policy is `no`; normal deployment, update,
rollback and reboot do not start them. Their routes stay outside public navigation.

Named checkpoint refs preserve both previous sources. Reader builds use temporary
Git archives from committed revisions, excluding populated host configuration.
The legacy adaptation changes only its asset/API prefixes and retains original
artwork. Source and reader variant are recorded in image identities.

## Cutover and rollback

The release held the updater lock, paused its timer and preserved previous images,
proxy configuration and a checksum-verified database dump outside normal backup
retention. Only the primary API container was replaced; database, ingestion and
routes identities, images, start times and mounts stayed unchanged.

Rollback retains both a runnable previous image and its Compose image tag, so a
reboot selects the restored revision. Database contents and applied migrations
remain intact. The updater stays paused while main selects a failed candidate.

## Recorded verification

The [evidence record](evidence/dashboard-promotion-2026-10-10.json) identifies the
reviewed head, merge revision, checkpoint refs and reported checks. Eleven frozen
identity/time datasets and migration-history fingerprints matched across cutover.
Those checks establish the recorded identity/coverage invariants; they are not a
full content checksum of every traffic row.

Public readiness, corridor/CDOT/provider freshness, charts, themes, historical
navigation and independent optional-reader lifecycle checks passed. The updater,
health and backup timers were restored or retained. These results describe that
release; later releases require their own verification.
