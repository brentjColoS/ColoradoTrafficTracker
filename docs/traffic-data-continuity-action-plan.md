# Traffic Data Continuity Action Plan

Status: implementation and production rehearsal

Last updated: July 31, 2026

Primary constraint: no traffic-provider charges; the VPS should remain the only recurring cost unless the user explicitly changes that decision.

## Handoff Directive

This document is the source of truth for the next implementation pass. A new agent should:

1. Read this document completely before changing code or server configuration.
2. Reconfirm live provider limits and licensing terms because they can change without a repository change.
3. Preserve the user's priorities: one-minute or near-two-minute flow, useful corridor detail, public portfolio value, and zero API spend.
4. Implement the smallest safe recovery first, then the provider-separated design.
5. Never add API keys, account identifiers, dump files, or server credentials to Git.
6. Do not enable TomTom pay-as-you-go or another paid provider without explicit user approval.
7. Do not delete existing server data. Take a verified backup before schema or deployment changes.

## Executive Decision

The preferred zero-provider-cost path is:

- TomTom remains the flow provider.
- CDOT COtrip becomes the incident and planned-event provider.
- Flow and incident schedules become independent.
- The selected long-term flow profile is zoom 10 every 60 seconds.
- Two independent TomTom accounts provide separate 200,000-request vector
  allowances. Primary is intentionally consumed first, then complete polling
  batches roll to secondary.
- CDOT Current Incidents and Planned Events are fetched every 15 minutes and normalized into the existing incident model.
- A database-backed calendar-month request governor tracks each account
  separately, warns at 190,000, and hard-stops that account at 195,000 before
  moving to the next one. The combined internal hard stop is 390,000 against a
  combined provider allowance of 400,000.

The first recovery fallback, if CDOT access is not ready, is TomTom zoom 9 with flow and incident tiles every 120 seconds. It is configuration-compatible with the current coupled poller and fits the new free allowance.

## User Requirements

Treat the following as product requirements, not suggestions:

- Do not add a recurring traffic API bill.
- Keep the server bill as the only current recurring cost and investigate lowering it after ingestion is stable.
- Preserve high-granularity data and visible data flow because those are central to the portfolio story.
- Get as close as practical to the earlier one-minute polling behavior, or produce a design that is demonstrably better.
- Preserve I-25 and I-70 direction, mile-marker, speed-zone, incident, map, and historical analysis features.
- Keep the public dashboard credible. Show actual source, resolution, and freshness rather than implying all data is first-party or equally fresh.
- Prefer an implementation that demonstrates thoughtful engineering: provider separation, quota governance, resilience, observability, and authoritative Colorado data.

## What Changed At TomTom

The production failure was ultimately traced to a TomTom account-policy change, not a bad key or a TomTom platform outage:

- The account now receives monthly allowances per API.
- Traffic Flow and Incidents Vector Tiles share a 200,000-request monthly allowance.
- Traffic Incident Details has a separate 2,500-request monthly allowance.
- Traffic Flow Segment Data has a separate 20,000-request monthly allowance.
- The TomTom dashboard showed 200,000 of 200,000 vector-tile requests and 2,500 of 2,500 incident-detail requests used.
- Once the allowance was exhausted, requests returned authorization-style failures and the provider guard halted ingestion.
- New API keys did not solve the problem because the limit is associated with the account/product allowance, not merely an individual key.

TomTom's current pricing page is the authoritative place to recheck these figures:

- <https://docs.tomtom.com/pricing>

## How The Repository Reached The Limit

The current cloud profile is tile mode, zoom 11, every 120 seconds:

- `.env.cloud.example`
  - `TRAFFIC_MODE=tile`
  - `TRAFFIC_POLL_SECONDS=120`
  - `TRAFFIC_TILE_ZOOM=11`
- `TileTrafficPoller` treats every tile cycle as two calls per unique tile:
  - one flow tile
  - one incident tile
- Current route geometry covers 15 unique zoom-11 tiles across I-25 and I-70.

At 120 seconds:

```text
15 unique tiles
* 2 endpoints
* 720 cycles/day
= 21,600 requests/day

21,600 * 30 days = 648,000 requests/month
21,600 * 31 days = 669,600 requests/month
```

A 200,000-request allowance is exhausted after about 9.26 days at that rate. Restart attempts may have added requests, but the steady-state design alone was guaranteed to exceed the new monthly allowance.

The user's earlier desired 60-second cadence would have used 1,296,000 requests in a 30-day month at zoom 11 with both endpoints.

Point mode is not a free escape hatch. At the previously observed 10-minute point-mode cadence, its approximate monthly use would still exceed both the 20,000 flow-segment allowance and the 2,500 incident-details allowance.

## Current Code Gaps

The next agent should verify these paths before editing:

- `ingest-service/src/main/java/com/example/ingest_service/TrafficPoller.java`
  - One scheduled cycle controls both flow and incidents.
  - The TomTom key is a prerequisite for the entire cycle.
- `ingest-service/src/main/java/com/example/ingest_service/TileTrafficPoller.java`
  - Flow and incident requests are coupled.
  - Both endpoints use one zoom plan.
  - `ENDPOINTS_PER_TILE` is hard-coded as `2`.
- `ingest-service/src/main/java/com/example/ingest_service/TrafficRequestBudget.java`
  - Accounting is keyed by UTC day.
  - The provider now bills by calendar month.
- `ingest-service/src/main/resources/db/migration/V12__provider_request_budget.sql`
  - The persistence model is daily and needs an additive migration.
- `ingest-service/src/main/java/com/example/ingest_service/TrafficSampleWriter.java`
  - Normalized incidents are tied to a flow sample.
  - Reusing a 15-minute CDOT snapshot on every flow sample can inflate observation counts unless incident identity is preserved.
