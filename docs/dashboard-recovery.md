# Dashboard recovery ledger

Tracking issue: [#118](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/118).
The [machine-readable ledger](dashboard-recovery-ledger.json) is the durable
source inventory and topic record. Read it with `AGENTS.md` before resuming work.

## Authority and state

The user authorized validation, focused merges, and the completed experimental
sidecar release without requiring personal inspection. This does not authorize
experimental dashboard promotion to main. Necessary shared prerequisites remain
separate, narrowly scoped main PRs. Production data and private configuration
must remain intact.

| State | Revision/evidence |
| --- | --- |
| Post-revert main baseline | `dcbdeee`, same tree as pre-#114 `c3e80d7` |
| CI prerequisite | #119, merge `31bd44b`, all applicable CI and CodeQL passed |
| Working agreement | #120, merge `bcb7065`, all applicable CI and CodeQL passed |
| Public dependency resolution | #126, merge `b9cbf9d`, all applicable CI and CodeQL passed; separately import the focused fix into experimental integration |
| New experimental integration start | `bcb7065` |
| Restored visual reference | `1d963b6` |
| Public sidecar before recovery | `91ba877`, unchanged until final release |
| Separate scrolling source | `26872fc`, draft #116 remains unmerged |

Preserved tags are `checkpoint/dashboard-restored-motion-2026-10-07`,
`checkpoint/sidecar-before-reconstruction-2026-10-07`, and
`checkpoint/dashboard-scroll-source-2026-10-07`. Original source branches remain
untouched. The stripped `32e3689` performance checkpoint is comparison evidence,
not the accepted visual target.

## Ordered topics

Every row is a separate topic branch and PR to `experiment/dashboard-reconstruction`.
IDs are stable ledger identifiers, not promises that unrelated features share a
branch. The source inventory assigns possible file owners; shared-file hunks must
be classified and recorded as the corresponding topic is recovered.

| ID | Topic branch |
| --- | --- |
| 1 | `docs/dashboard-recovery-boundaries` |
| 2 | `ops/read-only-dashboard-sidecar` |
| 3 | `feature/dashboard-recent-incidents` |
| 4 | `feature/dual-corridor-dashboard` |
| 5 | `feature/dashboard-retained-replay` |
| 6 | `feature/dashboard-chart-exploration` |
| 7 | `feature/weekly-traffic-baselines` |
| 8 | `feature/dashboard-time-ruler` |
| 9 | `feature/speed-zone-history-charts` |
| 17 | `feature/dashboard-geometry-proxy` |
| 18 | `feature/dashboard-map-renderer` |
| 19 | `feature/focused-corridor-map` |
| 20 | `feature/corridor-map-current-flow` |
| 21 | `feature/corridor-map-slowdown-history` |
| 22 | `feature/corridor-map-incident-timeline` |
| 23 | `feature/corridor-map-context` |
| 24 | `fix/corridor-map-renderer-lifecycle` |
| 10 | `feature/dashboard-incident-details` |
| 11 | `fix/dashboard-incident-table-scroll` |
| 12 | `fix/dashboard-current-flow-metrics` |
| 13 | `feature/dashboard-daily-travel-range` |
| 14 | `feature/speed-zone-limit-guides` |
| 15 | `feature/dashboard-view-preloading` |
| 16 | `feature/dashboard-wide-layout` |
| 25 | `feature/dashboard-information-shell` |
| 26 | `feature/system-architecture-story` |
| 27 | `feature/system-section-navigation` |
| 28 | `feature/system-live-health-panel` |
| 29 | `feature/data-evidence-page` |
| 30 | `feature/api-explorer-page` |
| 31 | `fix/information-hero-consistency` |
| 32 | `feature/data-corridor-hero-map` |
| 33 | `fix/dashboard-i70-coverage-alignment` |
| 34 | `fix/information-panel-border-motion` |
| 35 | `fix/information-grid-wave-motion` |
| 36 | `fix/system-architecture-motion` |
| 37 | `fix/road-sign-pointer-scope` |
| 38 | `feature/data-map-travel-pulses` |

Map-dependent incident presentation, current-cell metric plumbing, and renderer
warming require the map foundations first. This is the reason IDs 17–24 precede
10–16 in execution. It avoids changing topic scope merely to satisfy an earlier
proposed order. Historical coverage and scrolling are separate topics after the
reconstructed baseline has passed assessment.

## Accounting and validation

The experimental integration is protected by ruleset `24632736`: only up-to-date
topic PRs can merge, with `ci-complete` and the four verified CodeQL Analyze checks
required. There are no bypass actors; deletion and force pushes are blocked.
Merge commits preserve individual topic boundaries. Main has its separate ruleset
`24631611`. GitHub's managed CodeQL setup did not schedule scans when this
integration was protected only by a ruleset. Matching classic branch protection
is therefore also enabled, including administrator enforcement and the same five
required checks. Neither layer permits deletion or force pushes. Actual scans,
not merely configured settings, must pass before accepting a topic. Settings are
not deployment triggers.

The original net change is 91 files, 168 non-merge source commits, and 56 merge
checkpoints. Merge checkpoints are evidence, not commits to replay. Production
common/ingest/routes foundations and migrations have no net change to recover.
Temporary handoffs and superseded implementations do not need resurrection.

For each accepted topic, record source commits and actual retained hunks, its PR,
exact checked head, accepted merge SHA, commands/outcomes, and justified deviations.
Pending entries are not evidence of completed validation. Never use an old test
result as proof of a new reconstructed tree.

CI and corrected governance intentionally differ from the old source. Other
runtime/assets must match the intended reference or have a reviewed exception.
Full source accounting, applicable gates, local browser review, and bounded
performance assessment precede the exact-SHA sidecar-only release. Preserve the
old image and private configuration for rollback. No partial wave is deployed.

Replay PR #125 initially failed API container dependency resolution. The shared
resolver fix passed as main prerequisite #126 and experimental import #127.
Replay incorporated that accepted experimental base, passed fresh CI and CodeQL
runs, and merged at `379cf8f`. The failed packaging gate was neither bypassed nor
blindly rerun. Source-topic reconstruction now continues from the accepted tip.
