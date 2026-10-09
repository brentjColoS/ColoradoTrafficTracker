# Visible-window speed axes

Topic: `fix/dashboard-visible-speed-scale`, experimental integration only.

Continuous scrolling previously fitted the entire two-window raster strip,
included both extremes of the statistical reference band, and only widened the
axis. A past slowdown or broad baseline variation could therefore compress the
currently visible speed changes long after it had left the screen.

## Behavior

- Fit the actual visible window's observations, rendered trend, baseline means
  and posted-limit guides. Retain real boundary continuation/interpolation and
  gaps; do not remove a visible slowdown or outlier to obtain a narrower scale.
- Keep the cached full-resolution strip and stationary axes during ordinary pans.
  Rebuild only when a newly visible value requires an expansion, the existing
  strip is exhausted, data changes, or the axis is deliberately settling.
- Contract only for a range reduction greater than twenty percent. Wait until
  panning settles, then start after 180 ms and use six smoothstep updates spaced
  60 ms apart. New panning or lifecycle cancellation stops the transition.
- Keep tick labels at whole, aligned speeds even during the finite transition.
- Preserve the selected reference-band width. The band does not determine the
  axis; arrows in the right margin mark its continuation above/below the visible
  range. The canvas tooltip, accessible description and legend explain the arrows.
- Preserve separate posted-zone definitions, resolutions, DPR, the large-raster
  full-resolution fallback, scroll safeguards, request budgets and live freshness.

This is an explicitly auto-fitted speed scale, not a fixed universal range.
Different windows may use different labelled axes. All visible observations and
posted guides must fit; uncertainty continuing outside the scale is indicated,
not silently represented as a fully displayed band.

## Validation and limits

Regressions cover off-screen extremes and broad uncertainty, immediate expansion,
bounded settled contraction, cached small pans, cancellation, posted zones,
sigma changes and the full-resolution large-chart fallback. A synthetic
off-screen slowdown is retained in the strip while visible 58–62 mph observations
use a readable range. A slowdown still visible at a continued boundary must
remain included; that boundary is not discarded merely because its source sample
is just outside the viewport.

The complete frontend suite passes 300 tests. Native synthetic checks at a
1093-pixel viewport verified overall and posted-zone charts in light/dark mode,
edge indicators, zero page overflow, reset-to-current/scroll-disabled on corridor
switch, and three short prepared pans with the fixture read count unchanged at
17. The normal experimental URL prepared 14/14 nearby windows without flags.
The viewport override did not take effect, so no new mobile validation is claimed.
Final applicable CI/release evidence is recorded in the delivery checkpoint.
Synthetic scenes are not VPS capacity measurements. Six rebakes on a meaningful contraction are intentional;
there is no perpetual axis animation, polling service, reduced resolution,
provider request, database migration or data modification.

Rollback this focused topic to restore the previous continuous axes. Regular
noncontinuous charts keep their existing domain calculations; the aligned tick
iteration produces the same ticks for their existing integer bounds.
