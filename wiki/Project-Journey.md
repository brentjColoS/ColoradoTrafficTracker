![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

I snowboard at Keystone and live in Fort Collins. Leaving the mountain often
meant choosing between a few more runs and a long evening on I-70. I wanted to
look back at several afternoons and see whether leaving earlier usually helped.

The [Why page](https://coloradotraffictracker.net/dashboard/why.html) expands on
that question.

## Saving the readings

Comparing weekends required saved readings from each day. Collection became
a scheduled service, with a database to preserve the readings and a
separate API for the dashboard.

As the record grew, I added queryable archives so older readings and detailed
speed-zone history stayed available. The
[coverage notes](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/data-history-coverage.md)
record where each dataset begins and which earlier details cannot be recovered.

## Working within provider limits

Continuous operation made the provider's monthly allowance part of the design.

I separated TomTom flow from CDOT roadway reports and added persistent request
accounting. Each TomTom account now has its own allowance, with full-batch
reservations and primary-first rollover.

A failed request can mean a network problem, an exhausted allowance or a
condition needing operator attention. The provider guard records a reason and
controls recovery so those cases can be handled differently.

The [account manager](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TomTomAccountQuotaManager.java)
and [provider guard](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TrafficProviderGuardService.java)
show those decisions in code.

## Keeping the site running

Hosting the project added release checks, monitoring and recovery. A page could
load correctly while its data was stale, so verification expanded to source
timestamps, service readiness, provider status and historical continuity.

Java tests were joined by browser and packaged-runtime checks. Off-site backups
and disposable restores added a way to verify recovery of the retained data.

## The question I still want to answer

The next comparison needs a longer winter record. I want to compare snowy
weekends with clear ones, find recurring slowdowns and see how staying for
another run changes the drive home.

See [Architecture](Architecture) for the implementation and
[What's next](Roadmap) for the planned comparisons.

[← Wiki home](Home) · [About me →](About-Me)
