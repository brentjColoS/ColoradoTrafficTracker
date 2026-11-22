![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

Winter is the next focus: bring CDOT snowplows onto the corridor maps and use
the growing archive to explore the drive home from the mountains. The snowplow
layer is planned; the comparisons and seasonal features below are ideas to
explore as the data allows.

## Winter special: follow the plows

Add CDOT's latest reported snowplow positions to the I-25 and I-70 maps, alongside
traffic speeds and roadway events. Select a truck to see its reported direction
and last update, or follow it as new positions arrive.

Colorado's [COTAK integration](https://cotak.gov/pages/data-feeds-and-integrations/existing-integrations)
already consumes COtrip plow locations. The first implementation step is to
confirm CTT's access to that feed and inspect its current responses. Update
frequency and available details will follow from the source. Reports that stop
advancing would fade or be marked stale; a truck's position alone would not
establish that a road has been cleared.

## One more run?

Choose a past ski day and compare leaving the mountains at 2:00, 2:30 or 3:00.
Show how the estimated drive changes as traffic develops along the route, then
compare that afternoon with similar weekends.

This would turn the [original question](Project-Journey) into an interactive
historical comparison. It needs time-aligned observations along the drive and
clear coverage labels; the results would be reconstructed estimates, not
recorded vehicle trips.

## Storm postcards

Turn a memorable day into a shareable visual: a corridor map, the day's speed
curve and a few incident milestones. A postcard could capture a long Sunday
slowdown, a closure or an unusually quick recovery, with a link back to the
selected window in the dashboard.

The existing [traffic journal](FAQ) and snapshot publisher provide the visual
foundation. Each postcard would keep the date, source timestamps and supporting
observations attached, so a striking image also has an inspectable record.

## A winter traffic atlas

Build on the historical frequency maps to show which stretches slow repeatedly,
how long those slowdowns last and when they clear. Compare mountain-return
weekends with weekday commuting, using the same geographic sections and scales.

Snowy-versus-clear comparisons would add another dimension once historical
weather observations can be matched to the corridor and time. The
[coverage boundaries](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/data-history-coverage.md)
would stay visible where route extents, resolution or available records differ.

## Winter in review

Give the season a closing recap: the biggest observed slowdown, the sharpest
recovery, the most consistent stretch and the weekends when leaving later made
the largest estimated difference. Each highlight would link to its date and
show how much data supports it.

An interactive calendar on the website could become the way into that recap:
select a day, inspect its journal, then compare it with the rest of the season.

[← About me](About-Me) · [Wiki home →](Home)
