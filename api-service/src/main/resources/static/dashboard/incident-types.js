(function () {
  "use strict";

  const types = {
    Crash: { label: "Crash", tone: "crash", path: "M12 3 22 21H2Z M12 9v5 M12 17v.1" },
    Construction: { label: "Construction", tone: "construction", path: "M3 6h18v8H3Z M7 3v3 M17 3v3 M7 14v7 M17 14v7 M3 6l8 8 M11 6l8 8" },
    Closure: { label: "Closure", tone: "closure", path: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M7 12h10" },
    "Disabled Vehicle": { label: "Disabled vehicle", tone: "vehicle", path: "M5 10 8 5h8l3 5 M3 10h18v8H3Z M5 18v3 M19 18v3 M7 14h1 M16 14h1" },
    "Sun Glare": { label: "Sun glare", tone: "construction", path: "M16 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 1v2 M4 9H2 M22 9h-2 M5 2l2 2 M19 2l-2 2 M2 17h20 M5 21h14" },
    Snow: { label: "Snow", tone: "weather", path: "M12 2v20 M3.3 7l17.4 10 M3.3 17 20.7 7 M9 4l3 3 3-3 M9 20l3-3 3 3 M4 10l4-1-1-4 M17 19l-1-4 4-1 M4 14l4 1-1 4 M17 5l-1 4 4 1" },
    Ice: { label: "Ice", tone: "weather", path: "M12 2v12 M7 5l10 6 M7 11l10-6 M9 3l3 3 3-3 M3 17q4-4 9 0t9 0 M3 22q4-4 9 0t9 0" },
    Debris: { label: "Debris", tone: "crash", path: "M3 20h18 M4 16l3-7 5 7Z M14 16l2-4 4 4Z M13 4l3 2-2 3-3-2Z" },
    Fog: { label: "Fog / smoke", tone: "weather", path: "M4 8h16 M2 12h14 M7 16h15 M3 20h15 M19 12h2" },
    Wind: { label: "High wind", tone: "weather", path: "M2 8h12a3 3 0 1 0-3-3 M2 12h17a3 3 0 1 1-3 3 M2 17h7a2 2 0 1 1-2 2" },
    Rain: { label: "Rain", tone: "weather", path: "M6 12a4 4 0 1 1 1-8 5 5 0 0 1 9 1 3.5 3.5 0 1 1 2 7Z M7 16l-2 4 M13 16l-2 4 M19 16l-2 4" },
    Flooding: { label: "Flooding", tone: "weather", path: "M3 10l9-7 9 7 M6 8v7 M18 8v7 M2 17q3-3 6 0t6 0 6 0 M2 22q3-3 6 0t6 0 6 0" },
    Rockfall: { label: "Rockfall", tone: "crash", path: "M2 21 8 3h3l-1 8 4 10 M14 6l3-2 2 4-3 2Z M17 14l3-2 2 4-3 2Z" },
    Avalanche: { label: "Avalanche", tone: "weather", path: "M2 21 10 3l5 9 M7 10l3 3 3-3 M13 16l3-2 3 3-2 3-4-1Z M20 9v2 M20 5v1 M19 22h3" },
    Fire: { label: "Fire", tone: "crash", path: "M12 2c2 6-3 7-2 10 3-1 5-4 5-6 7 8 7 16-3 16C3 22 1 15 6 9c-1 5 1 6 2 6-1-5 4-7 4-13Z" },
    Traffic: { label: "Traffic / queue", tone: "closure", path: "M3 3h10v6H3Z M5 9v2 M11 9v2 M11 14h10v6H11Z M13 20v2 M19 20v2 M17 3h4v6 M3 16v5h4" },
    Animal: { label: "Animals on road", tone: "crash", path: "M9 15c1-4 5-4 6 0l3 4c1 4-4 3-6 2-2 1-7 2-6-2Z M5 11a2 3 0 1 1 0-6 2 3 0 0 1 0 6 M10 8a2 3 0 1 1 0-6 2 3 0 0 1 0 6 M16 8a2 3 0 1 1 0-6 2 3 0 0 1 0 6 M21 12a2 3 0 1 1 0-6 2 3 0 0 1 0 6" },
    Maintenance: { label: "Maintenance", tone: "construction", path: "M14 6a5 5 0 0 0-6 6l-6 6 4 4 6-6a5 5 0 0 0 6-6l-4 3-3-3Z M19 2v4 M17 4h4" },
    Restrictions: { label: "Traction / chain law", tone: "weather", path: "M9 4 4 9a4 4 0 0 0 6 6l3-3 M15 20l5-5a4 4 0 0 0-6-6l-3 3 M8 16l8-8" },
    Weather: { label: "Weather", tone: "weather", path: "M5 14a4 4 0 1 1 1-8 5 5 0 0 1 9 1 3.5 3.5 0 1 1 2 7Z M8 18v3 M14 18v3" },
    "Road Hazard": { label: "Road hazard", tone: "crash", path: "M3 22 8 2 M21 22 16 2 M12 3v3 M12 10v3 M10 18h4 M12 16v4" },
    Other: { label: "Other incident", tone: "other", path: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M9 8a3 3 0 0 1 6 1c0 2-3 2-3 5 M12 18v.1" }
  };

  const rules = [
    ["Crash", /\b(?:crash|accident|collision|rollover)\b/],
    ["Maintenance", /\b(?:snow remov(?:al|ing)|snow plow(?:ing)?|snowplow(?:ing)?|plowing|maintenance|striping|mowing|sweeping|paving|its work|fiber optic)\b/],
    ["Construction", /\b(?:construction|road ?works?|bridge work|utility work)\b/],
    ["Disabled Vehicle", /\b(?:(?:disabled|stalled|abandoned|broken down) (?:vehicle|truck|car)|vehicle breakdown)\b/],
    ["Sun Glare", /\b(?:sun ?glare|solar glare|sun blindness)\b/],
    ["Restrictions", /\b(?:chain (?:law|requirement|restriction)s?|traction (?:law|requirement|restriction)s?)\b/],
    ["Avalanche", /\bavalanche\b/],
    ["Rockfall", /\b(?:rock ?fall|rock ?slide|mud ?slide|landslide|falling rocks?)\b/],
    ["Fire", /\b(?:fire|wildfire|vehicle fire)\b/],
    ["Flooding", /\b(?:flood(?:ing|ed)?|high water|standing water)\b/],
    ["Ice", /\b(?:ice|icy|freezing rain|black ice)\b/],
    ["Snow", /\b(?:snow(?:fall|storm|y)?|blizzard|whiteout|winter storm)\b/],
    ["Fog", /\b(?:fog(?:gy)?|smoke|blowing dust|low visibility|reduced visibility)\b/],
    ["Wind", /\b(?:wind|winds|windy|gusts|gusting)\b/],
    ["Rain", /\b(?:rain|rainfall|heavy rain|thunderstorm)\b/],
    ["Debris", /\b(?:debris|object on (?:the )?road|spilled load|fallen tree)\b/],
    ["Animal", /\b(?:animals?|wildlife|livestock|deer|elk)\b/],
    ["Road Hazard", /\b(?:road hazard|hazardous materials?|hazmat|potholes?|road damage|sinkhole)\b/]
  ];
  const numericTypes = { 1: "Crash", 2: "Fog", 3: "Weather", 4: "Rain", 5: "Ice", 6: "Traffic",
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
    if (/\b(?:weather|dangerous conditions)\b/.test(category)) return "Weather";
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
