# Codex Handoff: Dual-Corridor Dashboard

## Repository State

Local integration follow-up: see [dashboard build readiness](docs/dashboard-build-readiness.md)
for the assessment, corrected data contracts, verification results, and the
explicit container-start approval gate. This supersedes the original validation
and startup guidance below where they differ.

- Repository: `https://github.com/brentjColoS/ColoradoTrafficTracker.git`
- Working branch: `codex/historical-live-replay` (based on `codex/dual-corridor-dashboard`)
- Dashboard commit at handoff start: `1de3822`
- Primary implementation: `api-service/src/main/resources/static/dashboard/`

The branch is published and tracks `origin/codex/dual-corridor-dashboard`. The redesign was developed in an isolated Git worktree so unrelated changes in the original checkout were not modified.

## Product Direction

The primary dashboard is a light-mode-first, desktop-focused parallel view of the I-25 Front Range and I-70 Mountain corridors. It must let a first-time visitor compare both corridors at a glance without becoming map-first or falling back to a generic card-grid layout.

Preserve these decisions:

- Use the Black Forest, Goldenrod, Burnt Rose, Ivory, and Almond Silk palette.
- Keep the dark green top navigation with Dashboard, System, About the Data, API, GitHub, and the theme toggle.
- Show both I-25 and I-70 on the primary dashboard.
- Keep a corridor focus selector, but do not add direction selection to the primary dashboard.
- Direction selection is acceptable later on an individual corridor page.
- Retain average speed, average delay, active incidents, and worst segment for each route.
- Retain the large speed-versus-seven-day-baseline visualization and incident flags.
- Retain the centered incident-type key and separate recent-incident sections for each route.
- Every incident should show First Seen At and Last Seen At; recent activity may be labeled Ongoing.
- Retain System Health, Data Pipeline, and Under the Hood sections without emphasizing negative operational details.
- Do not reintroduce data-quality, confidence, freshness, or API-latency hero cards.
- Do not add a prose-heavy corridor briefing or a large primary-dashboard road sign.

## Implemented Dashboard

- `index.html` contains the complete semantic page structure.
- `dashboard.css` contains the responsive visual system, light and dark themes, corridor focus states, and accessible focus styling.
- `dashboard.js` loads existing dashboard APIs, derives route metrics, aggregates incident threads, renders tables, and draws both canvas charts.
- `interstate-25.svg` and `interstate-70.svg` provide compact route shields for the corridor summaries.
- `?demo=1` enables deterministic-looking sample data for design review without running the backend.
- `?historical=1` uses the last stored corridor poll as the read-only chart and
  speed-zone anchor. It is explicitly labeled historical, does not auto-refresh,
  and falls back to retained snapshot incident payloads when event history is
  unavailable.
- `?replay=1` runs a read-only, auto-refreshing virtual clock over a retained
  incident-heavy period. The default five-hour loop is May 29, 2026 from 20:00
  UTC to May 30 at 01:00 UTC at 30× speed (30 historical minutes per real
  minute). This interval has continuous preceding-week coverage for the 2H,
  24H, and 7D charts. It never starts ingestion and never
  contacts TomTom or CDOT. `replayStart`, `replayEnd`, and `replayRate` query
  parameters provide bounded test overrides.

The live dashboard reads:

- `/dashboard-api/traffic/summary`
- `/dashboard-api/traffic/analytics/trends`
- `/dashboard-api/traffic/map/incidents/recent` (active and ended events, up to 30 days)
- `/dashboard-api/traffic/zones/history`
- `/dashboard-api/traffic/map/corridors`
- `/dashboard-api/system/operational-status`
- `/actuator/health`

## Accessibility Decisions

- Current and baseline chart series differ by stroke pattern as well as color.
- Incident categories use symbols and text labels, not color alone.
- Tables use semantic headers and written Ongoing status pills.
- Controls expose labels, focus rings, selected states, and pressed states.
- A darker Goldenrod-derived token is used for small chart strokes and icons on Ivory because the original Goldenrod lacks sufficient non-text contrast there. The original Goldenrod remains in high-contrast header and accent contexts.

## Validation Completed

- JavaScript syntax check passed.
- `git diff --check` passed.
- Browser console showed no errors or warnings in demo mode.
- Corridor focus, time-range controls, and light/dark theme switching were exercised in-browser.
- The dashboard was visually checked at a 1718 x 916 desktop viewport with the Under the Hood section visible without scrolling.
- Focused project tests passed with:

```powershell
.\mvnw.cmd -q -pl api-service -am test "-Dmaven.compiler.release=17" "-Djava.version=17" "-Dmaven.repo.local=.m2/repository"
```

## Local Setup

```bash
git clone --branch codex/dual-corridor-dashboard --single-branch https://github.com/brentjColoS/ColoradoTrafficTracker.git
cd ColoradoTrafficTracker
cp .env.example .env
docker compose up --build
```

For provider-free local replay, start only `db` and `api-service`:

```bash
docker compose up --build -d db api-service
```

That ingestion-off stack was built and smoke-tested against the retained local
volume. It serves `http://localhost:8080/dashboard/?historical=1`; `ingest-service`
and `routes-service` remain stopped and no TomTom calls are made. An unscoped
Compose startup would also start ingestion and should remain an explicit choice. HTTPS requires
the separately configured optional proxy profile; see the README. Do not
downgrade this branch to Java 17: the current build targets Java 21.

## Recommended Next Iteration

1. Run the full stack and verify the live payloads against both route summaries and incident tables.
2. Review chart labels with unusually long provider incident descriptions and dense 7-day or 30-day data.
3. Add targeted static-resource or browser regression coverage for the dual-corridor structure if the project adopts frontend test tooling.
4. Gather user feedback before changing the established desktop information hierarchy.
5. Keep mobile support functional, but prioritize desktop density and side-by-side comparison.

## Guardrails for the Next Agent

- Do not overwrite or clean unrelated working-tree changes in another checkout.
- Do not redesign the page from scratch without user feedback; iterate from the current branch.
- Do not convert the primary page into a map-first, split-panel, or direction-specific dashboard.
- Keep the route-specific incident links and the Under the Hood strip visible.
- Re-run the focused API-service tests and browser checks after material changes.
