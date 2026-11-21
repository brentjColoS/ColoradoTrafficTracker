![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

I snowboard at Keystone and live in Fort Collins. Leaving the mountain often
meant choosing between a few more runs and a long evening on I-70. I wanted to
look back at several afternoons and see whether leaving earlier usually helped.

The [Why page](https://coloradotraffictracker.net/dashboard/why.html) tells that
part of the story. This page follows the engineering work it led to.

## Saving the readings

A current traffic map helped with the drive in front of me. Comparing last
Sunday with the Sunday before required observations I had already saved.
Collection became a service of its own, with a database behind it and a separate
API for the dashboard. The collector keeps running when the page is closed.

As the dataset grew, I moved older corridor rows into archive tables while
keeping the same historical read surface. Detailed speed-zone history also
needed to survive its parent sample being archived. The
[coverage reference](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/data-history-coverage.md)
records where each dataset begins and which earlier details cannot be recovered.

## Making the request budget part of the design

Continuous operation made the traffic provider's allowance a practical
constraint. A schedule that looked modest over an afternoon could consume a
monthly allowance much faster than expected.

I separated TomTom flow collection from CDOT roadway reports and added durable
request accounting. Each TomTom account has its own allowance. The collector
reserves a complete tile batch before sending it, uses the primary account
first, and rolls to the secondary when the next batch will not fit.

That work changed how I think about failure. A request failure can mean a
temporary network problem, a provider-side limit or a condition requiring my
attention. The guard records a reason and controls recovery instead of treating
every failure as a reason to restart the application.

The [account manager](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TomTomAccountQuotaManager.java)
and [provider guard](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TrafficProviderGuardService.java)
show those decisions in code.

## Taking responsibility for the running site

Hosting the project brought release checks, monitoring and recovery into the
work. A page could load correctly while the collector had missed hours of
traffic. I began checking successful observation times, along with service
readiness, provider state and historical continuity.

The verification grew with the product: Java tests for data behavior, browser
tests for history and maps, and packaged-runtime checks for the API the browser
actually receives. I also added off-site database backups and disposable restore
checks so keeping the history meant more than keeping a container running.

## The question I still want to answer

With a full winter in the archive, I want to compare the drive home on snowy
weekends with clear ones. Do slowdowns form in the same places, and how often
does staying for another run put us into the busiest part of the afternoon?

[Architecture →](Architecture)
