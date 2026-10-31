# Prioritized cleanup after segment 45

Accepted parent: `0679cdeb1d702dcaa21a5f815f6cdc47b336fee8`.
Destination: `experiment/dashboard-reconstruction`. Main promotion is excluded.
The [recovery ledger](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267)
records current heads, checks, acceptance and release; recheck it before resuming.
These temporary notes are excluded from cleanup counts.

| Candidate | Disposition |
| --- | --- |
| 46, chart preparation | Share the matching 90-minute gap segmentation loop; retain the rendering-only invalid-point break. |
| 47, calendar/time axes | Keep Denver profile time and viewer day transitions separate, including DST behavior. |
| 48, chart grids | Retain the intentionally different corridor/zone fonts, dash patterns, spacing and scale setup. |
| 49, incident normalization | Reject the trial field record: one net line saved does not justify another intermediate representation. |
| 50, incident presentation | Retain distinct table detail availability, lazy source reports, chart labels and long-range day groups. |
| 55, information CSS | Group three identical rule pairs; remove eight earlier declarations unconditionally superseded by the same selectors. |
| 56, dashboard CSS | Group focused/expanded incident scrolling, responsive heights and speed-control focus outlines. |
| 60, packaged resources | Retain all assets; references include dynamically generated incident classes, vendor modules, previews and artwork authoring. |

Three implementation topics remove 38 runtime lines net; the chart regression
case adds 19 test lines. No source extraction, service removal, dependency change,
API change, provider call, schema change or historical-data change is included.
Candidates 51–54 and 57–59 remain deferred. This assessment does not claim that
all segments through 60 were implemented or that the entire repository is clean.

Before acceptance, require full dashboard tests, recorded chart/canvas parity,
CSS cascade/state comparisons, packaging and runnable application verification,
and all applicable CI. Then verify the actual merged revision and preserve the
existing experimental image as rollback before any authorized sidecar release.