- `ingest-service/src/main/java/com/example/ingest_service/IncidentLocationEnricher.java`
  - Existing direction and mile-marker enrichment should be reused for CDOT geometry.
- `api-service/src/main/java/com/example/api_service/TrafficDashboardController.java`
  - Recent-incident calculations assume incident rows are observations linked to sample time.
- `api-service/src/main/java/com/example/api_service/TrafficMapController.java`
  - The map surface can remain stable if CDOT is normalized into the existing GeoJSON-oriented contract.

## Verified Tile Footprint

The route GeoJSON currently produces these union tile counts:

| Zoom | I-25 tiles | I-70 tiles | Union tiles | Calls per coupled cycle |
|---|---:|---:|---:|---:|
| 7 | 1 | 1 | 1 | 2 |
| 8 | 2 | 2 | 3 | 6 |
| 9 | 3 | 2 | 4 | 8 |
| 10 | 4 | 4 | 8 | 16 |
| 11 | 8 | 7 | 15 | 30 |
| 12 | 14 | 15 | 29 | 58 |

Recalculate these counts if corridor geometry changes. Do not treat them as permanent provider constants.

## Zero-Cost Request Profiles

Use a 31-day month for safe projections.

| Profile | TomTom requests per 31 days | Buffer below 200,000 | Result |
|---|---:|---:|---|
| Current: z11 flow + incidents, 120s | 669,600 | -469,600 | Impossible on free tier |
| Desired old cadence: z11 flow + incidents, 60s | 1,339,200 | -1,139,200 | Impossible on free tier |
| Recovery: z9 flow + incidents, 120s | 178,560 | 21,440 | Free and config-compatible |
| Spatial priority: z10 flow, 125s; CDOT incidents | 171,418 | 28,582 | Recommended stable target |
| Temporal priority: z9 flow, 60s; CDOT incidents | 178,560 | 21,440 | Preserves one-minute cadence |
| TomTom-only split: z10 flow, 125s; z9 incidents, 15m | 183,322 | 16,678 | Free fallback without CDOT |
| Spatial-only fallback: z11 flow + incidents, 7m | about 191,314 | about 8,686 | High zoom but weak cadence |
| Adaptive: z9 flow 60s, z10 for 2 weekday peak hours; CDOT incidents | about 189,600 | about 10,400 | Strong portfolio option after stabilization |

The single-account comparisons above record the original decision. The chosen
two-account profile is z10 flow every 60 seconds with CDOT incidents: eight
requests per cycle, about 357,120 requests in a 31-day month, and about 42,880
requests of combined provider headroom.

Calculations are theoretical upper bounds based on fixed cadence. Retries, startup validation, recovery probes, manual tests, route calls, and overlapping deployments still need budget headroom.

## Route Options

### Option A: TomTom-Only Recovery At Zoom 9

Priority: immediate fallback  
Complexity: low  
Provider cost: zero  
Recommendation: deploy only as the first recovery or CDOT fallback

Configuration:

```text
flow source: TomTom vector tiles
incident source: TomTom vector tiles
zoom: 9
cadence: 120 seconds
31-day vector usage: 178,560
```

Advantages:

- Requires no new provider account.
- Current coupled flow/incident poller can support it with configuration changes.
- Keeps two-minute temporal cadence.
- Leaves 21,440 requests for probes, tests, and variance.

Risks:

- Lower zoom can reduce road-category and segment detail.
- The quality of direction, mile-marker projection, zone samples, and slowdown localization must be compared with the historical zoom-11 data.
- The existing daily budget still does not model the real monthly allowance.
- TomTom storage and derivative-use licensing remains unresolved.

### Option B: Paid TomTom Continuity

Priority: rejected by current user requirement  
Complexity: low  
Provider cost: recurring  
Recommendation: document only; do not enable

Two paid variants were calculated:

```text
unchanged z11 flow + incidents every 120s:
about 648,000 requests in 30 days
about 669,600 requests in 31 days
approximately 448,000 to 469,600 paid requests above the free allowance

split z11 flow every 120s + incidents every 15m:
about 367,200 requests in 30 days
about 379,440 requests in 31 days
approximately 167,200 to 179,440 paid requests above the free allowance
```

At the first paid vector-tile rate observed during the investigation, these were roughly $45-$47 per month unchanged or $17-$18 per month with split schedules, before tax and subject to TomTom's current currency and pricing.

Advantages:

- Lowest migration risk.
- Preserves the current zoom-11 flow path.
- Split cadence would retain two-minute flow and useful incident freshness.

Reasons rejected:

- The user explicitly does not want any provider bill.
- Enabling paid usage does not resolve the historical-storage and derivative-analytics licensing question.
- The design would remain dependent on a provider that materially changed its allowance.

Do not add billing details or enable pay-as-you-grow as an implementation shortcut.

### Option C: TomTom Flow Plus CDOT Incidents

Priority: preferred stable target  
Complexity: moderate  
Provider cost: zero, subject to confirming CDOT account terms  
Recommendation: implement

Selected two-account profile:

```text
flow source: TomTom
flow zoom: 10
flow cadence: 60 seconds
incident source: CDOT Current Incidents + Planned Events
incident cadence: 15 minutes
31-day TomTom usage: about 357,120 across two accounts
```

Stable temporal profile:

```text
flow source: TomTom
flow zoom: 9
flow cadence: 60 seconds
incident source: CDOT Current Incidents + Planned Events
incident cadence: 15 minutes
31-day TomTom usage: 178,560
```

Advantages:

