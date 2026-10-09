# Critical dashboard bootstrap experiment

Issue: #192. Topic: `perf/dashboard-critical-bootstrap`, from accepted experimental
`25c2c11a0ce7305e480d03486c710aabd37fd635`. Destination, if accepted, is
`experiment/dashboard-reconstruction`, never `main`.

## Candidate

Initial live HTML retains both overall charts, observed samples, their baselines,
incidents, current travel estimates, route geometry and actual health. Only the
two speed-zone trends and two speed-zone baselines are deferred: 15 initial
sections rather than 19 in the non-truncated case. The existing all-view snapshot
request fills them in. No endpoint, new library, polling, request allowance,
database fan-out, cache weight, freshness lifetime or visual-resolution change.
The same section keys/cache reuse earlier reads and preserve version hints.

The bootstrap script explicitly marks deferred zones. During completion, zone
charts announce loading and daily travel extrema remain pending rather than
claiming a range based only on the current estimate. A failed completion retains
the existing graphs, ends the pending state and offers Sync now. Ordinary missing
observations remain distinct from a failed read. Demo, historical and replay
modes still skip the live HTML bootstrap. Full bootstrap documents remain usable.

## Bounded assessment

Two isolated local APIs used the existing retained database with ingestion off,
Flyway disabled, read-only transactions and two-connection pools. One cold and
one warm HTML request per API produced:

| Case | Accepted baseline | Candidate |
| --- | ---: | ---: |
| Cold HTML, complete body | 715.6 ms | 632.0 ms |
| Warm HTML, complete body | 16.6 ms | 17.0 ms |

These local observations end June 19, so current-window chart samples were empty.
They are **not** first-useful-graph measurements or VPS cold-capacity evidence.
The local API also reports existing unavailable flow-cell/zone slices; the
experiment does not alter its data or conceal these failures.

Two bounded read-only public snapshot captures supplied actual retained payloads
for offline native-browser assessment. The 24H capture was 3,448,208 uncompressed
JSON bytes; the four deferred zone sections account for approximately 20%.
No provider request was made. Both browser variants used identically preloaded
source assets, dark theme and the same captured all-view snapshot. The recorded
first draw of both useful charts contained 1,366 observations per corridor:

| Browser trial | Accepted baseline | Candidate |
| --- | ---: | ---: |
| First recorded navigation | 185.9 ms | 159.7 ms |
| Repeat navigation | 146.4 ms | 130.0 ms |

These are a finite local transfer/parse/render comparison, not a true cold
browser cache trial, end-user latency guarantee or live database benchmark.
Diagnostic timing probes were corrected before recording these final numbers;
discarded timings with unequal source-loading overhead are not evidence.
Candidate I-70 speed zones and 7D/24H switching displayed the retained data; no
browser errors were observed. Existing user previews/containers were preserved.

## Validation and decision

318 frontend regressions pass, including deferred loading, pending travel labels,
background failure recovery and unchanged one-request all-view completion.
Focused Java tests cover deferred sections, cache reuse, real failures, escaped
HTML, no-store and review-mode bypass. Full `./mvnw clean verify` and all coverage
checks pass locally on JDK24 targeting Java21. Exact-head CI is required before
acceptance; Java21 CI evidence must not be inferred from the local runtime.

Retain this small candidate for review: the client benefit is modest and the
initial payload is smaller without changing charts or recurring budgets.
**Issue #192 remains open.** A meaningful live cold-query/first-useful-graph gain
has not been established. No merge or deployment is authorized for this topic.
Production and the VPS sidecar remain unchanged. No continuing benchmark runs.
