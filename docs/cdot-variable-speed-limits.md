# CDOT variable speed limits on I-70

The map supplements traffic observations with the 42 reviewed CDOT sign devices
on I-70 MM 206–274. It does not change traffic calculations, baselines or zone
boundaries. Collection remains the production six-hour per-device staggered
schedule described in [the ingestion runbook](i70-sign-ingestion.md). Browser
interactions read the database only; there are no per-visitor provider calls.

Only available, numeric readings different from the configured regular reference
create current map badges. Eastbound chips use `E→`, westbound chips `←W`, with
stems to sign locations. Nearby chips group into collision-checked areas;
zooming, panning and resizing are local operations. Area popups retain directional
values and source/read times. Gaps between sign points are not verified continuous
restriction boundaries. Configured reference labels remain independent of sign
availability and are not live readings.

Successful reads older than one hour remain explicitly unconfirmed. A collapsed
Last-reported limits disclosure preserves their values and actual read times;
they never establish current changes or mapped restrictions. Communication errors,
blank signs and failed reads remain unavailable. Historical chart views hide
current sign context. This feature stores current sign state, not sign history.
Source sign-state update time and last successful read time are different facts.

The regular reference is not a CDOT per-sign clear-weather maximum. The reviewed
westbound devices `OpenTMS-Sign465279` at MM237 and `OpenTMS-Sign465294` at
MM237.05 use 65mph rather than the combined-direction 60mph segment reference.
[CDOT OTIS inventory](https://dtdapps.codot.gov/otis/API/TRANSYS/SpeedLimit/070A/236.9/237.1.json)
was checked October 19, 2026: MM236.918–237.087 lists primary 60 and secondary
65mph. CDOT's direction coding identifies secondary as southbound/westbound.
The exception is scoped to identity, direction and location; it does not rewrite
source data or infer a new regular limit from an unchanged reading. A future
60mph report there still represents a difference.

The saved-sign demo exporter remains available for isolated fixtures. It checks
the catalog, strips private fields, disables replay and refuses to overwrite
existing exports. Normal dashboard hosting does not load that adapter. Optional
readers retain disabled Flyway, read-only access and no provider credentials;
see [reader operations](dashboard-sidecar-operations.md).