- Keeps TomTom quota focused on the speed history users notice most.
- Adds authoritative Colorado incident, closure, construction, and planned-event context.
- Supports either higher spatial detail or the original one-minute cadence.
- Creates a strong portfolio narrative around multi-source normalization and quota-aware ingestion.
- Reduces dependence on one provider.

Risks:

- CDOT's exact schema and throttling rules are visible after account registration and must be tested.
- CDOT may not provide TomTom-equivalent delay seconds, line geometry, or direction for every event.
- CDOT Current Incidents and Planned Events are separate feeds.
- The Colorado Information Marketplace currently lists the feed license as unspecified. Confirm retention, public display, and attribution rights.
- Source freshness is expected to be about 15 minutes, so the dashboard must not describe incidents as two-minute data.

Official references:

- <https://manage-api.cotrip.org/>
- <https://data.colorado.gov/Transportation/CDOT-Real-Time-Data-Feed-XML-/j3ch-zsvz>
- <https://www.codot.gov/programs/intelligent-transportation-systems/assets_its/json-apis-access-urls-for-cotrip.png/view>

### Option D: TomTom Split Flow And Incident Schedules

Priority: fallback if CDOT access or terms block integration  
Complexity: moderate  
Provider cost: zero  
Recommendation: retain behind configuration

Configuration:

```text
flow: zoom 10 every 125 seconds
incidents: zoom 9 every 15 minutes
31-day vector usage: about 183,322
```

This preserves more flow detail than the config-only zoom-9 recovery while remaining below the monthly allowance. It offers less budget headroom than the CDOT hybrid and does not reduce licensing dependency.

### Option E: Adaptive TomTom Flow Plus CDOT Incidents

Priority: optimization after at least one stable month  
Complexity: medium-high  
Provider cost: zero with strict token budgeting  
Recommendation: investigate only after Option C is proven

Candidate policy:

- Poll TomTom flow at zoom 9 every 60 seconds continuously.
- Raise to zoom 10 for no more than two total weekday peak hours.
- Alternatively, trigger a short zoom-10 burst when CDOT reports an incident or zoom-9 flow detects a material speed change.
- Keep CDOT incidents at 15 minutes.
- Store `source_zoom`, requested cadence, and provider freshness with every flow observation.
- Enforce a 190,000 monthly target and 195,000 internal hard stop.

This profile keeps one-minute data flow while spending extra spatial resolution where it tells the most useful story. It can be better than the former static design, but only if analytics explicitly account for resolution changes.

### Option F: Migrate Flow And Incidents To HERE

Priority: contingency/provider exit  
Complexity: high  
Provider cost: unknown until current plan and terms are confirmed  
Recommendation: technical spike only; do not commit while zero cost is unproven

HERE Traffic API v7 can return numeric current speed, free-flow speed, jam factor, geometry, and incidents using corridor filters. It may use far fewer requests than tile polling because a request can cover a corridor.

Potential shape:

```text
2 corridors
* 2 resources (flow + incidents)
= 4 requests/cycle before route splitting
```

Unknowns:

- Whether I-25 and I-70 each fit one corridor request and response limit.
- Current free-plan traffic transaction allowance.
- Historical storage and public derivative-analytics rights.
- Whether response granularity and coverage meet the existing mile-marker and speed-zone requirements.
- Migration effort from TomTom PBF tags to HERE JSON and location referencing.

Official references:

- <https://docs.here.com/traffic-api/docs/introduction-to-here-traffic-api-v7>
- <https://docs.here.com/traffic-api/docs/filter-geospatial-here-traffic-api-v7-tutorials>

Do not benchmark HERE against TomTom data side by side until provider terms have been reviewed. TomTom's current self-service terms restrict some competitive benchmarking.

### Option G: CDOT-Only Traffic Platform

Priority: long-term open/public-data investigation  
Complexity: high and coverage-dependent  
Provider cost: expected zero, subject to terms  
Recommendation: discovery spike, not current primary plan

CDOT clearly offers Current Incidents, Planned Events, road conditions, signs, weather, destinations/travel times, work-zone data, and related feeds. A complete public numeric speed feed covering both full corridors has not yet been verified through the current JSON API portal.

Tasks for a discovery spike:

- Obtain API access.
- Inventory every available feed and field.
- Determine whether traffic speeds or detector observations cover both route geometries.
- Measure update frequency and missing-data behavior.
- Determine whether travel-time destinations can supplement I-70 analysis.
- Confirm historical retention and public-display rights.

If CDOT can supply adequate numeric speed coverage, this is the cleanest provider-cost and licensing story. Do not assume that coverage exists until measured.

### Option H: Mapbox Traffic

Priority: rejected as primary source  
Complexity: medium  
Provider cost: plan-dependent  
Recommendation: do not pursue for the analytical core

Mapbox Traffic v1 provides categorical congestion such as low, moderate, heavy, and severe and is updated approximately every eight minutes. It does not preserve the current numeric speed and free-flow analysis story.

- <https://docs.mapbox.com/data/tilesets/reference/mapbox-traffic-v1/>

Mapbox may be useful as a visual comparison layer, but it is not a suitable replacement for persisted corridor speed analytics. Raw traffic-data licensing is enterprise-oriented.

### Option I: Azure Maps

Priority: rejected  
Complexity: medium  
Provider cost: transaction-based  
Recommendation: do not begin a new flow integration

Azure Maps can expose traffic data, but Traffic v1 is scheduled for retirement on March 31, 2028. Starting a new dependency here adds migration risk and does not clearly solve the zero-cost requirement.

- <https://learn.microsoft.com/en-us/azure/advisor/advisor-how-to-use-service-upgrade-retirement-recommendations>

### Option J: Google Maps Platform

