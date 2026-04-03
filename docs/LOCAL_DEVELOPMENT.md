# Local Development

## Prerequisites

- Java 21
- Maven Wrapper (`mvnw` included in repo)
- Docker + Docker Compose
- Optional: `curl` for endpoint checks

## 1. Clone and configure

```bash
git clone <your-fork-or-repo-url>
cd ColoradoTrafficTracker
cp .env.example .env
```

Set a valid TomTom key in `.env`:

```env
TOMTOM_API_KEY=your_real_key_here
```

## 2. Build all modules

```bash
./mvnw clean verify
```

Windows PowerShell:

```powershell
.\mvnw.cmd clean verify
```

## 3. Run with Docker Compose

```bash
docker compose up --build
```

This launches:
- `db` (Timescale/Postgres)
- `routes-service` on `8081`
- `ingest-service` on `8082`
- `api-service` on `8080`

## 4. Verify service readiness

```bash
curl "http://localhost:8081/routes/corridors"
curl "http://localhost:8080/api/traffic/health"
```

After at least one poll interval:

```bash
curl "http://localhost:8080/api/traffic/latest?corridor=I25"
```

## 5. Run services individually (without Compose)

### Start database container only

```bash
docker compose up db -d
```

### Run services in separate terminals

```bash
./mvnw -pl routes-service spring-boot:run
./mvnw -pl ingest-service spring-boot:run
./mvnw -pl api-service spring-boot:run
```

Ensure datasource and `ROUTES_BASE_URL` values point to reachable services.

## Environment variables

Common settings:

- `TOMTOM_API_KEY`: required for ingest.
- `TRAFFIC_MODE`: `point` or `tile`.
- `TRAFFIC_TILE_ZOOM`: tile mode zoom.
- `TRAFFIC_TILE_CONCURRENCY`: tile HTTP concurrency.
- `TRAFFIC_TILE_ROUTE_BUFFER_METERS`: route proximity filter.
- `SPRING_DATASOURCE_URL`: JDBC URL.
- `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD`.

See `.env.example` for defaults.

## Testing

Run all tests:

```bash
./mvnw test
```

Run one module:

```bash
./mvnw -pl ingest-service test
```

## IDE notes

- Open the repository root as a Maven multi-module project.
- Use Java 21 SDK in IDE settings.
- Enable annotation processing if your IDE requires it for Spring metadata support.
