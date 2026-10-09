# Prepared historical windows experiment

Topic: `feature/dashboard-prepared-history`, from accepted experimental release
`70cc33dd05f996982d57956fccaa6ae004b01224`. This topic does not change `main`,
production, migrations, provider allowances, or the deployed sidecar.

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