Priority: rejected  
Complexity: high for weak fit  
Provider cost: paid usage  
Recommendation: do not pursue

Google's common public APIs expose traffic-aware route estimates rather than the reusable numeric road-segment flow needed by this data model. Repeated route calls would not reproduce the existing corridor granularity economically.

### Option K: INRIX Or Enterprise Traffic Feeds

Priority: rejected under current requirements  
Complexity: high  
Provider cost: custom/enterprise  
Recommendation: revisit only if the project gains sponsorship

INRIX can provide real-time speed, free-flow speed, incidents, and historical products, but it does not align with the no-provider-cost requirement.

### Option L: Build An Independent Flow Source

Priority: research only  
Complexity: very high  
Provider cost: potentially low, operational cost high  
Recommendation: not a near-term replacement

Possible sources include public roadside detectors, connected-device probes, camera-derived speeds, and voluntary client telemetry. Each introduces coverage, privacy, accuracy, calibration, and operational concerns. OpenStreetMap supplies road geometry, not live traffic.

A camera-computer-vision or crowdsourced system could become a compelling future project, but it should supplement a stable provider before replacing one.

## Target Architecture

Avoid a broad rewrite. Add provider boundaries around the behavior already present.

Suggested interfaces or equivalent local abstractions:

```java
interface TrafficFlowProvider {
    FlowSnapshot fetch(List<TrafficProps.Corridor> corridors);
}

interface TrafficIncidentProvider {
    IncidentSnapshot fetch(List<TrafficProps.Corridor> corridors);
}
```

Suggested configuration:

```text
TRAFFIC_FLOW_PROVIDER=tomtom
TRAFFIC_FLOW_POLL_SECONDS=60
TRAFFIC_FLOW_TILE_ZOOM=10

TRAFFIC_INCIDENT_PROVIDER=cdot
TRAFFIC_INCIDENT_POLL_SECONDS=900
TRAFFIC_INCIDENT_TILE_ZOOM=9

TRAFFIC_MONTHLY_REQUEST_TARGET=190000
TRAFFIC_MONTHLY_REQUEST_HARD_STOP=195000
TRAFFIC_MONTHLY_REQUEST_ALLOWANCE=200000

CDOT_API_KEY=<server secret only>
CDOT_BASE_URL=<from subscriber portal>
```

Keep the current variables temporarily as compatibility aliases and deprecate them deliberately.

Provider snapshots should include:

- provider name
- provider product/category
- provider event or feature identifier when available
- source update time
- fetch time
- requested zoom or resolution
- requested cadence
- raw status/category
- normalized status/category
- geometry and location confidence

## Incident Persistence Decision

Do not silently count one unchanged 15-minute CDOT event as a new incident every time a two-minute flow sample is written.

Preferred model:

- Add a provider-neutral incident-event table keyed by provider plus provider event ID.
- Track `first_seen_at`, `last_seen_at`, `source_updated_at`, current status, geometry, and normalized category.
- Link or summarize active incidents into flow samples without duplicating unique incident identity.
- Keep compatibility views for current dashboard and hotspot queries.
- Distinguish:
  - unique incident threads
  - incident observations
  - active incidents at sample time

Acceptable first increment:

- Cache the latest normalized incident snapshot.
- Continue filling `traffic_sample.incidents_json` for API compatibility.
- Add stable provider IDs and aggregation keys before changing analytical counts.

## Monthly Budget Design

Replace daily assumptions with atomic monthly accounting:

- Budget key must include provider and product category.
- Period key should represent the provider's actual billing month.
- Reservations must be database-backed so overlapping processes cannot overspend.
- Reserve before issuing requests.
- Release only calls that were provably not issued.
- Count retries and probes as real calls.
- Use projected month-end burn, not only current percentage.
- Slow or lower resolution before hard-stopping.
- Expose used, remaining, projected, target, hard stop, and reset estimate through health/status endpoints.
- Alert at 70%, 85%, 95%, and hard stop.
- Keep at least 5,000 requests outside the application hard stop for manual validation and provider-side accounting differences.

Suggested migration:

- Add a new monthly budget table rather than destructively changing `traffic_provider_request_budget`.
- Preserve old rows for operational history.
- Add tests for 28-, 29-, 30-, and 31-day months and concurrent reservations.

## Scheduling And Restart Safety

The redesign must prevent restarts from creating request bursts:

- Use independent flow and incident schedules.
- Add startup jitter.
- Use a database-backed lease or scheduler lock if more than one ingest instance can run.
- Do not retry authorization or quota failures.
- Bound retries for transient failures and charge each retry to the monthly budget.
- Keep provider recovery probes sparse and budgeted.
- Ensure `docker compose up`, watchdog recovery, and service restart cannot overlap old and new ingest containers.
- Reconcile the application's request counter with the provider dashboard daily during the first month.

## Implementation Sequence

### Phase 0: Reconfirm And Protect

Before code changes:

1. Record the local and server `main` commit SHA.
2. Run `git status` locally and on the server.
3. Create a new full database dump and verify its checksum after copying it off-server.
4. Capture `docker compose ps`, ingest logs, provider status, and current environment variable names without printing secret values.
5. Confirm TomTom's reset date, allowance, current use, and whether pay-as-you-go is disabled.
6. Register for CDOT API access and capture Current Incidents and Planned Events sample responses.
7. Save sample provider payloads only as sanitized test fixtures.
8. Review TomTom and CDOT terms for retention, historical analysis, public display, attribution, and provider comparison.
9. Rotate provider keys before final deployment if any have been shared outside the server's secret environment.

Exit criteria:

- Backup verified.
- Provider limits and reset date recorded.
- No secrets in Git or documentation.
- CDOT access request submitted or completed.

