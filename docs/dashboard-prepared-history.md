# Prepared historical windows experiment

Topic: `feature/dashboard-prepared-history`, from accepted experimental release
`70cc33dd05f996982d57956fccaa6ae004b01224`. PR #188 was accepted and released to
the experimental sidecar. Default activation was accepted independently in #190;
the original combined default/axis release was `4666327`. Subsequent smoothing
topics #194, #196, #197 and #198 and retry-controls #200 are accepted separately.
The scrolling retry-controls release is
`a9e3b926890994085e1006a97cb0c6883ca8b8ae`.
See [current runtime status](dashboard-experiment-status.md) and
[the smoothing contract](dashboard-history-smoothing.md) for current release and
cursor-centered preparation details. Production, migrations, provider allowances,
request budgets and private configuration are unchanged.

The experimental dashboard enables continuous scrolling and prepared windows at
its normal `/dashboard-experimental/` URL. Historical Scroll still defaults to
Disabled; background preparation does not capture page scrolling. Explicit
`?continuous=0` compares the earlier discrete loader; `?prepared=0` compares
continuous scrolling without initial preparation. Regular `/dashboard/` and
local production-shaped URLs retain their existing defaults; the experiment can
be requested there with `?continuous=1&prepared=1`.

## Working set

After all five existing current snapshots are available, retain their graph data
for both overall and zone views. Both corridors share each view/range buffer, so
switching from combined graphs to either corridor does not discard downloaded
history. Corridor switches still return to Current and disable scrolling; the
three-second hover requirement and graph resolution are unchanged.

Prepare three older two-hour intervals and one older interval for each other
range, in both modes: at most fourteen sequential history batch requests for
the session. This provides an eight-hour short-range strip and two-window strips
for the other ranges, including the same six-hour historical shift across all
views. Missing dataset coverage, genuine gaps and changed road definitions are
preserved. It does not load all retained history or make arbitrary deep jumps
instantaneous. Once the finite set is prepared, live synchronization does not
restart the sweep. Further history still loads on demand.

Initial preparation uses the existing single-request scheduler, at speculative
priority, but does not add an artificial four-second delay between fast reads.
The same 48/minute page budget, two reserved live slots, server Retry-After,
slow-response backoff, visibility/navigation cancellation and live priority
remain. This is a finite preparation burst, not an ongoing increase in polling.

The ten view/range scopes retain at most thirty-two chunks collectively, twelve
per active scope, and the existing 60,000-record soft target. Shared snapshot and
weekly baseline objects are counted once by reference, not once per scope.
Prepared seeds retain graph fields only, not map geometry, summary payloads or
unrelated daily statistics; the point arrays themselves are shared without copies.
Visible intervals remain protected if an unusually large response exceeds the
soft target. This record budget is not an exact JavaScript heap measurement.
Evicted or failed preparation is not repeatedly downloaded in the background.
The toggle tooltip reports actually retained successful windows, not merely
attempted requests. Partial views retain the existing explicit Retry behavior.

## Verification and limits

The measurements below describe the original prepared-history topic, not a new
latency or capacity assessment of the latest release. Current verification is
recorded in [experiment status](dashboard-experiment-status.md).

Behavioral regressions cover finite completion while scrolling is disabled,
six-hour same-time switching across all frames and corridors without visible
reads, request headroom/cancellation/resume, absent coverage, slow-read backoff,
partial failure and oversized eviction without retry loops, and opt-in isolation.

All 292 frontend tests and full Maven verification/coverage passed locally. A
native browser fixture check retained all fourteen prepared windows, moved six
hours into history, and switched overall/zones/2H without changing the displayed
end time or showing a loading notice. The default detail toolbar stayed hidden;
canvas resolution and page width remained unchanged, with no rendering errors.

The deployed sidecar's finite check measured cold long-range zones at 1.087s,
overlap at 0.609s and known-version response at 0.014s. These are release checks,
not measurements of this new browser experiment. Synthetic local interaction
checks cannot establish production capacity or cold-load latency.

The server's initial uncached HTML bootstrap took 5.301s in release verification.
Browser preparation cannot eliminate that server-rendering cost. The retained
local June dump also takes a legacy incident-history compatibility path; it is
not representative of current durable incident data. Decoupling that critical
path, or deeper cross-resolution caching, requires a separate measured topic.

Rollback: use `prepared=0` or revert this focused topic. No data, provider,
configuration, library, storage service, or schema changes are involved.

## Original accepted release — October 8

PR #188 passed all twenty applicable CI/security checks on `54d037f`, then merged
only into `experiment/dashboard-reconstruction` at `a284bec`. That exact revision
was deployed and verified on October 8. Production containers, private routing
and configuration, historical continuity and required timers remained unchanged;
read-only access and disabled Flyway were verified. The previous `70cc33d` image
was preserved for rollback at that release. This is historical release evidence;
consult the current runtime status above for later releases and rollback revisions.

At that release, `/dashboard-experimental/?continuous=1&prepared=1` enabled the
opt-in experiment. PR #190 subsequently made preparation the experimental
default. The local 8080 retained-data candidate was not replaced by the October 8
release; its 8091 assessment preview used synthetic data.

See the [verified release evidence](dashboard-prepared-release.json) and
[loading and rate-limit assessment](dashboard-loading-assessment.md). The finite
server sequence took 4.027 seconds for fourteen sequential history reads, with
no slow-read cooldown or rate rejection. This is not browser readiness timing or
a multi-user capacity guarantee. No limits were raised following that assessment.
