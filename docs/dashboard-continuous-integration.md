# Historical scrolling integration

## Delivery boundary

Accepted base: `65e66e77ecfbdf7e8694ac4127e8cd19491df256`.
Destination: `experiment/dashboard-reconstruction`, never `main`.
The original prototype remains preserved at
`71b57e8cf6964e0bb1d5e79a3bfb85b384ac83de` on
`experiment/dashboard-continuous-timeline`.
This integration does not authorize a VPS deployment or provider requests.

## Ordered topics

1. `feature/dashboard-scroll-controls`: port the compact controls, corridor-only
   detail selector, and three-second graph hover from `60cba81`, `242ec72`, and
   `00d22d9` without changing the accepted batch transport. Validate, open a
   focused PR, wait for every applicable check, and merge into the experimental
   integration.
2. Start a separate continuous-timeline topic from that accepted merge. Port
   `ab8fac2` and `71b57e8`, retaining bounded buffers and the existing renderer.
   Use the accepted shared scheduler instead of the prototype request counter.
   Prioritize snapshots, visible missing history, then speculative prefetch.
   Cancel obsolete queued work; retain the initial four-second spacing and
   three-interval look-ahead. Validate, review scope, and merge only after all
   applicable checks pass.

## Current checkpoint

Controls are being ported in `/private/tmp/ctt-scroll-controls.mO2Cdn`.
No PR, merge, or deployment has occurred for these topics yet.
Controls validation: all 249 dashboard regressions and the full Maven verify
passed, including every module's coverage gate. Bounded local browser inspection
confirmed collapsed default details, toggle expansion, and the corridor-only
selector on the accepted batch transport. No provider requests were made.
The existing 48rem responsive breakpoint is retained: primary controls wrap
there, while disabled historical details and the All Corridors detail selector
occupy no layout space. Keyboard navigation remains available immediately;
only graph wheel capture requires uninterrupted three-second dwell.

Validation and accepted PR revisions will be recorded at each delivery point.