### Phase 1: Configuration-Only Recovery

Purpose: resume useful ingestion after TomTom's monthly reset without waiting for the full redesign.

Candidate settings:

```text
TRAFFIC_MODE=tile
TRAFFIC_POLL_SECONDS=120
TRAFFIC_TILE_ZOOM=9
```

Set conservative daily compatibility limits while the monthly governor is not yet available. The theoretical coupled use is 5,760 vector requests/day.

Validation:

- Both corridors produce usable flow samples.
- Incident geometry still maps to the correct corridor.
- Speed sample counts, zone coverage, and mile-marker calibration remain useful.
- Provider dashboard use matches application estimates.
- Projected month-end use remains below 190,000.

Rollback:

- Stop ingest before changing profiles.
- Restore the prior environment file.
- Restart only one ingest container.
- Do not return to zoom 11 at 120 seconds under the free allowance.

### Phase 2: Split Providers And Monthly Governance

Implement:

- Separate flow and incident schedulers.
- Provider-neutral flow and incident configuration.
- New monthly request budget.
- Per-product metrics.
- Source and freshness metadata.
- Stable snapshot handoff from incident scheduler to flow persistence.
- Bounded retry and restart-safe scheduling.

Keep TomTom incidents available behind a feature flag so the system can run while CDOT integration is developed.

Exit criteria:

- TomTom flow can run without calling TomTom incidents.
- Incident failure does not halt valid flow ingestion.
- Flow failure does not erase the latest valid incident snapshot.
- Unit and integration tests cover independent schedules and monthly reservations.
- Existing dashboard/API contracts still work.

### Phase 3: CDOT Incident Adapter

Implement:

- `CdotIncidentClient`
- `CdotIncidentMapper`
- Current Incidents fetch
- Planned Events fetch
- provider ID deduplication
- event-type normalization
- road/corridor matching
- geometry filtering
- existing direction and mile-marker enrichment
- source timestamps and stale-state handling
- health and metrics

Mapping should tolerate:

- missing delay
- point-only geometry
- missing direction
- multiple roads
- event updates with the same provider ID
- cancellations or disappearance from the active feed
- construction/planned events spanning long periods

Exit criteria:

- Sanitized fixtures cover representative Current Incidents and Planned Events.
- Active incidents appear on the existing map.
- I-25 and I-70 filtering is correct.
- Incident freshness visibly reflects CDOT's update time.
- No duplicate incident threads are introduced by the faster flow cadence.
- Attribution is displayed where required.

### Phase 4: Validate The Chosen Flow Profile

The initial comparison considered:

1. zoom 10 at 125 seconds
2. zoom 9 at 60 seconds

Compare:

- valid cycle rate
- speed sample count
- mile-marker and zone coverage
- direction coverage
- p10/p50/p90 stability
- localized slowdown detection
- payload size and service CPU
- projected monthly requests
- public dashboard usefulness

The production choice is zoom 10 at 60 seconds now that two independent
allowances are available. Validate its valid-cycle rate, quota projection, and
history continuity during the soak; do not lower the cadence based only on
unused allowance.

#### Optional two-account extension

The service now supports a dormant secondary TomTom account with independent
per-product monthly counters. `TOMTOM_SECONDARY_ENABLED` remains false until
the older account's dashboard confirms its allowance has reset.

When both accounts are enabled and healthy, the per-account
190,000/195,000/200,000 settings yield combined
380,000/390,000/400,000 limits. Tile cycles stay on one account. Selection is
fixed primary-first, and secondary begins only after primary reaches its hard
stop or is quarantined. Account-specific authorization or credit failures do
not stop a healthy peer.

The committed cadence is zoom 10 every 60 seconds. At the current eight-tile
footprint it projects to 357,120 requests in a 31-day month. See
`docs/tomtom-two-account-operations.md` for the rollout and rollback procedure.

### Phase 5: Adaptive Resolution

Only after one stable month:

- Add a monthly token bucket for higher-resolution bursts.
- Start with a fixed maximum of two total weekday peak hours at zoom 10 and zoom 9 otherwise, all at 60 seconds.
- Later consider CDOT-event or slowdown-triggered bursts.
- Persist resolution metadata and prevent mixed-resolution analytics from presenting artificial trend changes.
- Automatically return to the baseline profile before the monthly target is endangered.

Exit criteria:

- Worst-case simulation remains below 190,000.
- Resolution changes are visible in observability and stored metadata.
- Dashboard trends do not jump merely because zoom changed.

### Phase 6: Provider Exit Spikes

Run only if TomTom licensing, reliability, or future limits make the hybrid untenable:

1. CDOT full-flow discovery
2. HERE corridor API feasibility
3. independent/public sensor research

Each spike must produce:

- sample payload
- corridor coverage result
- free allowance and projected use
- retention/display license result
- normalized field mapping
- migration effort estimate
- explicit go/no-go recommendation

## Testing Plan

Minimum automated coverage:

- Monthly budget rollover for every month length.
- Concurrent reservations cannot cross the hard stop.
- Retries and recovery probes are counted.
- Flow scheduler never invokes incident provider.
- Incident scheduler never invokes flow provider.
- One provider can fail without incorrectly halting the other.
- CDOT field mapping for each available event type.
- CDOT point and line geometry.
- Corridor filtering and off-corridor rejection.
- Direction and mile-marker enrichment.
- Provider ID deduplication and update handling.
- Stale CDOT snapshot behavior.
- Existing traffic sample and dashboard API compatibility.
- Adaptive profile worst-case request simulation.

Repository verification:

```bash
./mvnw verify
docker compose --env-file .env.example config
APP_ENV_FILE=.env.example docker compose --env-file .env.example build
```

