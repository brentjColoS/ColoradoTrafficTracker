# Runbook (Wiki)

Canonical document: [../OPERATIONS_RUNBOOK.md](../OPERATIONS_RUNBOOK.md)

## Fast checks

```bash
curl "http://localhost:8081/routes/corridors"
curl "http://localhost:8080/api/traffic/health"
curl "http://localhost:8080/api/traffic/latest?corridor=I25"
```

## Core troubleshooting

- No data in API: validate ingest logs + TOMTOM key.
- 404 on latest: corridor might not have samples yet.
- High request pressure: lower tile zoom or switch to point mode.
