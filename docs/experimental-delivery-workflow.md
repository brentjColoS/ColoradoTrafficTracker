# Experimental releases

Production runs from `main`. Experimental topics target
`experiment/dashboard-reconstruction` and release through the separate,
read-only sidecar. Shared backend or CI prerequisites use focused PRs to main.
The branch destination and deployed environment are part of the release scope.

## Review and integration

1. Branch from the latest accepted tip of the intended integration.
2. Keep each topic limited to one behavior and its relevant tests.
3. Validate locally, then open the PR against that integration.
4. Review the base, exact head, unique commits and full changed-file list.
5. Require all applicable checks on the reviewed head before merging.

The integration's `.github/experimental-integration.json` marker identifies its
base branch. CI rejects accidental main targeting and rejects removal or
retargeting of that marker. A green experimental PR validates that topic; it
does not promote its integration to production.

## Data and runtime isolation

The sidecar replaces only its own API container. It reads production data through
its existing SELECT-only role, with Flyway disabled and no provider credentials.
It owns no database volume, ingestion schedule or routes service. Production
containers, private configuration and retained observations remain independent.

Local fixtures use synthetic or retained data with provider collection disabled.
They verify behavior without consuming provider allowance. Check the complete
candidate, including its HTML, assets and backend contracts, before release.

## Release and rollback

Record the reviewed source SHA, candidate and previous image identities,
configuration version, verification results and rollback target. Build the clean
candidate before replacing the running reader. Confirm resource headroom and a
healthy rollback baseline.

After replacement, verify readiness, packaged public assets, both corridor
observation times, CDOT metadata and unchanged production services. Container
liveness alone is insufficient. If verification fails, restore the previous
sidecar image and its configuration, then verify it again. Keep the failure
visible even when restoration succeeds.

The [sidecar runbook](dashboard-sidecar-operations.md) owns the lifecycle commands.
Production promotion uses the separate [deployment procedure](cloud-vps-deployment.md).

## Recovering a reverted integration

A merge revert restores files while leaving the original commits in ancestry.
Re-merging the old branch can therefore omit reverted changes. Preserve source
commits, start from the reviewed post-revert base and reconstruct focused patches
with traceable provenance. Account for already delivered foundations and
superseded experiments before recovering a topic.

Compare the final runtime tree with its intended source and explain intentional
differences. Historical test results remain evidence for their original revision;
the reconstructed candidate needs its own checks.