Use local provider stubs or sanitized fixtures for deterministic tests. Live tests must be explicitly enabled and budgeted.

## Acceptance Criteria

The implementation is done when:

- No paid provider plan is enabled.
- Projected TomTom vector use is at or below 190,000 in a 31-day month.
- The application hard-stops before 200,000 even with overlapping schedulers.
- Flow is normally sampled every 60 to 150 seconds.
- Both corridors remain populated and direction-aware.
- CDOT incidents and planned events refresh independently at their real freshness.
- Incident threads are deduplicated across flow samples.
- Dashboard source and freshness language is accurate.
- Provider failures are isolated and recover automatically when appropriate.
- Restarting containers does not create a request burst.
- Tests pass.
- Server deployment is backed up and rollback-ready.
- README, cloud deployment docs, `.env` examples, changelog, and relevant wiki pages match the delivered behavior.

## Branch And Commit Sequence

Suggested branches:

1. `topic/monthly-provider-budget`
2. `topic/split-traffic-providers`
3. `topic/cdot-incident-ingest`
4. `topic/adaptive-flow-resolution`

Suggested commit progression:

- `docs(traffic): record zero-cost provider continuity plan`
- `feat(ingest): add monthly provider request accounting`
- `test(ingest): cover monthly quota rollover and concurrency`
- `refactor(ingest): separate flow and incident schedules`
- `feat(ingest): add provider source and freshness metadata`
- `feat(ingest): normalize CDOT incidents and planned events`
- `test(ingest): cover CDOT mapping and incident identity`
- `feat(ingest): add quota-aware adaptive flow resolution`
- `docs(ops): document free-tier traffic profiles`

Keep commits reviewable. Do not combine provider abstraction, schema migration, CDOT mapping, adaptive scheduling, and dashboard copy into one commit.

## Server Deployment And Rollback

After a branch is merged:

1. Verify the server backup and available disk space.
2. Pull the exact merged commit.
3. Update `.env.cloud` manually with new variable names and secret values.
4. Run Compose config validation before rebuilding.
5. Stop or scale down the old ingest service before starting the new scheduler.
6. Apply migrations through the normal application startup.
7. Start one ingest instance.
8. Watch logs, health, database inserts, application budget, and provider dashboard usage.
9. Confirm the public dashboard on desktop and mobile.
10. Keep the previous image/commit and environment backup available for rollback.

Never use a destructive database reset as a deployment step.

## Licensing Gate

This gate must not be skipped.

TomTom's current self-service terms appear to restrict caching/storing API results, derivative products, and some competitive benchmarking. This repository stores historical derived corridor speeds and exposes public analytics. Paying for overage would not itself resolve that issue.

- <https://developer.tomtom.com/terms-and-conditions>

Obtain written clarification on:

- retaining derived corridor speed samples
- publishing historical aggregates
- displaying public trend analytics
- combining TomTom flow with CDOT incidents
- evaluating an alternative provider

CDOT's catalog currently reports an unspecified dataset license. Confirm:

- API access cost
- call limits
- retention
- redistribution/public display
- required attribution

If either provider disallows the intended historical/public use, do not conceal the issue in implementation. Escalate it as a provider-selection blocker.

## Hosting-Cost Follow-Up

Do not mix an infrastructure migration into the provider recovery.

After at least seven stable days:

1. Capture CPU, memory, disk, database size, network, and container utilization.
2. Determine whether the Hetzner VPS can be downsized without reducing database safety.
3. Keep TimescaleDB memory, backup space, and build headroom in the calculation.
4. Compare the actual monthly VPS price with any lower tier.

A free-hosting rewrite would likely require replacing continuously running Java services and TimescaleDB with serverless jobs, external database services, and a different scheduler. GitHub Actions and sleeping free web services are not appropriate for reliable one-minute ingestion. Treat free hosting as a separate architecture project, not a quick deployment switch.

## Inputs Needed From The User

The next agent may proceed locally without secrets, but live CDOT completion requires:

- a CDOT COtrip developer account
- API access for Current Incidents and Planned Events
- the API key placed in local/server environment files, never in chat-visible docs or Git
- confirmation of any terms shown during registration
- confirmation before any future cadence below 60 seconds or paid provider
  change

## Final Decision Tree

```text
Need immediate free recovery?
  -> Run TomTom z9 flow + incidents every 120s after allowance reset.

CDOT access and terms approved and two TomTom accounts available?
  -> Run TomTom z10 flow every 60s, primary then secondary, plus CDOT incidents/planned events.

CDOT blocked?
  -> Use TomTom z10 flow at 125s + z9 incidents at 15m.

Stable for one month with budget headroom?
  -> Reassess actual tile footprint and request usage before any cadence change.

TomTom historical/public-use rights denied or future free limits fail?
  -> Run CDOT-only and HERE exit spikes before replacing the provider.
```

## Investigation Story Record

This section preserves the human and technical story behind the incident for a future README, wiki entry, or project retrospective. It is intentionally more narrative than the implementation plan.

### Story Status

Be precise about what has and has not been resolved:

- The root cause of the TomTom ingestion halt has been identified.
- The account exhausted newly understood monthly product allowances.
- The API key itself was not established as the root cause.
- The durable zero-cost redesign in this document has not yet been implemented.
- A future README should not claim the production issue is fully resolved until the selected profile has run successfully through a meaningful observation period, ideally a complete provider billing month.

### Starting Symptom

The public dashboard began alternating between working and a blocking system warning:

```text
Traffic ingestion has been halted.
Ingestion halted because TomTom rejected the configured API key while polling live data.
Code: AUTH_FORBIDDEN
```

