![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

Colorado Traffic Tracker grew out of my drive between Fort Collins and Keystone.
It saves traffic observations along I-25 and I-70 so I can compare a slow
afternoon with the days around it. I built and maintain the collector, database,
API, dashboard and deployment.

**[Open the dashboard](https://coloradotraffictracker.net/dashboard/)** to try a
time window you recognize. The [Why page](https://coloradotraffictracker.net/dashboard/why.html)
has the story behind the project.

## Read about the work

| Page | What it explains |
| --- | --- |
| [Project journey](Project-Journey) | How a traffic question became a continuously running application, and the decisions that changed its direction. |
| [Architecture](Architecture) | Where collection ends, how history is kept, and how the dashboard reads it. |
| [Data and interpretation](FAQ) | What a speed, a travel estimate, a calendar cell or a gap actually represents. |
| [Testing and verification](Testing-Strategy) | The checks behind the Java services, browser behavior and packaged runtime. |
| [Operations and reliability](Operations-Runbook) | How I check freshness, preserve backups and verify a release. |

The [System page](https://coloradotraffictracker.net/dashboard/system.html)
provides a visual overview. These wiki pages go further into selected decisions
and point to the implementation where that helps explain the result.

## Inspect the data or source

The [API explorer](https://coloradotraffictracker.net/dashboard/api.html) makes
stored observations accessible without installing the project. The
[API notes](API-Reference) explain the read boundaries and historical queries.
The repository contains the [source and current checks](https://github.com/brentjColoS/ColoradoTrafficTracker).

I keep the wiki focused on explanations. Configuration-sensitive procedures
stay beside the code and are linked from the relevant page.
