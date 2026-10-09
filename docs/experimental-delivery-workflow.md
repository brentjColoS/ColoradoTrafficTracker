# Experimental delivery workflow

Production runs from `main`. The dashboard recovery integrates reviewed topics
into `experiment/dashboard-reconstruction` and ultimately releases that exact
reviewed revision to the existing experimental sidecar. These destinations are
not interchangeable. Necessary shared CI or operational prerequisites use their
own focused main PRs; experimental dashboard features do not.

## Topic cycle

1. Read `AGENTS.md`, the recovery ledger, and the relevant runbook. Inspect actual
   local, GitHub, and runtime state; preserve unrelated changes and checkpoints.
2. Create one clean topic branch from the latest accepted integration tip.
3. Recover the smallest complete behavior and its tests. Record original source
   commits and the retained hunks. Do not transplant an entire shared file when
   it contains other pending topics.
4. Run focused tests and all broader applicable gates. Open the PR explicitly
   with `--base experiment/dashboard-reconstruction`.
5. Inspect its real base, exact head, unique commits, and full diff. Wait for all
   applicable checks; merge the checked head without a rules bypass. Start the
   next topic from the accepted integration, not an unreviewed predecessor.
6. Update the ledger with the PR, accepted SHA, validation, deviations, and next
   action. Topic integration does not automatically authorize a release.

An integration branch naturally contains many topics. A topic PR must not become
the cumulative integration diff by changing its base. The CI integration marker
blocks accidental main targeting and cannot be removed or retargeted by a topic.
Any future production promotion requires its own explicit authority and scope
assessment; it is not a routine continuation of sidecar merges.

## Reconstruction after a revert

A merge revert restores files but leaves the original commits in ancestry.
Re-merging old branches or relying on an ordinary rebase can therefore omit the
reverted changes. Preserve those branches as source evidence. Start a new
integration at reviewed, reverted main and reconstruct focused patches with
provenance. Do not revert the revert or replay old merge commits.

Account for every retained file and behavior. Mark production-delivered
foundations and superseded experiments explicitly instead of replaying them.
Keep documentation truthful: historical test evidence is not validation of a
new reconstruction. Before release, compare runtime files and assets against the
intended source tree and justify every difference.

## Verification and release

Do not deploy partially reconstructed waves. Validate the complete candidate
locally using fixtures or retained data with ingestion off. Preserve accepted
visual quality while measuring performance through short, repeatable scenes;
repeat only a failing scene after a relevant correction.

Before a sidecar release, record the exact reviewed SHA, existing running image,
private configuration, and rollback method. Verify the existing read-only role,
disabled Flyway, resource headroom, live freshness, and production baseline.
Build the clean candidate before replacing only the experimental API container.
Verify readiness, public assets, both corridor observations, CDOT metadata, and
unchanged production services. Restore the previous sidecar image if verification
fails; stopping the sidecar or removing its public route is not normal rollback.

No experimental recovery should create ingestion schedules, contact providers
for diagnostics, modify historical samples, run migrations, or replace secrets.
Production changes, when genuinely necessary, remain separate reviewed topics
with their own rollout and live verification.

## Resuming work

The durable record must identify the working checkout, integration destination,
source revisions, current topic, PR/head/check state, accepted merges, deployment
state, authorized boundaries, and next action. Save it at natural checkpoints,
including before context compaction. On resumption, read the record and verify
the current state again. Do not repeat a merge or deployment merely because its
result was absent from the summary, and do not claim completion while work is
still pending.