The warning sometimes disappeared after a period and later returned. That intermittent behavior initially made the problem look like one of several possibilities:

- a bad or expired API key
- a transient TomTom outage
- an account entitlement problem
- a new Orbis product-access requirement
- a server/container restart loop
- an accidental request burst
- leaked credentials or an unknown consumer
- a bug in full-corridor tile construction
- an internal provider-guard or retry problem

The application correctly stopped wasteful polling after repeated authorization-style failures, but the provider response did not initially distinguish a malformed key from an exhausted allowance in a way that made the root cause obvious.

### Investigation Effort

The diagnosis was not a single lookup. It required following the problem through the full system:

- The production dashboard warning and freshness metadata were examined.
- Hetzner became the only active runtime so local duplicate ingestion could be ruled out operationally.
- Server container state, restart behavior, logs, health, and provider-guard transitions were considered.
- Full database dumps were created and copied from the server so the running pattern could be studied without relying only on the current dashboard state.
- Historical polling behavior over roughly two weeks was reviewed.
- The observed 120-second cloud cadence was compared with the earlier intended 60-second cadence.
- The repository's route geometry and tile-selection code were inspected.
- Unique tile coverage was calculated at zoom levels 7 through 12.
- Flow and incident endpoint calls were counted independently.
- TomTom dashboard analytics were exported and reviewed.
- The original API key and a newly created API key were tested.
- Product entitlements and the appearance of private Orbis products were investigated.
- The absence of billing history on a freemium account was considered.
- Current TomTom pricing, product documentation, migration guidance, and possible Orbis v2 changes were searched.
- Alternative explanations such as public key exposure, another computer polling, and a general TomTom outage were tested against the available evidence.
- Alternative providers and public Colorado feeds were researched after the quota diagnosis became clear.

This matters to the eventual story: the failure crossed application code, cloud operations, third-party account policy, request accounting, data analysis, and product design. It was not solved by simply replacing a key.

### Important Checks And What They Showed

#### API key rotation

A second TomTom key behaved like the original key. That weakened the hypothesis that one key was malformed, revoked, or uniquely restricted.

The keys themselves must never appear in the README, this document, commits, logs, screenshots, or fixtures.

#### Public exposure

The user stated that the key had not been publicly exposed. Repository and deployment handling were considered, and there was no evidence that an unknown external consumer explained the complete usage pattern.

Credential rotation remains prudent security hygiene, but exposure was not needed to explain the request volume.

#### TomTom account and products

The account showed freemium access and a list of both open and private products. Private products could not simply be deselected, and their presence was initially suspicious. Testing and later quota evidence did not support private-product selection as the primary failure.

There was no balance history because the account had not been funded. That was consistent with a free account reaching a hard allowance rather than silently accumulating overage charges.

#### Orbis migration

The investigation checked whether TomTom had switched traffic access to Orbis v2 or changed product entitlement requirements. TomTom recommends Orbis for new integrations, and a future migration remains relevant, but no endpoint migration was needed to explain why the existing requests stopped at the observed time.

#### TomTom service health

The working and failing patterns did not establish a general TomTom outage. TomTom's own account analytics ultimately supplied a stronger account-specific explanation.

#### Server restarts

Restart and recovery attempts may have consumed extra requests. They were a reasonable early suspect because repeated startup validation, probes, retries, or overlapping containers can amplify provider usage.

However, the final request math proved that restarts were not required to hit the limit. The normal zoom-11 design at 120 seconds was already more than three times the monthly free allowance.

This is an important nuance for the future story: restart safety still deserves improvement, but it was an amplifier risk rather than the fundamental root cause.

#### Point mode

Point mode was evaluated as a possible escape from tile limits. Its separate flow-segment and incident-detail allowances were also too small for the previous sampling pattern, so changing modes would have moved the failure rather than solved it.

#### Full-corridor tiling

The full-corridor tile path initially looked suspicious because individual requests could work while the complete corridor failed. Counting the route tiles showed why:

- I-25 used 8 zoom-11 tiles.
- I-70 used 7 zoom-11 tiles.
- The union contained 15 tiles.
- Each cycle fetched both flow and incidents.
- Every cycle therefore issued 30 vector-tile requests.

The corridor implementation was doing what it had been designed to do; the provider allowance changed the economics of that design.

### Decisive Evidence

The TomTom usage export and dashboard showed:

- Traffic Flow and Incidents Vector Tiles: 200,000 of 200,000
- Traffic Incident Details: 2,500 of 2,500

The repository math independently matched an allowance-exhaustion explanation:

```text
zoom 11 at 120 seconds:
30 calls/cycle * 720 cycles/day = 21,600 calls/day
200,000 / 21,600 = about 9.26 days to exhaust the allowance

zoom 11 at 60 seconds:
30 calls/cycle * 1,440 cycles/day = 43,200 calls/day
200,000 / 43,200 = about 4.63 days to exhaust the allowance
```

This explained why the service could run normally after a reset or renewed availability and then fail again later. It also aligned with the multi-day production pattern better than a permanently invalid key would have.

### Confirmed Root Cause

The repository was designed around a much more permissive understanding of TomTom usage. The current account instead enforced monthly product allowances, including a shared 200,000-request bucket for flow and incident vector tiles.

Three design assumptions combined:

1. Flow and incidents were fetched together.
2. Every route tile was fetched during every cycle.
3. The internal quota governor reset daily while the provider allowance reset monthly.

The result was predictable exhaustion even when the server, containers, database, network, and API key were otherwise healthy.

### What Was Ruled Out Or Demoted

Do not present these as foolish guesses. Each was a reasonable hypothesis that was tested:

