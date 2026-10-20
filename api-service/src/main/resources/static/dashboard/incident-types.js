(function () {
  "use strict";

  // Lucide paths at c29c276f16590cf017126671535ad8c792be64d8.
  // Circles and rounded rectangles are expressed as paths for shared SVG/canvas rendering.
  // Origin resets preserve relative moves when joining the original SVG subpaths.
  // See THIRD_PARTY_NOTICES.md for attribution and license.
  const types = {
    "Crash": { label: "Crash", tone: "crash", lucide: "triangle-alert", path: "M0 0 m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3 M0 0 M12 9v4 M0 0 M12 17h.01" },
    "Construction": { label: "Construction", tone: "construction", lucide: "construction", path: "M3 6h18a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-18a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1Z M0 0 M17 14v7 M0 0 M7 14v7 M0 0 M17 3v3 M0 0 M7 3v3 M0 0 M10 14 2.3 6.3 M0 0 m14 6 7.7 7.7 M0 0 m8 6 8 8" },
    "Closure": { label: "Closure", tone: "closure", lucide: "circle-minus", path: "M22 12a10 10 0 1 0 -20 0a10 10 0 1 0 20 0Z M0 0 M8 12h8" },
    "Disabled Vehicle": { label: "Disabled vehicle", tone: "vehicle", lucide: "car-front", path: "M0 0 m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8 M0 0 M7 14h.01 M0 0 M17 14h.01 M5 10h14a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2Z M0 0 M5 18v2 M0 0 M19 18v2" },
    "Sun Glare": { label: "Sun glare", tone: "construction", lucide: "sun", path: "M16 12a4 4 0 1 0 -8 0a4 4 0 1 0 8 0Z M0 0 M12 2v2 M0 0 M12 20v2 M0 0 m4.93 4.93 1.41 1.41 M0 0 m17.66 17.66 1.41 1.41 M0 0 M2 12h2 M0 0 M20 12h2 M0 0 m6.34 17.66-1.41 1.41 M0 0 m19.07 4.93-1.41 1.41" },
    "Snow": { label: "Snow", tone: "weather", lucide: "snowflake", path: "M0 0 m10 20-1.25-2.5L6 18 M0 0 M10 4 8.75 6.5 6 6 M0 0 m14 20 1.25-2.5L18 18 M0 0 m14 4 1.25 2.5L18 6 M0 0 m17 21-3-6h-4 M0 0 m17 3-3 6 1.5 3 M0 0 M2 12h6.5L10 9 M0 0 m20 10-1.5 2 1.5 2 M0 0 M22 12h-6.5L14 15 M0 0 m4 10 1.5 2L4 14 M0 0 m7 21 3-6-1.5-3 M0 0 m7 3 3 6h4" },
    "Ice": { label: "Ice", tone: "weather", lucide: "thermometer-snowflake", path: "M0 0 m10 20-1.25-2.5L6 18 M0 0 M10 4 8.75 6.5 6 6 M0 0 M10.585 15H10 M0 0 M2 12h6.5L10 9 M0 0 M20 14.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z M0 0 m4 10 1.5 2L4 14 M0 0 m7 21 3-6-1.5-3 M0 0 m7 3 3 6h2" },
    "Debris": { label: "Debris / rockfall", tone: "crash", lucide: "stone", path: "M0 0 M11.264 2.205A4 4 0 0 0 6.42 4.211l-4 8a4 4 0 0 0 1.359 5.117l6 4a4 4 0 0 0 4.438 0l6-4a4 4 0 0 0 1.576-4.592l-2-6a4 4 0 0 0-2.53-2.53z M0 0 M11.99 22 14 12l7.822 3.184 M0 0 M14 12 8.47 2.302" },
    "Fog": { label: "Fog / smoke", tone: "weather", lucide: "cloud-fog", path: "M0 0 M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242 M0 0 M16 17H7 M0 0 M17 21H9" },
    "Wind": { label: "High wind", tone: "weather", lucide: "wind", path: "M0 0 M12.8 19.6A2 2 0 1 0 14 16H2 M0 0 M17.5 8a2.5 2.5 0 1 1 2 4H2 M0 0 M9.8 4.4A2 2 0 1 1 11 8H2" },
    "Flooding": { label: "Flooding", tone: "weather", lucide: "waves-arrow-up", path: "M0 0 M12 2v8 M0 0 M2 15c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 M0 0 M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 M0 0 m8 6 4-4 4 4" },
    "Avalanche": { label: "Avalanche", tone: "weather", lucide: "mountain-snow", path: "M0 0 m8 3 4 8 5-5 5 15H2L8 3z M0 0 M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19" },
    "Fire": { label: "Fire", tone: "crash", lucide: "flame", path: "M0 0 M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" },
    "Traffic": { label: "Traffic / queue", tone: "closure", lucide: "car", path: "M0 0 M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2 M9 17a2 2 0 1 0 -4 0a2 2 0 1 0 4 0Z M0 0 M9 17h6 M19 17a2 2 0 1 0 -4 0a2 2 0 1 0 4 0Z" },
    "Animal": { label: "Animals on road", tone: "crash", lucide: "paw-print", path: "M13 4a2 2 0 1 0 -4 0a2 2 0 1 0 4 0Z M20 8a2 2 0 1 0 -4 0a2 2 0 1 0 4 0Z M22 16a2 2 0 1 0 -4 0a2 2 0 1 0 4 0Z M0 0 M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z" },
    "Maintenance": { label: "Maintenance", tone: "construction", lucide: "wrench", path: "M0 0 M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" },
    "Weather": { label: "Weather", tone: "weather", lucide: "cloud", path: "M0 0 M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" },
    "Road Hazard": { label: "Road hazard", tone: "crash", lucide: "octagon-alert", path: "M0 0 M12 16h.01 M0 0 M12 8v4 M0 0 M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" },
    "Other": { label: "Other", tone: "other", lucide: "circle-question-mark", path: "M22 12a10 10 0 1 0 -20 0a10 10 0 1 0 20 0Z M0 0 M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M0 0 M12 17h.01" }
  };

  const rules = [
    ["Crash", /\b(?:crash|accident|collision|rollover)\b/],
    ["Maintenance", /\b(?:snow remov(?:al|ing)|snow plow(?:ing)?|snowplow(?:ing)?|plowing|maintenance|striping|mowing|sweeping|paving|its work|fiber optic)\b/],
    ["Construction", /\b(?:construction|road ?works?|bridge work|utility work)\b/],
    ["Disabled Vehicle", /\b(?:(?:disabled|stalled|abandoned|broken down) (?:vehicle|truck|car)|vehicle breakdown)\b/],
    ["Sun Glare", /\b(?:sun ?glare|solar glare|sun blindness)\b/],
    ["Avalanche", /\bavalanche\b/],
    ["Fire", /\b(?:fire|wildfire|vehicle fire)\b/],
    ["Flooding", /\b(?:flood(?:ing|ed)?|high water|standing water)\b/],
    ["Ice", /\b(?:ice|icy|freezing rain|black ice)\b/],
    ["Snow", /\b(?:snow(?:fall|storm|y)?|blizzard|whiteout|winter storm)\b/],
    ["Fog", /\b(?:fog(?:gy)?|smoke|blowing dust|low visibility|reduced visibility)\b/],
    ["Wind", /\b(?:wind|winds|windy|gusts|gusting)\b/],
    ["Debris", /\b(?:debris|rock ?fall|rock ?slide|mud ?slide|landslide|falling rocks?|object on (?:the )?road|spilled load|fallen tree)\b/],
    ["Animal", /\b(?:animals?|wildlife|livestock|deer|elk)\b/],
    ["Road Hazard", /\b(?:road hazard|hazardous materials?|hazmat|potholes?|road damage|sinkhole)\b/]
  ];
  const numericTypes = { 1: "Crash", 2: "Fog", 3: "Weather", 4: "Weather", 5: "Ice", 6: "Traffic",
    7: "Closure", 8: "Closure", 9: "Construction", 10: "Wind", 11: "Flooding", 14: "Disabled Vehicle" };
  const text = value => String(value || "").toLowerCase().replace(/[_–—-]+/g, " ").replace(/\s+/g, " ").trim();
  const specificType = value => rules.find(([, pattern]) => pattern.test(text(value)))?.[0];

  function classify(value) {
    const properties = value && typeof value === "object" ? value : { incidentTypeLabel: value };
    const structured = [properties.incidentTypeLabel, properties.sourceType].filter(Boolean).join(" ");
    const specific = specificType(structured);
    if (specific) return specific;
    const fallback = specificType(properties.normalizedCategory);
    if (fallback) return fallback;
    const numericType = numericTypes[Number(properties.iconCategory ?? value)];
    if (["Crash", "Construction", "Disabled Vehicle"].includes(numericType)) return numericType;
    // A broad provider category can carry its actual cause only in the note.
    // Ignore negated, cleared and precautionary sentences rather than inventing a hazard.
    const notes = [properties.incidentNote, properties.incidentDescription, properties.description]
      .filter(Boolean).join(". ").split(/[.!?;]+/)
      .filter(sentence => !/\b(?:no|not|without|cleared|removed|possible|potential|chance|risk|watch|beware)\b/i.test(sentence));
    for (const note of notes) {
      const cause = specificType(note);
      if (cause) return cause;
    }
    const category = text(structured + " " + (properties.normalizedCategory || ""));
    if (/\b(?:closure|closed)\b/.test(category)) return "Closure";
    if (/\b(?:traffic|congestion|queue|queueing|queuing)\b/.test(category)) return "Traffic";
    if (/\b(?:weather|dangerous conditions|rain|rainfall|thunderstorm)\b/.test(category)) return "Weather";
    return numericType || "Other";
  }

  function label(properties, type = classify(properties)) {
    const source = String(properties?.incidentTypeLabel || properties?.sourceType || "").trim();
    if (specificType(source) === type) return source;
    const normalized = text(source);
    if (type !== "Closure" && /\b(?:closure|closed)\b/.test(normalized)) {
      return `${types[type].label} · ${source}`;
    }
    if (source && !/^(?:other|unknown|incident|weather(?: event| conditions)?|dangerous conditions|traffic|road hazard|incident type \d+)$/.test(normalized)) return source;
    return types[type].label;
  }

  function icon(type) { return types[type] || types.Other; }

  function svg(document, type) {
    const definition = icon(type);
    const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    element.setAttribute("class", `incident-symbol ${definition.tone}-symbol`);
    element.setAttribute("viewBox", "0 0 24 24");
    element.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", definition.path);
    element.appendChild(path);
    return element;
  }

  window.IncidentTypes = Object.freeze({ types, classify, label, icon, svg });
})();
