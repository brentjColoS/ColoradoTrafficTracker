(() => {
  function create({ document, types, formatShortDateTime, displayTimeFormatter, displayTimeZone }) {
    function render(corridor, incidentThreads, { rowsId, combinedView, expanded, incidentsAvailable }) {
      const tableBody = document.getElementById(rowsId);
      const openDetails = new Set([...tableBody.querySelectorAll("details[open]")].map(details => details.dataset.incidentKey));
      tableBody.replaceChildren();
      const rows = combinedView && !expanded ? incidentThreads.slice(0, 3) : incidentThreads;
      const link = document.querySelector(`[data-incident-toggle="${corridor}"]`);
      if (link) {
        link.textContent = expanded ? "Show fewer ↑" : `See all ${corridor.replace("I", "I-")} incidents (${incidentThreads.length}) →`;
        link.setAttribute("aria-expanded", String(expanded));
      }
      const count = document.getElementById(`${corridor.toLowerCase()}IncidentCount`);
      if (count) {
        const ongoingCount = incidentThreads.filter((incident) => incident.ongoing).length;
        const continuingCount = incidentThreads.filter((incident) => types.nextContinuationStart(incident, incident.referenceTime || new Date())).length;
        count.textContent = incidentThreads.length === 0
          ? "No incidents"
          : `${ongoingCount} active${continuingCount ? ` · ${continuingCount} continuing later` : ""} · ${incidentThreads.length} total`;
      }
      if (incidentThreads.length === 0) {
        const row = document.createElement("tr");
        row.className = "empty-row";
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.textContent = !incidentsAvailable
          ? "Incident feed unavailable. Try refreshing."
          : "No incidents in the selected window.";
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
      }

      for (const incident of rows) {
        const row = document.createElement("tr");
        row.appendChild(buildIncidentNameCell(incident));
        row.appendChild(buildIncidentDirectionCell(incident));
        row.appendChild(buildIncidentLocationCell(incident, openDetails.has(incident.key), openDetails.has(`source:${incident.key}`)));
        row.appendChild(buildTextCell(formatShortDateTime(incident.firstSeenAt)));
        row.appendChild(buildLastSeenCell(incident));
        tableBody.appendChild(row);
      }
    }

    function buildIncidentNameCell(incident) {
      const cell = document.createElement("td");
      const wrapper = document.createElement("span");
      wrapper.className = "incident-name";
      const symbol = types.svg(document, incident.type);
      const label = document.createElement("span");
      label.textContent = incident.displayType || incident.type;
      wrapper.append(symbol, label);
      cell.appendChild(wrapper);
      const status = buildIncidentStatus(incident);
      status.className += " incident-row-state";
      cell.appendChild(status);
      return cell;
    }

    function buildIncidentDirectionCell(incident) {
      const cell = document.createElement("td");
      cell.className = "incident-direction-cell";
      const badge = document.createElement("span");
      badge.className = "incident-direction";
      const direction = {N: ["NB", "Northbound"], S: ["SB", "Southbound"],
        E: ["EB", "Eastbound"], W: ["WB", "Westbound"]}[incident.travelDirection];
      badge.dataset.direction = direction ? incident.travelDirection : "unknown";
      badge.title = direction ? direction[1] : "Direction not specified";
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", badge.title);
      if (direction) {
        const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        arrow.setAttribute("aria-hidden", "true");
        arrow.setAttribute("focusable", "false");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#icon-arrow");
        arrow.appendChild(use);
        badge.appendChild(arrow);
      }
      const label = document.createElement("span");
      label.textContent = direction ? direction[0] : "—";
      badge.appendChild(label);
      cell.appendChild(badge);
      return cell;
    }

    function buildIncidentLocationCell(incident, expanded = false, sourceExpanded = false) {
      const cell = document.createElement("td");
      const location = document.createElement("span");
      location.textContent = incident.locationLabel || "Location unavailable";
      cell.appendChild(location);

      if (!incidentHasDetails(incident)) return cell;
      const details = document.createElement("details");
      details.className = "incident-details";
      details.dataset.incidentKey = incident.key;
      const summary = document.createElement("summary");
      summary.textContent = "Incident details";
      details.appendChild(summary);
      const renderDetails = () => {
        if (!details.open || details.children.length > 1) return;
        for (const detailLine of incidentDetailLines(incident)) {
          const line = document.createElement("span");
          line.textContent = detailLine;
          details.appendChild(line);
        }
        const source = document.createElement("details");
        source.className = "incident-source";
        source.dataset.incidentKey = `source:${incident.key}`;
        const sourceSummary = document.createElement("summary");
        sourceSummary.textContent = incident.description ? `Full ${incident.providerLabel} report` : `${incident.providerLabel} details`;
        source.appendChild(sourceSummary);
        const renderSource = () => {
          if (!source.open || source.children.length > 1) return;
          const lines = [];
          if (incident.sourceUpdatedAt) lines.push(`Updated: ${formatShortDateTime(incident.sourceUpdatedAt)}`);
          if (incident.description) lines.push(incident.description.replace(/\s*•\s*/g, "\n• "));
          for (const text of lines) {
            const line = document.createElement("span"); line.textContent = text; source.appendChild(line);
          }
        };
        source.addEventListener("toggle", renderSource);
        source.open = sourceExpanded; renderSource();
        details.appendChild(source);
      };
      details.addEventListener("toggle", renderDetails);
      details.open = expanded;
      renderDetails();
      cell.appendChild(details);
      return cell;
    }

    function incidentHasDetails(incident) {
      return Boolean(incident.inferenceDetail || incident.restrictionDetail || incident.impactLabel || (incident.severity && incident.severity.toLowerCase() !== "unknown")
        || (incident.description && incident.description.toLowerCase() !== String(incident.displayType || "").toLowerCase())
        || Number.isFinite(incident.sourceStartMarker) || Number.isFinite(incident.sourceEndMarker)
        || incident.sourceStartedAt || incident.sourceEndedAt || incident.sourceUpdatedAt);
    }

    function incidentDetailLines(incident) {
      const lines = [];
      if (incident.inferenceDetail) lines.push(incident.inferenceDetail);
      if (incident.restrictionDetail) lines.push(incident.restrictionDetail);
      const markers = [incident.sourceStartMarker, incident.sourceEndMarker].filter(Number.isFinite);
      if (markers.length) {
        const low = Math.min(...markers).toLocaleString(undefined, {maximumFractionDigits: 3});
        const high = Math.max(...markers).toLocaleString(undefined, {maximumFractionDigits: 3});
        lines.push(`MM ${low}${low === high ? "" : `–${high}`}`);
      }
      if (incident.impactLabel) lines.push(incident.impactLabel);
      if (incident.severity && incident.severity.toLowerCase() !== "unknown") {
        lines.push(`${incident.severity.charAt(0).toUpperCase()}${incident.severity.slice(1).toLowerCase()} severity`);
      }
      const context = lines.join(" · ");
      const timing = incidentTimeRange(incident), message = compactIncidentMessage(incident);
      return [context, timing, message].filter(Boolean);
    }

    function incidentTimeRange(incident) {
      const stamp = date => {
        if (!date) return null;
        const p = Object.fromEntries(displayTimeFormatter({year: "2-digit", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", timeZoneName: "short"})
          .formatToParts(date).map(part => [part.type, part.value]));
        return {date: `${p.month}/${p.day}/${p.year}`, time: `${p.hour}:${p.minute} ${p.dayPeriod}`, zone: p.timeZoneName};
      };
      const start = stamp(incident.sourceStartedAt), end = stamp(incident.sourceEndedAt);
      const label = incident.normalizedStatus === "planned" ? "Scheduled" : "Reported";
      if (!start && !end) return "";
      if (!start || !end) {
        const value = start || end;
        return `${label} ${start ? "start" : "end"}: ${value.date} ${value.time} ${value.zone}`;
      }
      return `${label}: ${start.date} ${start.time}${start.zone === end.zone ? "" : ` ${start.zone}`} → ${start.date === end.date ? "" : `${end.date} `}${end.time} ${end.zone}`;
    }

    function compactIncidentMessage(incident) {
      const words = text => String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(word => word && !["the", "is", "a", "an", "and"].includes(word));
      const impact = new Set(words(incident.impactLabel));
      const sentences = String(incident.description || "").split(/\bfull\s+schedule(?:\s+below)?\s*:/i)[0]
        .split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(sentence => {
          if (!sentence || /^(?:between|at|from)\b.*(?:\bmile (?:point|marker)\b|\bexit\s+\d|\binterchanges?\b)/i.test(sentence)) return false;
          if (incident.sourceStartedAt && incident.sourceEndedAt && /^(?:starting|until|work begins)\b/i.test(sentence)) return false;
          if (incident.sourceStartedAt && incident.sourceEndedAt && /^scheduled(?: overnight)? work\.?$/i.test(sentence)) return false;
          const content = words(sentence);
          return content.join(" ") !== words(incident.displayType).join(" ") && !content.every(word => impact.has(word));
        }).map(sentence => {
          const reason = sentence.match(/^(.*?)\bclosed\s+(?:due to|for)\s+(.+)$/i);
          return reason && words(`${reason[1]} closed`).every(word => impact.has(word))
            ? reason[2].replace(/^./, letter => letter.toUpperCase()) : sentence;
        });
      const message = sentences.slice(0, 2).join(" "), suffix = sentences.length > 2 ? " …" : "";
      return message.length + suffix.length > 180 ? `${message.slice(0, 177).replace(/\s+\S*$/, "")}…` : message + suffix;
    }

    function buildTextCell(value) {
      const cell = document.createElement("td");
      cell.textContent = value || "—";
      cell.title = value || "";
      return cell;
    }

    function buildIncidentStatus(incident) {
      const status = document.createElement("span");
      const nextStart = types.nextContinuationStart(incident, incident.referenceTime || new Date());
      const continuing = nextStart || incident.ongoing && types.longTermSpan(incident);
      status.className = continuing ? "continuing-pill" : incident.ongoing ? "ongoing-pill" : "incident-status-pill";
      status.textContent = incidentStatusLabel(incident);
      if (nextStart) status.title = `Not active now. Next reported work start: ${formatShortDateTime(nextStart)}. Check the full provider report for restrictions.`;
      else if (continuing) status.title = "Active long-term report spanning at least two days. Restrictions may be intermittent; check the full provider report.";
      return status;
    }

    function buildLastSeenCell(incident) {
      const cell = document.createElement("td");
      const timestamp = document.createElement("span");
      timestamp.textContent = formatShortDateTime(incident.lastSeenAt);
      cell.appendChild(timestamp);
      const duration = incidentObservedDuration(incident);
      if (duration) {
        const durationLabel = document.createElement("small");
        durationLabel.className = "incident-duration";
        durationLabel.textContent = duration;
        cell.appendChild(durationLabel);
      }
      return cell;
    }

    function incidentStatusLabel(incident) {
      const status = String(incident.normalizedStatus || "").toLowerCase();
      if (incident.archived || ["cleared", "closed", "ended", "inactive", "resolved", "cancel"].some(value => status.includes(value))) return "Cleared";
      const referenceTime = incident.referenceTime || new Date();
      const nextStart = types.nextContinuationStart(incident, referenceTime);
      if (nextStart) return types.continuationLabel(nextStart, referenceTime, displayTimeZone);
      if (["planned", "scheduled"].some((value) => status.includes(value))
        || incident.sourceStartedAt && incident.sourceStartedAt > referenceTime) return "Planned";
      if (incident.ongoing) return types.longTermSpan(incident) ? "Active · Long-term" : "Active";
      if (incident.sourceEndedAt && incident.sourceEndedAt <= referenceTime) {
        return "Cleared";
      }
      return "Last reported";
    }

    function incidentObservedDuration(incident) {
      const continuing = incident.ongoing && types.longTermSpan(incident);
      const reportedTiming = Boolean(incident.sourceStartedAt && incident.sourceEndedAt);
      const start = continuing ? new Date(continuing.start) : reportedTiming ? incident.sourceStartedAt : incident.firstSeenAt;
      const end = continuing ? new Date(continuing.end) : reportedTiming ? incident.sourceEndedAt : incident.lastSeenAt;
      const label = continuing ? continuing.basis : reportedTiming ? incident.normalizedStatus === "planned" ? "Scheduled" : "Reported" : "Observed";
      if (!start || !end || end <= start) return "";
      const totalMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
      if (totalMinutes < 60) return `${label} ${totalMinutes} min`;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours < 24) return `${label} ${hours} hr${minutes ? ` ${minutes} min` : ""}`;
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${label} ${days} day${days === 1 ? "" : "s"}${remainingHours ? ` ${remainingHours} hr` : ""}`;
    }

    return { render, buildIncidentNameCell, buildIncidentLocationCell, buildLastSeenCell, incidentDetailLines, incidentTimeRange, compactIncidentMessage, incidentStatusLabel, incidentObservedDuration };
  }

  window.DashboardIncidentTable = { create };
})();
