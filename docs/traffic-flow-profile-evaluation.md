# Traffic Flow Profile Evaluation

This is the working record for choosing between the two zero-cost TomTom flow profiles:

- zoom 10 every 125 seconds
- zoom 9 every 60 seconds

The live comparison is intentionally separate from the normal test suite. It runs one flow-only cycle for each profile, uses the checked-in I-25 and I-70 geometry, and stops locally before exceeding its explicit request ceiling.

## Running A Bounded Comparison

The live test is skipped unless `TOMTOM_LIVE_PROFILE_TEST=true`. The default ceiling is 20 requests.

```bash
TOMTOM_LIVE_PROFILE_TEST=true \
TOMTOM_LIVE_PROFILE_MAX_REQUESTS=20 \
TOMTOM_API_KEY="$(awk -F= '$1=="TOMTOM_API_KEY" {sub(/^[^=]*=/, ""); print; exit}' .env)" \
./mvnw -q -pl ingest-service -am \
  -Djacoco.skip=true \
  -Dtest=TrafficFlowProfileLiveTest \
  -Dsurefire.failIfNoSpecifiedTests=false \
  test
```

Do not add the live-test flag to CI or routine `verify` commands. Check provider usage before and after each run, and include manual probes when reconciling the application counter with TomTom.

## Initial Paired Probe

Run date: July 28, 2026

| Profile | Requests per cycle | 31-day projection | I-25 samples/zones | I-70 samples/zones |
|---|---:|---:|---:|---:|
| z10 every 125s | 8 | 171,418 | 123 / 3 | 105 / 6 |
| z9 every 60s | 4 | 178,560 | 123 / 3 | 105 / 6 |

Both profiles returned usable data for both corridors. The first pair also produced similar p10, p50, and p90 speeds, although the I-25 p10 differed slightly between resolutions.

This is only a baseline. It shows that lower zoom did not reduce the application-level sample or speed-zone count in that cycle, but it does not establish valid-cycle rate, percentile stability, localized-slowdown quality, or behavior during an incident. Repeat the comparison across different traffic conditions before changing the default.

Manual provider usage for this first session was 13 vector requests: one authorization probe plus the 12-request paired comparison.
