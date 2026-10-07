# Bounded dashboard motion assessment

The local diagnostic is not application code and is never included in the API
container. Start the synthetic fixture on loopback 8091, then start
`node scripts/tests/dashboard-motion-preview.cjs` on loopback 8092. It accepts
only GET requests and proxies API/health reads only to that fixture, with an
eight-second deadline. It never proxies the user's 8080 server or production.

Use the same native viewport/theme for these three variants:

- `motionRevision=current`: the checked working candidate.
- `motionRevision=original`: exact `91ba877e52dec27d2592828f2de1109ded9622f9`.
- `motionRevision=stripped`: exact `32e3689c86d8aa67c58c82656e807366feb4ea1f`.

Each source variant serves its complete HTML and matching assets, not old styles
against new markup. A local renderer wrapper counts style updates identically
for all variants; it does not change rendering. The original pages are diagnostic
evidence, not content to deploy. Requests and assets are not cached between runs.
The preserved Git objects must be available for original/stripped comparisons;
missing trees return 404 rather than silently substituting the candidate. Unit
tests use isolated source fixtures so shallow CI checkouts need not download the
repository's entire historical experiment merely to test request routing.

## Fixed protocol

At 1093×827, use System for the panel-border and diagram scenes, and About the
Data for the interpretation-grid and map-pulse scenes. Choose the scene, wait
for the map or page to initialize, and select **Measure 8 seconds** once.
There are twelve samples: four scenes times three variants, 96 sampling seconds.
Repeat only a failed scene after a relevant correction; do not extend the run
into an open-ended soak or tune away the accepted visuals.

The border scene alternates actual focus every 800 ms. Grid and diagram scenes
retain their normal animation clocks. The map scene must have a canvas and
current traveling overlays must visibly move. All scenes scroll their target
into view and allow 500 ms for setup before sampling.

The result records frame median/p95, frames exceeding 25/50 ms, long tasks when
supported, layout-rectangle reads, map-style calls, viewport/DPR and initial/
final active-animation evidence. Unsupported long-task monitoring is `null`,
not a false zero. Sampling stops after 8 seconds, has a 9-second stalled-frame
deadline, and aborts if the tab is hidden or navigation interrupts it.
Instrumentation, observers and scheduled callbacks are restored in every case.

Frame cadence is not total CPU, GPU, thermal or memory utilization. A smooth
eight-second run does not prove every computer will be smooth. Assess it with
the known eliminated work: no steady per-frame connector layout, no traveling
layout properties or animated shadows, no continuous map paint-property writes,
and offscreen/hidden/reduced-motion pausing. Preserve high-resolution canvases.
Record the actual measurements and their limits before the single sidecar release.