- DNS and public-domain routing did not cause provider authorization failures.
- Hetzner firewall state did not explain TomTom account usage.
- TimescaleDB restore-version issues were unrelated to provider access.
- A newly generated key did not restore the exhausted product allowance.
- Key leakage was not required to explain request volume.
- Private Orbis product labels were not established as the cause.
- A general TomTom outage did not fit the account-specific usage evidence.
- Restart attempts may have added calls but could not make the baseline design fit the allowance.
- Point mode could not preserve the desired granularity within its smaller free buckets.

### Engineering Lessons

These are strong portfolio-level lessons worth carrying into future writing:

- Third-party policy is part of system behavior even when application code does not change.
- A `403` or authorization label can represent exhausted entitlement, not only a bad credential.
- Creating another key does not necessarily create another allowance.
- Provider quotas must be modeled using the provider's real billing period and product categories.
- Daily internal limits cannot reliably protect a monthly external allowance.
- Endpoint coupling can double request use without adding equal product value.
- Flow and incidents have different freshness needs and should not share one schedule.
- Retries, health probes, startup validation, and overlapping deployments must all consume the same internal request budget.
- Request estimates should be calculated from actual route coverage, not guessed from poll interval alone.
- Provider dashboard analytics should be reconciled with application-side counters.
- A graceful halt protected the account, but observability should distinguish invalid credentials, depleted quota, throttling, and provider outage.
- Historical-data and derivative-use licensing must be investigated alongside technical feasibility.
- A cost constraint can lead to a better architecture: provider separation, authoritative CDOT incidents, adaptive sampling, and explicit freshness.

### Portfolio Story Indicators

A future README or project-journey page can use these indicators to show the scale and quality of the work:

- The issue appeared only after moving from local experimentation to a continuously running public cloud deployment.
- The investigation covered frontend warning behavior, Spring scheduling, container operations, provider health, account analytics, tile geometry, quota mathematics, and data licensing.
- Production data was backed up and analyzed rather than discarded during troubleshooting.
- Multiple hypotheses were tested before a root cause was declared.
- A replacement key was used as a controlled diagnostic, not assumed to be a fix.
- Request volume was reconstructed from source code and route geometry, then checked against provider analytics.
- The investigation converted an intermittent operational failure into a reproducible numerical model.
- The proposed resolution does more than lower a timer: it separates providers and data lifecycles according to their value.
- The zero-cost design preserves either one-minute temporal cadence or stronger spatial resolution, with an adaptive path that can preserve both at the moments that matter most.
- CDOT integration would add authoritative local context and make the project's Colorado focus more substantive.
- The incident led to stronger requirements for restart safety, monthly quota governance, source transparency, and licensing review.

### Suggested Future README Arc

Write the future story in first person and in the voice of a recent graduate building and operating a serious portfolio project:

1. **What I built**
   - A continuously running Colorado corridor-analysis platform over I-25 and I-70.
2. **What changed**
   - A provider allowance that had been understood as permissive became a much smaller monthly product limit.
3. **What users saw**
   - Intermittent stale-data warnings and an authorization-style ingestion halt.
4. **How I investigated**
   - Server logs, backups, provider analytics, fresh keys, product access, documentation, route tile counts, and source-code request reconstruction.
5. **What the evidence showed**
   - The normal 15-tile, two-endpoint polling design could consume 21,600 requests per day at a two-minute cadence.
6. **What I learned**
   - External policy belongs in architecture, observability, and testable capacity planning.
7. **How I redesigned it**
   - Independent flow and incident schedules, monthly quota accounting, CDOT incident enrichment, and resolution-aware sampling.
8. **Why the result is better**
   - Lower dependency, no provider bill, accurate source freshness, and a more intentional data pipeline.

Keep the tone human:

- Do not frame TomTom as malicious or claim an undocumented outage.
- Do not pretend the cause was obvious in hindsight.
- Explain why each major hypothesis was reasonable.
- Show the arithmetic without burying the reader in every command.
- Emphasize operating and learning from a real public system.
- Distinguish confirmed facts from working hypotheses.
- Credit official provider and CDOT documentation.

### Claims To Avoid Until Implementation Is Proven

Do not write these claims yet:

- "The issue is fully resolved."
- "CDOT incidents are already live."
- "The system now runs at one-minute cadence."
- "The new design cannot exceed quota."
- "TomTom changed the limit on a specific date" unless an official dated notice is found.
- "TomTom caused an outage."
- "The data is first-party."
- "Historical storage is licensed" until written terms are confirmed.

Safe current wording:

> I traced the ingestion halt to exhausted monthly API allowances, reconstructed the request pattern that caused it, and designed a zero-provider-cost path that separates high-frequency flow from slower authoritative incident updates. Implementation and a full-month production validation are the remaining steps.

### Artifacts Worth Preserving

Retain or create sanitized versions of:

- the dashboard warning screenshot
- TomTom's monthly-usage screenshot
- the exported `analytics.csv`
- a request-count table by zoom and cadence
- provider-guard logs with keys and account identifiers removed
- a graph showing successful samples followed by allowance exhaustion
- before-and-after architecture diagrams
- a full-month application-counter versus provider-dashboard reconciliation
- CDOT sample incident and planned-event payloads with sensitive access data removed

Do not commit raw account exports until they have been reviewed for keys, account IDs, billing details, or other private metadata.

## Definition Of Success

The strongest outcome is not merely "requests work again." It is a public traffic-analysis system that:

- continuously collects useful corridor flow without provider charges
- spends a fixed free allowance deliberately
- uses authoritative Colorado incident context
- remains transparent about source and freshness
- survives restarts and provider failures without request bursts
- preserves historical and geographic analytical value
- tells a stronger portfolio story than the original single-provider poller
