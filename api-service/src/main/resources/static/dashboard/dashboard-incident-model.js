(() => {
  function create({ finiteNumber, parseDate, types, dateMillis, formatMileMarker }) {
    const ONGOING_INCIDENT_WINDOW_MINUTES = 45;

    function legacySnapshotIncidentFeatures(latest) {
      if (!latest?.incidentsJson || !latest.polledAt) return [];
      try {
        const payload = typeof latest.incidentsJson === "string" ? JSON.parse(latest.incidentsJson) : latest.incidentsJson;
        if (!Array.isArray(payload?.incidents)) return [];
        return payload.incidents.filter((incident) => isActionableLegacyIncident(incident?.properties)).map((incident) => {
          const properties = incident?.properties || {};
          const typeLabel = legacyIncidentTypeLabel(properties.iconCategory, properties.description);
          const marker = Number.isFinite(finiteNumber(properties.closestMileMarker))
            ? finiteNumber(properties.closestMileMarker).toFixed(1) : "unknown";
          const identity = [properties.travelDirection || "?", typeLabel, marker].join("|");
          return {
            id: `snapshot-${latest.corridor || "corridor"}-${identity}`,
            geometry: incident?.geometry || null,
            properties: {
              ...properties,
              corridor: latest.corridor,
              incidentProvider: latest.incidentProvider || "snapshot",
              providerEventId: `snapshot-${identity}`,
              incidentTypeLabel: typeLabel,
              firstSeenAt: latest.polledAt,
              lastSeenAt: latest.polledAt,
              polledAt: latest.polledAt,
              active: true
            }
          };
        });
      } catch {
        return [];
      }
    }

    function isActionableLegacyIncident(properties) {
      const category = Number(properties?.iconCategory);
      return [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 14].includes(category);
    }

    function legacyIncidentTypeLabel(iconCategory, description) {
      const labels = {
        1: "Accident", 2: "Fog", 3: "Dangerous conditions", 4: "Rain", 5: "Ice",
        7: "Lane closed", 8: "Road closed", 9: "Road works", 10: "Wind", 11: "Flooding",
        13: "Incident cluster", 14: "Broken down vehicle"
      };
      return String(description || labels[Number(iconCategory)] || `Incident type ${iconCategory ?? "unknown"}`);
    }

    function aggregateIncidentThreads(features, referenceTime = null) {
      const groups = new Map();
      for (const feature of features) {
        const properties = feature?.properties || {};
        const key = incidentThreadKey(feature);
        const firstSeenAt = parseDate(properties.firstSeenAt || properties.polledAt || properties.sourceUpdatedAt);
        const lastSeenAt = parseDate(properties.lastSeenAt || properties.polledAt || properties.sourceUpdatedAt);
        const existing = groups.get(key);
        const type = normalizeIncidentType(properties);
        const locationLabel = buildIncidentLocation(properties);
        const details = incidentDisplayDetails(properties, type);
        if (!existing) {
          groups.set(key, {
            key,
            type,
            locationLabel,
            firstSeenAt,
            lastSeenAt,
            active: properties.active,
            archived: Boolean(properties.archived),
            normalizedStatus: String(properties.normalizedStatus || ""),
            sourceUpdatedAt: parseDate(properties.sourceUpdatedAt),
            ...details
          });
          continue;
        }
        if (firstSeenAt && (!existing.firstSeenAt || firstSeenAt < existing.firstSeenAt)) existing.firstSeenAt = firstSeenAt;
        if (lastSeenAt && (!existing.lastSeenAt || lastSeenAt >= existing.lastSeenAt)) {
          existing.lastSeenAt = lastSeenAt;
          existing.active = properties.active;
          existing.normalizedStatus = String(properties.normalizedStatus || "");
          existing.type = type;
          Object.assign(existing, details);
        }
        const sourceUpdatedAt = parseDate(properties.sourceUpdatedAt);
        if (sourceUpdatedAt && (!existing.sourceUpdatedAt || sourceUpdatedAt > existing.sourceUpdatedAt)) {
          existing.sourceUpdatedAt = sourceUpdatedAt;
        }
        existing.archived = existing.archived && Boolean(properties.archived);
        if (existing.locationLabel === "Location unavailable" && locationLabel !== "Location unavailable") {
          existing.locationLabel = locationLabel;
        }
      }

      const now = parseDate(referenceTime) || new Date();
      return [...groups.values()]
        .map((thread) => ({ ...thread, referenceTime: now, ongoing: incidentIsOngoing(thread, now) }))
        .sort((left, right) => {
          if (left.ongoing !== right.ongoing) return left.ongoing ? -1 : 1;
          if (left.ongoing) {
            const longTermOrder = Number(Boolean(types.longTermSpan(left)))
              - Number(Boolean(types.longTermSpan(right)));
            if (longTermOrder) return longTermOrder;
          }
          return dateMillis(right.lastSeenAt) - dateMillis(left.lastSeenAt);
        });
    }

    function incidentDisplayDetails(properties, fallbackType) {
      return {
        displayType: types.label(properties, fallbackType),
        inferenceDetail: types.sunGlareInference(properties),
        restrictionDetail: types.chainLaw(properties)?.detail || "",
        impactLabel: String(properties.incidentImpactLabel || "").trim(),
        note: String(properties.incidentNote || "").trim(),
        severity: String(properties.sourceSeverity || "").trim(),
        description: String(properties.incidentDescription || properties.description || properties.incidentNote || "").trim(),
        providerLabel: properties.incidentProvider === "cdot" ? "CDOT" : "Provider",
        sourceStartMarker: finiteNumber(properties.sourceStartMarker),
        sourceEndMarker: finiteNumber(properties.sourceEndMarker),
        sourceStartedAt: parseDate(properties.sourceStartedAt),
        sourceEndedAt: parseDate(properties.sourceEndedAt)
      };
    }

    function incidentThreadKey(feature) {
      const properties = feature?.properties || {};
      return `${properties.incidentProvider || "unknown"}|${properties.corridor || ""}|${String(properties.providerEventId
        || properties.referenceKey
        || properties.incidentRefId
        || feature?.id
        || `${properties.locationLabel}|${properties.iconCategory}`)}`;
    }

    function buildIncidentLocation(properties) {
      const marker = finiteNumber(properties.closestMileMarker);
      const markerLabel = Number.isFinite(marker) ? `MP ${formatMileMarker(marker)}` : "";
      const location = String(properties.locationLabel || properties.referenceLabel || "").trim();
      const markerValue = Number.isFinite(marker) ? formatMileMarker(marker).toLowerCase() : "";
      const locationIncludesMarker = markerValue && ["mp", "mm"]
        .some(prefix => location.toLowerCase().includes(`${prefix} ${markerValue}`));
      if (markerLabel && location && !locationIncludesMarker) {
        return `${markerLabel} · ${location}`;
      }
      return location || markerLabel || "Location unavailable";
    }

    function incidentIsOngoing(thread, now) {
      const status = String(thread.normalizedStatus || "").toLowerCase();
      if (["planned", "scheduled"].some((value) => status.includes(value))) return false;
      const ended = thread.archived || ["cleared", "closed", "ended", "inactive", "resolved", "cancel"].some((value) => status.includes(value));
      if (ended) return false;
      if (thread.sourceStartedAt && thread.sourceStartedAt > now) return false;
      if (typeof thread.active === "boolean") return thread.active;
      if (!thread.lastSeenAt) return false;
      const ageMinutes = Math.max(0, (now.getTime() - thread.lastSeenAt.getTime()) / 60_000);
      return ageMinutes <= ONGOING_INCIDENT_WINDOW_MINUTES;
    }

    function normalizeIncidentType(value) {
      return types.classify(value);
    }

    return { legacySnapshotIncidentFeatures, aggregateIncidentThreads, buildIncidentLocation, normalizeIncidentType };
  }

  window.DashboardIncidentModel = { create };
})();
