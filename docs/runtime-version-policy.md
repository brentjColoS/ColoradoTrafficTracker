# Runtime version policy

The production baseline is intentionally conservative and reproducible:

| Component | Pinned baseline |
| --- | --- |
| Java runtime and CI | Eclipse Temurin 21.0.12+8 |
| Maven wrapper and container build | Maven 3.9.11 |
| Spring Boot | 3.5.16 |
| Database image | TimescaleDB 2.28.0 on PostgreSQL 16 |
| CI runner | Ubuntu 24.04 |

Container references retain a readable version tag and pin the corresponding
multi-architecture manifest digest. The Maven wrapper verifies its downloaded
distribution with SHA-256. CI actions are pinned to full commit hashes with the
release number beside each reference. Maven and GitHub Actions updates are
reported by Dependabot.

Review container releases at least quarterly and whenever a relevant security
advisory appears. Database image changes require a successful backup, a restore
test, and the normal live-ingest deployment verification. Java image changes
require the full Maven test suite and a container build. Update a tag and its
digest together; never change a digest while leaving an inaccurate tag.

## Spring Boot 4 decision

Spring Boot 3.5.16 is the final open-source maintenance release in the 3.5 line.
It is a short-term stability choice, not an indefinite version policy. A move to
Spring Boot 4.x should be a planned migration rather than an automatic dependency
update because it also crosses major Spring Framework and Jackson generations.

Reconsider that migration when at least one of these is true:

- an applicable security issue cannot be resolved on the current baseline;
- a 4.x feature removes meaningful project-owned code or operating complexity;
- the current dependency line no longer supports the production Java version;
- a focused migration branch passes the full suite, database restore check, and
  live-ingest deployment gate without compatibility shims that add more code
  than the upgrade removes.

Until then, a major framework migration does not provide enough direct benefit
to justify its testing and integration cost for this project.
