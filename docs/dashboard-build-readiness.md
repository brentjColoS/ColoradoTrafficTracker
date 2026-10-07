# Dashboard reconstruction assessment

The complete reconstructed baseline targets only
`experiment/dashboard-reconstruction`. Final assessment #175 passed all checks
and its accepted merge `654fb1b` was released to the sidecar on October 7, 2026.
The [release record](dashboard-recovery-release.json) records fresh preflight and
post-release evidence. Production UI promotion is not authorized.
Read `AGENTS.md`, [the recovery ledger](dashboard-recovery.md),
and [the delivery workflow](experimental-delivery-workflow.md).

## Source and acceptance evidence

The ledger accounts for 91 net-changed files, 168 non-merge source commits and
56 original merge checkpoints. Each file records its original and candidate
blob and either exact parity or reviewed differences. Original merge parents
were verified; none of those merges were replayed. Production-delivered ingest,
geometry, quota, schema and retention foundations were not duplicated.

Every retained problem has a separate topic branch and checked PR back to the
experimental integration. Main prerequisites #119/#120/#126/#130 changed only
CI/build/governance; focused imports preserved the experimental boundary.
All applicable build, frontend, coverage, mutation, resilience, Windows,
container and security gates remain enforced. Actual four-language CodeQL scans
and exact-head/file/commit guards preceded normal merges. A shallow-checkout
diagnostic-test failure in #173 was fixed with isolated source fixtures, not by
weakening a test or downloading all experimental history in CI.

## Functional and visual assessment

The final cache topic passed 203 frontend regressions, 33 tooling tests,
actionlint, diff checks and Java 21 full clean verification with all module
coverage gates (34.984 seconds). Prior topic checks and native evidence remain
attached to their exact heads in the ledger; these are not old pre-recovery
claims repurposed as current validation.

Native fixture checks across both `/dashboard/` and `/dashboard-experimental/`
covered light/dark themes and 320, 390, 1093 and 2560-pixel widths. Checks include
all five preloaded ranges, corridor focus, overall/zone plots, incident panels,
posted guides, retained/current estimates, hourly/frequency maps, attribution,
missing geometry, no-WebGL and failed-renderer/raster recovery. No document
overflow was found at those explicit viewports. High-resolution canvases remain
intact; range/theme controls do not start new reads. The two-row operations pills
and narrow map legend fit without overlapping text.

Final native spot checks at 1093 pixels confirmed concrete partial-I-70 failure
reasons while I-25 remains usable, cold-offline manual retry, empty-data values,
API HTTP429 with Retry-After60, eight-second Data/API timeout and retry messages,
and distinct degraded versus out-of-service System states. Behavioral tests
also cover no-check/hidden/overlap health, retained-day boundaries, stopped and
incomplete estimates, failed slices, replay clock/end bounds, map lifecycle,
reduced-motion and back-forward-cache disposal. Reduced-motion behavior was
verified through fixture/unit animation controls; an OS preference change was
not claimed as a native browser test.

## Bounded motion assessment

The [fixed comparison](dashboard-motion-assessment.md) completed exactly twelve
eight-second scenes (96 sampling seconds), using complete original, stripped and
recovered asset trees at 1093×827/DPR1/dark. The recovered version retained border
traces, diagram motion, gold grids and moving 95/100-second corridor pulses.
All four recovered scenes had 480 frames, p95 18.5–18.6ms, no frame over25ms,
no long tasks, no ongoing rectangle reads and no map paint-property calls.
Original border/diagram scenes each made5291 rectangle reads; original/stripped
maps made1888/732 paint-property calls. These are bounded same-machine results,
not universal CPU/GPU/thermal guarantees. No extra library, reduced-resolution
canvas, or server-rendered substitute was needed.

## Release checklist

The release completed this sequence after every final assessment check passed:

1. Record its exact accepted merge SHA and the previous full-SHA sidecar image.
2. Verify production revision/health, fresh I-25/I-70/CDOT, quota capacity,
   historical continuity, required timers, disk/RAM headroom and container IDs.
3. Verify the existing SELECT-only database role/default read-only transaction,
   Flyway off, Hikari read-only and preserved private configuration. Print no secrets.
4. Build the clean candidate separately, then replace only the experimental API
   through the [sidecar helper](experimental-dashboard-sidecar.md).
5. Verify readiness, public assets/data, both corridor observations/CDOT metadata,
   unchanged production identities/configuration and read-only access.
6. Record actual deployed revision/results. Restore the previous sidecar image
   if verification fails; do not remove its public route.

Public byte-for-byte, health, freshness and history checks passed. A saved user
browser permission blocks visual access to the public domain; it was not
bypassed. Public browser appearance is therefore not claimed as tested. The
identical application assets were assessed visually in owned local fixtures.

No partial wave is released. Historical graph scrolling follows afterward as a
separate default-disabled experiment, not as part of this reconstructed baseline.
