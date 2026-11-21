(() => {
  function create({ parseDate, finiteNumber, dateMillis, formatZoneMileMarkerRange }) {
    const ZONE_REFERENCE_COLORS = ["#58c4e6", "#b39aff", "#f3bd67", "#79d1b4", "#ef93bf", "#91acf5", "#e76ce6", "#e6a17e"];

    const DENVER_HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", {
      weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", hourCycle: "h23", timeZone: "America/Denver"
    });

    const DENVER_HOUR_CACHE = new Map();

    function selectDisplayBuckets(sourceBuckets, hours, endTime = Date.now()) {
      const buckets = (Array.isArray(sourceBuckets) ? sourceBuckets : [])
        .filter((bucket) => parseDate(bucket?.bucketStart) && Number.isFinite(finiteNumber(bucket?.avgCurrentSpeed)))
        .sort((left, right) => parseDate(left.bucketStart) - parseDate(right.bucketStart));
      if (buckets.length === 0) return [];
      const cutoff = endTime - hours * 3_600_000;
      return buckets.filter((bucket) => dateMillis(bucket.bucketStart) >= cutoff && dateMillis(bucket.bucketStart) <= endTime);
    }

    function normalizeSpeedSamples(sourceSamples) {
      const samplesByTimestamp = new Map();
      for (const sample of Array.isArray(sourceSamples) ? sourceSamples : []) {
        const timestamp = dateMillis(sample.timestamp || sample.polledAt || sample.bucketStart);
        const speed = finiteNumber(sample.speed ?? sample.avgCurrentSpeed);
        if (!timestamp || !Number.isFinite(speed)) continue;
        const repeatEligible = sample.repeatEligible ?? Boolean(sample.polledAt);
        samplesByTimestamp.set(timestamp, {
          timestamp,
          speed,
          repeatEligible,
          signature: String(sample.signature || (repeatEligible ? speedObservationSignature(sample) : "")),
          isCarryForward: Boolean(sample.isCarryForward),
          isBoundary: Boolean(sample.isBoundary)
        });
      }
      let previousSignature = "";
      return [...samplesByTimestamp.values()]
        .sort((left, right) => left.timestamp - right.timestamp)
        .map((sample) => {
          const isCarryForward = sample.isCarryForward
            || (!sample.isBoundary && sample.repeatEligible && Boolean(previousSignature) && sample.signature === previousSignature);
          if (!sample.isBoundary && sample.repeatEligible) previousSignature = sample.signature;
          else if (!sample.isBoundary) previousSignature = "";
          return { ...sample, isCarryForward };
        });
    }

    function speedObservationSignature(sample) {
      if (sample.speedStateSignature) return `state:${sample.speedStateSignature}`;
      const fields = [
        sample.sourceMode,
        sample.avgCurrentSpeed ?? sample.speed,
        sample.avgFreeflowSpeed,
        sample.minCurrentSpeed,
        sample.confidence,
        sample.speedSampleCount,
        sample.p10Speed,
        sample.p50Speed,
        sample.p90Speed,
        sample.incidentCount
      ];
      return fields.map(signatureField).join("|");
    }

    function signatureField(value) {
      const number = finiteNumber(value);
      if (Number.isFinite(number)) return number.toFixed(3);
      return value == null ? "" : String(value);
    }

    function buildCurrentSpeedSeries(trendBuckets, detailedSamples, hours, endTime = Date.now()) {
      const hourly = normalizeSpeedSamples(trendBuckets);
      const detailed = normalizeSpeedSamples(detailedSamples);
      const firstDetailedTimestamp = detailed[0]?.timestamp;
      const combined = detailed.length
        ? [...hourly.filter(point => point.timestamp < firstDetailedTimestamp), ...detailed]
        : hourly;
      return clipSpeedSeriesToWindow(combined, endTime - hours * 3_600_000, endTime);
    }

    function clipSpeedSeriesToWindow(sourceSamples, startTime, endTime) {
      const samples = normalizeSpeedSamples(sourceSamples);
      if (!samples.length) return [];
      const visible = samples.filter(sample => sample.timestamp >= startTime && sample.timestamp <= endTime);
      const startBoundary = speedBoundaryPoint(samples, startTime);
      const endBoundary = speedBoundaryPoint(samples, endTime);
      if (startBoundary && visible[0]?.timestamp !== startTime) visible.unshift(startBoundary);
      if (endBoundary && visible.at(-1)?.timestamp !== endTime) visible.push(endBoundary);
      return visible;
    }

    function buildSmoothedSpeedSeries(sourceSamples, hours) {
      const samples = normalizeSpeedSamples(sourceSamples);
      const halfWindow = trendSmoothingHalfWindow(hours);
      const pointInterval = trendPointInterval(hours);
      return splitSpeedSeries(samples).flatMap((segment) => segment.length < 3
        ? []
        : smoothedTrendSegment(segment, halfWindow, pointInterval));
    }

    function smoothedTrendSegment(segment, halfWindow, pointInterval) {
      let firstNearby = 0;
      let afterNearby = 0;
      return trendAnchorTimes(segment, pointInterval).map((timestamp) => {
        while (firstNearby < segment.length && segment[firstNearby].timestamp < timestamp - halfWindow) firstNearby += 1;
        while (afterNearby < segment.length && segment[afterNearby].timestamp <= timestamp + halfWindow) afterNearby += 1;
        return fitLocalLinearTrend(segment.slice(firstNearby, afterNearby), timestamp, halfWindow);
      }).filter(Boolean);
    }

    function trendAnchorTimes(segment, interval) {
      const first = segment[0].timestamp;
      const last = segment.at(-1).timestamp;
      const timestamps = [first];
      for (let timestamp = first + interval; timestamp < last; timestamp += interval) timestamps.push(timestamp);
      if (last !== first) timestamps.push(last);
      return timestamps;
    }

    function fitLocalLinearTrend(nearby, timestamp, halfWindow) {
      const fresh = nearby.filter(sample => !sample.isCarryForward);
      const evidence = fresh.length >= 3 ? fresh : nearby;
      if (evidence.length < 2) return null;

      const initialModel = weightedLinearModel(evidence, timestamp, halfWindow);
      const residuals = evidence.map(sample => {
        const horizontal = (sample.timestamp - timestamp) / halfWindow;
        return Math.abs(sample.speed - (initialModel.intercept + initialModel.slope * horizontal));
      });
      const residualScale = Math.max(0.75, 1.4826 * medianNumber(residuals));
      const robustWeights = residuals.map(residual => {
        const ratio = residual / (6 * residualScale);
        return ratio >= 1 ? 0 : Math.pow(1 - ratio * ratio, 2);
      });
      const model = weightedLinearModel(evidence, timestamp, halfWindow, robustWeights) || initialModel;
      const minimumSpeed = Math.min(...evidence.map(sample => sample.speed));
      const maximumSpeed = Math.max(...evidence.map(sample => sample.speed));
      return { timestamp, speed: Math.max(minimumSpeed, Math.min(maximumSpeed, model.intercept)) };
    }

    function weightedLinearModel(samples, targetTimestamp, halfWindow, robustWeights = []) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let t0 = 0;
      let t1 = 0;
      samples.forEach((sample, index) => {
        const horizontal = (sample.timestamp - targetTimestamp) / halfWindow;
        const distanceWeight = Math.exp(-2 * horizontal * horizontal);
        const weight = distanceWeight * (robustWeights[index] ?? 1);
        s0 += weight;
        s1 += weight * horizontal;
        s2 += weight * horizontal * horizontal;
        t0 += weight * sample.speed;
        t1 += weight * horizontal * sample.speed;
      });

      if (s0 <= Number.EPSILON) return null;
      const determinant = s0 * s2 - s1 * s1;
      if (Math.abs(determinant) <= 1e-9) return { intercept: t0 / s0, slope: 0 };
      return {
        intercept: (t0 * s2 - t1 * s1) / determinant,
        slope: (s0 * t1 - s1 * t0) / determinant
      };
    }

    function medianNumber(values) {
      const sorted = [...values].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function trendSmoothingHalfWindow(hours) {
      if (hours <= 2) return 20 * 60_000;
      if (hours <= 6) return 40 * 60_000;
      if (hours <= 24) return 90 * 60_000;
      return 3 * 3_600_000;
    }

    function trendPointInterval(hours) {
      if (hours <= 2) return 8 * 60_000;
      if (hours <= 6) return 15 * 60_000;
      if (hours <= 24) return 45 * 60_000;
      if (hours <= 168) return 60 * 60_000;
      return 60 * 60_000;
    }

    function splitSpeedSeries(samples, isUsable = () => true) {
      const segments = [];
      let current = [];
      for (const sample of samples) {
        const usable = isUsable(sample);
        if (!usable || (current.length && sample.timestamp - current.at(-1).timestamp > 90 * 60_000)) {
          if (current.length) segments.push(current);
          current = [];
        }
        if (usable) current.push(sample);
      }
      if (current.length) segments.push(current);
      return segments;
    }

    function speedBoundaryPoint(samples, timestamp) {
      const exact = samples.find(point => point.timestamp === timestamp);
      if (exact) return { ...exact };
      const previous = [...samples].reverse().find(point => point.timestamp < timestamp);
      const next = samples.find(point => point.timestamp > timestamp);
      const maximumGap = 90 * 60_000;
      if (previous && next && next.timestamp - previous.timestamp <= maximumGap) {
        const fraction = (timestamp - previous.timestamp) / (next.timestamp - previous.timestamp);
        return { timestamp, speed: previous.speed + (next.speed - previous.speed) * fraction, isBoundary: true };
      }
      if (previous && !next && timestamp - previous.timestamp <= maximumGap) {
        return { timestamp, speed: previous.speed, isBoundary: true };
      }
      return null;
    }

    function buildBaselineSeries(sourceBuckets, startTime, endTime, profiles = []) {
      const timestamps = baselineTimestamps(startTime, endTime);
      const profileMap = new Map((Array.isArray(profiles) ? profiles : [])
        .map(profile => {
          const day = finiteNumber(profile?.dayOfWeek);
          const hour = finiteNumber(profile?.hourOfDay);
          const speed = finiteNumber(profile?.meanSpeed);
          const standardDeviation = finiteNumber(profile?.standardDeviation);
          if (!Number.isInteger(day) || day < 1 || day > 7 || !Number.isInteger(hour)
            || hour < 0 || hour > 23 || !Number.isFinite(speed) || !Number.isFinite(standardDeviation)) return null;
          return [`${day}|${hour}`, profile];
        })
        .filter(Boolean));
      const missingProfiles = timestamps.filter(timestamp => !profileMap.has(denverProfileKey(timestamp)));
      const legacyByTimestamp = new Map(buildLegacyBaselineSeries(sourceBuckets, missingProfiles)
        .map(point => [point.timestamp, point]));
      return timestamps.map(timestamp => {
        const profile = profileMap.get(denverProfileKey(timestamp));
        if (!profile) return legacyByTimestamp.get(timestamp) || null;
        return {
          timestamp,
          speed: finiteNumber(profile.meanSpeed),
          standardDeviation: finiteNumber(profile.standardDeviation),
          effectiveSampleSize: finiteNumber(profile.effectiveSampleSize),
          sampleCount: finiteNumber(profile.sampleCount),
          sourceProfile: profile.sourceProfile,
          coverageOneSigma: finiteNumber(profile.coverageOneSigma),
          coverageTwoSigma: finiteNumber(profile.coverageTwoSigma),
          coverageThreeSigma: finiteNumber(profile.coverageThreeSigma)
        };
      }).filter(Boolean);
    }

    function baselineTimestamps(startTime, endTime) {
      const hour = 3_600_000;
      const firstHour = Math.ceil(startTime / hour) * hour;
      const timestamps = [startTime];
      for (let timestamp = firstHour; timestamp < endTime; timestamp += hour) {
        if (timestamp > startTime) timestamps.push(timestamp);
      }
      if (endTime > startTime) timestamps.push(endTime);
      return timestamps;
    }

    function buildLegacyBaselineSeries(sourceBuckets, timestamps) {
      if (timestamps.length === 0) return [];
      const source = (Array.isArray(sourceBuckets) ? sourceBuckets : [])
        .map(bucket => ({ timestamp: dateMillis(bucket.bucketStart), speed: finiteNumber(bucket.avgCurrentSpeed) }))
        .filter(point => point.timestamp && Number.isFinite(point.speed))
        .sort((left, right) => left.timestamp - right.timestamp);
      const hour = 3_600_000;
      const byHour = new Map();
      for (const point of source) {
        const localHour = denverHourParts(point.timestamp).hour;
        if (!byHour.has(localHour)) byHour.set(localHour, []);
        byHour.get(localHour).push(point);
      }
      const series = [];
      for (const timestamp of timestamps) {
        const localHour = denverHourParts(timestamp).hour;
        const prior = (byHour.get(localHour) || []).filter(point => point.timestamp >= timestamp - 168 * hour
          && point.timestamp < timestamp);
        if (prior.length) {
          const speed = prior.reduce((sum, point) => sum + point.speed, 0) / prior.length;
          const variance = prior.reduce((sum, point) => sum + (point.speed - speed) ** 2, 0) / prior.length;
          series.push({
            timestamp,
            speed,
            standardDeviation: Math.sqrt(variance)
          });
        }
      }
      return series;
    }

    function denverProfileKey(timestamp) {
      const parts = denverHourParts(timestamp);
      return `${parts.dayOfWeek}|${parts.hour}`;
    }

    function denverHourParts(timestamp) {
      const utcHour = Math.floor(new Date(timestamp).getTime() / 3_600_000);
      if (DENVER_HOUR_CACHE.has(utcHour)) return DENVER_HOUR_CACHE.get(utcHour);
      // Denver offsets and DST transitions align with UTC hours; minute-level observations share these parts.
      const parts = Object.fromEntries(DENVER_HOUR_FORMATTER.formatToParts(new Date(utcHour * 3_600_000))
        .map(part => [part.type, part.value]));
      const value = {
        dayOfWeek: { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday],
        hour: Number(parts.hour), calendarDay: `${parts.year}-${parts.month}-${parts.day}`
      };
      DENVER_HOUR_CACHE.set(utcHour, value);
      while (DENVER_HOUR_CACHE.size > 4096) DENVER_HOUR_CACHE.delete(DENVER_HOUR_CACHE.keys().next().value);
      return value;
    }

    function denverCalendarDay(value) {
      const date = parseDate(value);
      if (!date) return "";
      return denverHourParts(date).calendarDay;
    }

    function groupZoneSeries(sourceRows, hours, endTime = Date.now(), baselineZones = []) {
      const cutoff = endTime - hours * 3_600_000;
      const groups = new Map();
      const baselinesByZone = new Map((Array.isArray(baselineZones) ? baselineZones : [])
        .map(zone => [String(zone?.zoneKey || ""), zone]));
      for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
        const timestamp = dateMillis(row.bucketStart || row.polledAt);
        const speed = finiteNumber(row.avgCurrentSpeed);
        if (!timestamp || timestamp < cutoff - 90 * 60_000 || timestamp > endTime || !Number.isFinite(speed)) continue;
        const key = String(row.zoneKey || `${row.startMileMarker}-${row.endMileMarker}`);
        if (!groups.has(key)) {
          const baselineZone = baselinesByZone.get(key);
          groups.set(key, {
            key,
            order: finiteNumber(row.zoneOrder),
            marker: formatZoneMileMarkerRange(row) || String(row.zoneLabel || "Speed zone"),
            startMileMarker: finiteNumber(row.startMileMarker),
            endMileMarker: finiteNumber(row.endMileMarker),
            postedSpeedMph: finiteNumber(row.postedSpeedMph ?? baselineZone?.postedSpeedMph),
            baselineProfiles: baselineZone?.profiles || [],
            samples: []
          });
        }
        groups.get(key).samples.push({
          timestamp,
          speed,
          repeatEligible: true,
          signature: speedObservationSignature(row)
        });
      }
      return labelSpeedZoneGroups([...groups.values()]
        .map(group => {
          group.samples = clipZoneSpeedSeriesToWindow(group.samples, cutoff, endTime);
          group.latestSpeed = group.samples.at(-1)?.speed;
          return group;
        })
        .sort((left, right) => (Number.isFinite(left.order) ? left.order : 999) - (Number.isFinite(right.order) ? right.order : 999)));
    }

    function labelSpeedZoneGroups(groups) {
      return groups.map(group => {
        const referenceColor = ZONE_REFERENCE_COLORS[(Number.isInteger(group.order) && group.order >= 0 ? group.order : 0) % ZONE_REFERENCE_COLORS.length];
        const referenceKey = [group.startMileMarker, group.endMileMarker].every(Number.isFinite)
          ? JSON.stringify([group.startMileMarker, group.endMileMarker, group.postedSpeedMph ?? null]) : group.key;
        if (!Number.isInteger(group.order) || group.order < 0) return {...group, referenceKey, referenceColor, referenceLabel: group.marker};
        const peers = groups.filter(other => other.order === group.order).sort((a, b) => a.key.localeCompare(b.key));
        const suffix = peers.length > 1 ? String.fromCharCode(97 + peers.findIndex(other => other.key === group.key)) : "";
        return {...group, referenceKey, referenceColor, referenceLabel: `Z${group.order + 1}${suffix}`};
      });
    }

    function clipZoneSpeedSeriesToWindow(sourceSamples, startTime, endTime) {
      const samples = clipSpeedSeriesToWindow(sourceSamples, startTime, endTime);
      const first = samples[0];
      if (first && first.timestamp > startTime && first.timestamp - startTime <= 90 * 60_000) {
        samples.unshift({ ...first, timestamp: startTime, isBoundary: true });
      }
      return samples;
    }

    function assignIncidentsToZoneGroups(groups, incidentThreads) {
      const assignments = new Map((Array.isArray(groups) ? groups : []).map(group => [group.key, []]));
      for (const incident of Array.isArray(incidentThreads) ? incidentThreads : []) {
        const marker = incidentMileMarker(incident);
        if (!Number.isFinite(marker)) continue;
        const candidates = groups.filter(group => {
          const start = finiteNumber(group.startMileMarker);
          const end = finiteNumber(group.endMileMarker);
          return Number.isFinite(start) && Number.isFinite(end)
            && marker >= Math.min(start, end) && marker <= Math.max(start, end);
        });
        const group = candidates.find(candidate => marker < Math.max(candidate.startMileMarker, candidate.endMileMarker))
          || candidates.at(-1);
        if (group) assignments.get(group.key)?.push(incident);
      }
      return assignments;
    }

    function incidentMileMarker(incident) {
      const match = String(incident?.locationLabel || "").match(/\b(?:MP|MM)\s*([0-9]+(?:\.[0-9]+)?)/i);
      return match ? finiteNumber(match[1]) : Number.NaN;
    }

    function calculateSpeedDomain(values) {
      const speeds = (Array.isArray(values) ? values : []).filter(Number.isFinite);
      if (!speeds.length) return { min: 0, max: 100, step: 20 };
      const observedMin = Math.max(0, Math.min(...speeds));
      const observedMax = Math.min(100, Math.max(...speeds));
      const observedSpan = Math.max(0, observedMax - observedMin);
      const desiredSpan = Math.max(8, observedSpan * 1.1);
      const step = niceSpeedStep(desiredSpan / 6);
      const headroom = observedSpan > 0 ? observedSpan * 0.05 : step;
      let min = Math.max(0, Math.floor((observedMin - headroom) / step) * step);
      let max = Math.min(100, Math.ceil((observedMax + headroom) / step) * step);
      while (max - min < 8) {
        const lowerHeadroom = observedMin - min;
        const upperHeadroom = max - observedMax;
        if (max <= 100 - step && (min < step || upperHeadroom <= lowerHeadroom)) max += step;
        else if (min >= step) min -= step;
        else break;
      }
      return { min, max, step };
    }

    function calculateCorridorSpeedDomain(samples, baselineSeries) {
      return calculateSpeedDomain([
        ...(Array.isArray(samples) ? samples : []).map(point => point.speed),
        ...(Array.isArray(baselineSeries) ? baselineSeries : []).map(point => point.speed)
      ]);
    }

    function niceSpeedStep(idealStep) {
      return [1, 2, 5, 10, 20].find(step => step >= idealStep) || 20;
    }

    function calculateZoneSpeedDomain(group, baselineSeries) {
      const postedSpeed = finiteNumber(group?.postedSpeedMph);
      const samples = Number.isFinite(postedSpeed)
        ? [...(group?.samples || []), { speed: postedSpeed }]
        : group?.samples || [];
      return calculateCorridorSpeedDomain(samples, baselineSeries);
    }

    return { selectDisplayBuckets, normalizeSpeedSamples, buildCurrentSpeedSeries, clipSpeedSeriesToWindow, buildSmoothedSpeedSeries, trendSmoothingHalfWindow, splitSpeedSeries, speedBoundaryPoint, buildBaselineSeries, buildLegacyBaselineSeries, denverProfileKey, denverHourParts, denverCalendarDay, groupZoneSeries, labelSpeedZoneGroups, clipZoneSpeedSeriesToWindow, assignIncidentsToZoneGroups, calculateSpeedDomain, calculateCorridorSpeedDomain, niceSpeedStep, calculateZoneSpeedDomain };
  }

  window.DashboardSeries = { create };
})();
