(() => {
  function create({ emptyCollection, types }) {
    function usableCorridorFeature(feature) {
      return feature?.type === "Feature" && geometryBounds(feature.geometry) ? feature : null;
    }

    function usableIncidentFeatures(features, corridor) {
      if (!Array.isArray(features)) return [];
      return features.filter((feature) => {
        const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
        return feature?.type === "Feature"
          && feature.properties?.corridor === corridor
          && feature.properties?.isOffCorridor !== true
          && validPoint(coordinates);
      });
    }

    function incidentHotspotFeatures(routeFeature, features, corridor, selectedHours) {
      const coordinates = lineCoordinates(routeFeature?.geometry);
      if (coordinates.length < 2) return [];
      const route = measuredRoute(coordinates);
      const anchors = routeMarkerAnchors(routeFeature, route);
      if (anchors.length < 2) return [];

      const lowerMarker = Math.min(anchors[0].marker, anchors.at(-1).marker);
      const upperMarker = Math.max(anchors[0].marker, anchors.at(-1).marker);
      const groups = new Map();
      for (const feature of usableIncidentFeatures(features, corridor)) {
        const properties = feature.properties || {};
        const marker = finiteNumber(properties.closestMileMarker);
        if (!Number.isFinite(marker) || marker < lowerMarker || marker > upperMarker) continue;
        const bandStart = Math.min(
          Math.floor(upperMarker - 1e-9),
          Math.max(Math.floor(lowerMarker), Math.floor(marker))
        );
        const key = incidentIdentity(feature);
        const group = groups.get(bandStart) || {
          eventKeys: new Set(),
          activeEventKeys: new Set(),
          typeCounts: new Map(),
          firstSeenAt: "",
          lastSeenAt: ""
        };
        if (group.eventKeys.has(key)) continue;
        group.eventKeys.add(key);
        if (properties.active === true || properties.active === "true") group.activeEventKeys.add(key);
        const type = incidentType(properties);
        group.typeCounts.set(type, (group.typeCounts.get(type) || 0) + 1);
        group.firstSeenAt = earliestTimestamp(group.firstSeenAt, properties.firstSeenAt);
        group.lastSeenAt = latestTimestamp(group.lastSeenAt, properties.lastSeenAt);
        groups.set(bandStart, group);
      }

      return [...groups.entries()]
        .sort((left, right) => right[1].eventKeys.size - left[1].eventKeys.size
          || right[1].activeEventKeys.size - left[1].activeEventKeys.size
          || (Date.parse(right[1].lastSeenAt) || 0) - (Date.parse(left[1].lastSeenAt) || 0)
          || left[0] - right[0])
        .slice(0, 5)
        .flatMap(([bandStart, group]) => {
          const midpoint = Math.min(upperMarker, bandStart + 0.5);
          const distance = markerDistance(midpoint, anchors);
          if (!Number.isFinite(distance)) return [];
          const commonTypes = [...group.typeCounts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 2)
            .map(([type]) => type)
            .join(" and ");
          return [{
            type: "Feature",
            id: `incident-hotspot-${corridor}-${bandStart}`,
            geometry: { type: "Point", coordinates: pointAtRouteDistance(route, distance) },
            properties: {
              corridor,
              isHotspot: true,
              incidentTypeLabel: "Incident hotspot",
              locationLabel: `MM ${formatMarker(bandStart)}–${formatMarker(Math.min(upperMarker, bandStart + 1))}`,
              incidentCount: group.eventKeys.size,
              activeIncidentCount: group.activeEventKeys.size,
              commonIncidentTypes: commonTypes,
              firstSeenAt: group.firstSeenAt,
              lastSeenAt: group.lastSeenAt,
              selectedHours: Number(selectedHours)
            }
          }];
        });
    }

    function incidentIdentity(feature) {
      const properties = feature?.properties || {};
      return [
        properties.incidentProvider || "unknown",
        properties.providerEventId || properties.referenceKey || properties.incidentRefId || feature?.id || "unknown"
      ].join("|");
    }

    function oneMileCombinedCells(response) {
      const cells = Array.isArray(response?.cells) ? response.cells : [];
      const frequencyMode = response?.resolution === "SLOWDOWN_FREQUENCY";
      const combinedCells = cells.filter(cell => normalizedDirection(cell?.direction) === "COMBINED");
      const corridor = String(response?.corridor || combinedCells[0]?.cellId || "").split(":")[0];
      const buckets = new Map();

      for (const cell of combinedCells) {
        const firstMarker = finiteNumber(cell?.startMileMarker);
        const secondMarker = finiteNumber(cell?.endMileMarker);
        const speed = finiteNumber(cell?.speedMph ?? cell?.avgSpeedMph);
        if (![firstMarker, secondMarker, speed].every(Number.isFinite) || firstMarker === secondMarker) continue;
        const lowMarker = Math.min(firstMarker, secondMarker);
        const highMarker = Math.max(firstMarker, secondMarker);
        for (let bucketStart = Math.floor(lowMarker); bucketStart < highMarker - 1e-9; bucketStart += 1) {
          const overlap = Math.min(highMarker, bucketStart + 1) - Math.max(lowMarker, bucketStart);
          if (overlap <= 0) continue;
          const bucket = buckets.get(bucketStart) || {
            startMileMarker: bucketStart,
            endMileMarker: bucketStart + 1,
            weightedSpeed: 0,
            weightedSourceSpan: 0,
            sourceSpanWeight: 0,
            coveredMiles: 0,
            partialCoverage: false,
            closureEvidence: new Set(),
            closureObservationCount: 0,
            observationCount: 0,
            observedAt: "",
            firstObservedAt: "",
            slowdownFrequencyTotal: 0,
            heavySlowdownFrequencyTotal: 0,
            severeSlowdownFrequencyTotal: 0,
            stoppedFrequencyTotal: 0,
            sampledHourCount: Number.POSITIVE_INFINITY
          };
          bucket.weightedSpeed += speed * overlap;
          bucket.coveredMiles += overlap;
          const sourceSpan = finiteNumber(cell.lengthWeightedSourceSpanMiles ?? cell.avgLengthWeightedSourceSpanMiles);
          if (Number.isFinite(sourceSpan)) {
            bucket.weightedSourceSpan += sourceSpan * overlap;
            bucket.sourceSpanWeight += overlap;
          }
          bucket.partialCoverage ||= !frequencyMode
            && String(cell.quality || hourlyQuality(cell)) === "PARTIAL_CELL";
          const closure = String(cell.closureEvidence || hourlyClosureEvidence(cell));
          if (closure !== "NONE") bucket.closureEvidence.add(closure);
          bucket.closureObservationCount += finiteNumber(cell.closureObservationCount) || 0;
          bucket.observationCount += finiteNumber(cell.observationCount) || 0;
          bucket.observedAt = latestTimestamp(bucket.observedAt,
            cell.observedAt || cell.lastObservedAt || response?.observedAt || response?.hourEnd);
          bucket.firstObservedAt = earliestTimestamp(bucket.firstObservedAt,
            cell.firstObservedAt || cell.observedAt || response?.windowStart);
          const sampledHours = finiteNumber(cell.sampledHourCount);
          if (sampledHours > 0) {
            bucket.sampledHourCount = Math.min(bucket.sampledHourCount, sampledHours);
            bucket.slowdownFrequencyTotal += frequency(cell.slowdownHourCount, sampledHours) * overlap;
            bucket.heavySlowdownFrequencyTotal += frequency(cell.heavySlowdownHourCount, sampledHours) * overlap;
            bucket.severeSlowdownFrequencyTotal += frequency(cell.severeSlowdownHourCount, sampledHours) * overlap;
            bucket.stoppedFrequencyTotal += frequency(cell.stoppedHourCount, sampledHours) * overlap;
          }
          buckets.set(bucketStart, bucket);
        }
      }

      return [...buckets.values()]
        .sort((first, second) => first.startMileMarker - second.startMileMarker)
        .map(bucket => ({
          cellId: `${corridor}:${bucket.startMileMarker.toFixed(3)}-${bucket.endMileMarker.toFixed(3)}`,
          startMileMarker: bucket.startMileMarker,
          endMileMarker: bucket.endMileMarker,
          direction: "COMBINED",
          speedMph: bucket.weightedSpeed / bucket.coveredMiles,
          quality: bucket.coveredMiles >= 0.999 && !bucket.partialCoverage ? "FULL_CELL" : "PARTIAL_CELL",
          closureEvidence: combinedClosureEvidence(bucket.closureEvidence),
          lengthWeightedSourceSpanMiles: bucket.sourceSpanWeight > 0
            ? bucket.weightedSourceSpan / bucket.sourceSpanWeight : null,
          closureObservationCount: bucket.closureObservationCount,
          observationCount: bucket.observationCount,
          observedAt: bucket.observedAt,
          firstObservedAt: bucket.firstObservedAt,
          sampledHourCount: Number.isFinite(bucket.sampledHourCount) ? bucket.sampledHourCount : null,
          slowdownFrequency: bucket.slowdownFrequencyTotal / bucket.coveredMiles,
          heavySlowdownFrequency: bucket.heavySlowdownFrequencyTotal / bucket.coveredMiles,
          severeSlowdownFrequency: bucket.severeSlowdownFrequencyTotal / bucket.coveredMiles,
          stoppedFrequency: bucket.stoppedFrequencyTotal / bucket.coveredMiles
        }));
    }

    function frequency(count, total) {
      const numerator = finiteNumber(count);
      return Number.isFinite(numerator) && total > 0 ? numerator / total : 0;
    }

    function combinedClosureEvidence(evidence) {
      if (evidence.has("FULL_REPORTED")) return "FULL_REPORTED";
      if (evidence.size > 1) return "MIXED_REPORTED";
      return evidence.values().next().value || "NONE";
    }

    function latestTimestamp(first, second) {
      const firstTime = Date.parse(first);
      const secondTime = Date.parse(second);
      if (!Number.isFinite(secondTime)) return String(first || "");
      return !Number.isFinite(firstTime) || secondTime > firstTime ? String(second) : String(first);
    }

    function earliestTimestamp(first, second) {
      const firstTime = Date.parse(first);
      const secondTime = Date.parse(second);
      if (!Number.isFinite(secondTime)) return String(first || "");
      return !Number.isFinite(firstTime) || secondTime < firstTime ? String(second) : String(first);
    }

    function trafficFeaturesForRoute(routeFeature, cells, response) {
      const coordinates = lineCoordinates(routeFeature?.geometry);
      if (coordinates.length < 2 || cells.length === 0) return emptyCollection;

      const route = measuredRoute(coordinates);
      const markerAnchors = routeMarkerAnchors(routeFeature, route);
      if (markerAnchors.length < 2) return emptyCollection;

      const features = cells.flatMap((cell) => {
        const start = finiteNumber(cell?.startMileMarker);
        const end = finiteNumber(cell?.endMileMarker);
        const speed = finiteNumber(cell?.speedMph ?? cell?.avgSpeedMph);
        if (![start, end].every(Number.isFinite) || start === end) return [];
        if (!Number.isFinite(speed)) return [];
        const startDistance = markerDistance(start, markerAnchors);
        const endDistance = markerDistance(end, markerAnchors);
        const geometry = routeSlice(route, startDistance, endDistance);
        if (geometry.length < 2) return [];
        const postedSpeed = postedSpeedForCell(routeFeature, start, end);
        const frequencyMode = response?.resolution === "SLOWDOWN_FREQUENCY";
        const slowdownFrequency = finiteNumber(cell.slowdownFrequency);
        const condition = frequencyMode
          ? frequencyCondition(slowdownFrequency)
          : trafficCondition(cell, speed, postedSpeed);
        const ratio = speedRatio(speed, postedSpeed);
        return [{
          type: "Feature",
          properties: {
            cellId: String(cell.cellId || ""),
            direction: String(cell.direction || "COMBINED"),
            startMileMarker: Math.min(start, end),
            endMileMarker: Math.max(start, end),
            speedMph: speed,
            postedSpeedMph: Number.isFinite(postedSpeed) ? postedSpeed : null,
            speedRatio: Number.isFinite(ratio) ? ratio : null,
            condition,
            quality: String(cell.quality || hourlyQuality(cell)),
            closureEvidence: String(cell.closureEvidence || hourlyClosureEvidence(cell)),
            sourceSpanMiles: finiteOrNull(cell.lengthWeightedSourceSpanMiles ?? cell.avgLengthWeightedSourceSpanMiles),
            observedAt: String(cell.observedAt || cell.lastObservedAt || response.observedAt || response.hourEnd || ""),
            firstObservedAt: String(cell.firstObservedAt || response.windowStart || ""),
            slowdownFrequency: finiteOrNull(slowdownFrequency),
            heavySlowdownFrequency: finiteOrNull(cell.heavySlowdownFrequency),
            severeSlowdownFrequency: finiteOrNull(cell.severeSlowdownFrequency),
            stoppedFrequency: finiteOrNull(cell.stoppedFrequency),
            sampledHourCount: finiteOrNull(cell.sampledHourCount),
            requestedHourCount: finiteOrNull(response.requestedHourCount),
            resolution: String(response.resolution || "CURRENT")
          },
          geometry: { type: "LineString", coordinates: geometry }
        }];
      });
      return { type: "FeatureCollection", features };
    }

    function normalizedDirection(direction) {
      const normalized = String(direction || "COMBINED").trim().toUpperCase();
      return ({ N: "NORTHBOUND", S: "SOUTHBOUND", E: "EASTBOUND", W: "WESTBOUND" })[normalized]
        || normalized;
    }

    function lineCoordinates(geometry) {
      if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)) return [];
      return geometry.coordinates.filter(validPoint);
    }

    function measuredRoute(coordinates) {
      const distances = [0];
      for (let index = 1; index < coordinates.length; index += 1) {
        distances.push(distances[index - 1] + distanceMiles(coordinates[index - 1], coordinates[index]));
      }
      return { coordinates, distances, length: distances.at(-1) || 0 };
    }

    function routeMarkerAnchors(feature, route) {
      const properties = feature?.properties || {};
      const configured = parseMarkerAnchors(properties.mileMarkerAnchorsJson)
        .map(anchor => ({ marker: anchor.mileMarker, distance: nearestRouteDistance(route, [anchor.longitude, anchor.latitude]) }))
        .filter(anchor => Number.isFinite(anchor.marker) && Number.isFinite(anchor.distance));
      const startMarker = finiteNumber(properties.startMileMarker);
      const endMarker = finiteNumber(properties.endMileMarker);
      const markerIncreasesWithRoute = markerDirection(properties.direction || properties.primaryDirection, configured);
      const startIsLowerMarker = !Number.isFinite(startMarker) || !Number.isFinite(endMarker) || startMarker <= endMarker;
      const startAtBeginning = markerIncreasesWithRoute === startIsLowerMarker;
      if (Number.isFinite(startMarker) && !configured.some(anchor => anchor.marker === startMarker)) {
        configured.push({ marker: startMarker, distance: startAtBeginning ? 0 : route.length });
      }
      if (Number.isFinite(endMarker) && !configured.some(anchor => anchor.marker === endMarker)) {
        configured.push({ marker: endMarker, distance: startAtBeginning ? route.length : 0 });
      }
      return configured
        .sort((left, right) => left.marker - right.marker)
        .filter((anchor, index, anchors) => index === 0 || anchor.marker !== anchors[index - 1].marker);
    }

    function markerDirection(direction, anchors) {
      if (anchors.length >= 2) {
        const byMarker = [...anchors].sort((left, right) => left.marker - right.marker);
        if (byMarker.at(-1).distance !== byMarker[0].distance) {
          return byMarker.at(-1).distance > byMarker[0].distance;
        }
      }
      return !["SOUTHBOUND", "WESTBOUND"].includes(normalizedDirection(direction));
    }

    function parseMarkerAnchors(value) {
      if (Array.isArray(value)) return value;
      if (typeof value !== "string" || !value.trim()) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    function nearestRouteDistance(route, point) {
      if (!validPoint(point)) return Number.NaN;
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestRouteDistance = Number.NaN;
      for (let index = 1; index < route.coordinates.length; index += 1) {
        const start = route.coordinates[index - 1];
        const end = route.coordinates[index];
        const projection = segmentProjection(point, start, end);
        const distance = distanceMiles(point, projection.point);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestRouteDistance = route.distances[index - 1]
            + (route.distances[index] - route.distances[index - 1]) * projection.ratio;
        }
      }
      return bestRouteDistance;
    }

    function segmentProjection(point, start, end) {
      const latitudeScale = Math.cos(((point[1] + start[1] + end[1]) / 3) * Math.PI / 180);
      const startX = start[0] * latitudeScale;
      const endX = end[0] * latitudeScale;
      const pointX = point[0] * latitudeScale;
      const dx = endX - startX;
      const dy = end[1] - start[1];
      const denominator = dx * dx + dy * dy;
      const rawRatio = denominator === 0 ? 0 : ((pointX - startX) * dx + (point[1] - start[1]) * dy) / denominator;
      const ratio = Math.max(0, Math.min(1, rawRatio));
      return { ratio, point: [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio] };
    }

    function markerDistance(marker, anchors) {
      if (!Number.isFinite(marker) || anchors.length === 0) return Number.NaN;
      if (marker <= anchors[0].marker) return anchors[0].distance;
      if (marker >= anchors.at(-1).marker) return anchors.at(-1).distance;
      for (let index = 1; index < anchors.length; index += 1) {
        const upper = anchors[index];
        const lower = anchors[index - 1];
        if (marker <= upper.marker) {
          const ratio = (marker - lower.marker) / (upper.marker - lower.marker);
          return lower.distance + (upper.distance - lower.distance) * ratio;
        }
      }
      return Number.NaN;
    }

    function routeSlice(route, firstDistance, secondDistance) {
      if (![firstDistance, secondDistance].every(Number.isFinite)) return [];
      const start = Math.max(0, Math.min(route.length, Math.min(firstDistance, secondDistance)));
      const end = Math.max(0, Math.min(route.length, Math.max(firstDistance, secondDistance)));
      if (end - start < 0.0001) return [];
      const points = [pointAtRouteDistance(route, start)];
      for (let index = 1; index < route.coordinates.length - 1; index += 1) {
        if (route.distances[index] > start && route.distances[index] < end) points.push(route.coordinates[index]);
      }
      points.push(pointAtRouteDistance(route, end));
      return firstDistance <= secondDistance ? points : points.reverse();
    }

    function pointAtRouteDistance(route, distance) {
      if (distance <= 0) return route.coordinates[0];
      if (distance >= route.length) return route.coordinates.at(-1);
      for (let index = 1; index < route.distances.length; index += 1) {
        if (distance <= route.distances[index]) {
          const segmentLength = route.distances[index] - route.distances[index - 1];
          const ratio = segmentLength === 0 ? 0 : (distance - route.distances[index - 1]) / segmentLength;
          const start = route.coordinates[index - 1];
          const end = route.coordinates[index];
          return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
        }
      }
      return route.coordinates.at(-1);
    }

    function postedSpeedForCell(feature, start, end) {
      const midpoint = (start + end) / 2;
      const segments = Array.isArray(feature?.properties?.speedLimitSegments)
        ? feature.properties.speedLimitSegments : [];
      const match = segments.find(segment => {
        const segmentStart = finiteNumber(segment.startMileMarker);
        const segmentEnd = finiteNumber(segment.endMileMarker);
        return Number.isFinite(segmentStart) && Number.isFinite(segmentEnd)
          && midpoint >= Math.min(segmentStart, segmentEnd)
          && midpoint <= Math.max(segmentStart, segmentEnd);
      });
      return finiteNumber(match?.speedLimitMph);
    }

    function trafficCondition(cell, speed, postedSpeed) {
      if (!Number.isFinite(speed)) return "UNKNOWN";
      if (speed <= 3 || String(cell?.closureEvidence || "NONE") === "FULL_REPORTED") return "STOPPED";
      const ratio = speedRatio(speed, postedSpeed);
      if (!Number.isFinite(ratio)) return "UNKNOWN";
      if (ratio >= 1.05) return "ABOVE_EXPECTED";
      if (ratio >= 0.8) return "EXPECTED";
      if (ratio >= 0.6) return "SLOWING";
      if (ratio >= 0.35) return "HEAVY";
      return "SEVERE";
    }

    function frequencyCondition(value) {
      if (!Number.isFinite(value)) return "UNKNOWN";
      if (value >= 0.8) return "PERSISTENT_SLOWDOWN";
      if (value >= 0.5) return "FREQUENT_SLOWDOWN";
      if (value >= 0.25) return "RECURRING_SLOWDOWN";
      if (value >= 0.1) return "OCCASIONAL_SLOWDOWN";
      return "RARE_SLOWDOWN";
    }

    function speedRatio(speed, postedSpeed) {
      return Number.isFinite(speed) && Number.isFinite(postedSpeed) && postedSpeed > 0
        ? speed / postedSpeed : Number.NaN;
    }

    function hourlyQuality(cell) {
      return Number(cell?.fullCellObservationCount) > 0 ? "FULL_CELL" : "PARTIAL_CELL";
    }

    function hourlyClosureEvidence(cell) {
      return Number(cell?.closureObservationCount) > 0 ? "REPORTED_DURING_HOUR" : "NONE";
    }

    function distanceMiles(first, second) {
      const radians = value => value * Math.PI / 180;
      const latitudeDelta = radians(second[1] - first[1]);
      const longitudeDelta = radians(second[0] - first[0]);
      const firstLatitude = radians(first[1]);
      const secondLatitude = radians(second[1]);
      const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
      return 3958.7613 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    }

    function finiteNumber(value) {
      if (value === null || value === undefined || value === "") return Number.NaN;
      const number = Number(value);
      return Number.isFinite(number) ? number : Number.NaN;
    }

    function finiteOrNull(value) {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    function validPoint(coordinates) {
      return Array.isArray(coordinates)
        && Number.isFinite(coordinates[0])
        && Number.isFinite(coordinates[1])
        && Math.abs(coordinates[0]) <= 180
        && Math.abs(coordinates[1]) <= 90;
    }

    function incidentType(properties) {
      return types.label(properties);
    }

    function formatMarker(value) {
      return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
    }

    function geometryBounds(geometry) {
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      visitCoordinates(geometry?.coordinates, bounds);
      if (!bounds.every(Number.isFinite)) return null;
      return [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
    }

    function visitCoordinates(value, bounds) {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
        const [longitude, latitude] = value;
        if (Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90) {
          bounds[0] = Math.min(bounds[0], longitude);
          bounds[1] = Math.min(bounds[1], latitude);
          bounds[2] = Math.max(bounds[2], longitude);
          bounds[3] = Math.max(bounds[3], latitude);
        }
        return;
      }
      for (const child of value) visitCoordinates(child, bounds);
    }

    return { usableCorridorFeature, usableIncidentFeatures, incidentHotspotFeatures, oneMileCombinedCells, frequency, trafficFeaturesForRoute, lineCoordinates, measuredRoute, routeMarkerAnchors, markerDistance, routeSlice, pointAtRouteDistance, speedRatio, finiteNumber, validPoint, incidentType, formatMarker, geometryBounds };
  }

  window.CorridorMapData = { create };
})();
