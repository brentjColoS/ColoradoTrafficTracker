(() => {
  function create({ displayTimeFormatter }) {
    const DISPLAY_DAY_CACHE = new Map();

    function buildTimeAxisTicks(startTime, endTime, plotWidth, resolutionHours = null) {
      const selectedHours = resolutionHours ?? Math.max(1, (endTime - startTime) / 3_600_000);
      const desiredLabels = Math.max(2, Math.floor(plotWidth / 90));
      const ticks = new Map();
      const addTick = (timestamp, level, label = "", guide = false) => {
        ticks.set(timestamp, {
          timestamp,
          horizontalPosition: plotWidth * (timestamp - startTime) / Math.max(1, endTime - startTime),
          level,
          label,
          guide
        });
      };

      if (selectedHours <= 24) {
        const minorMinutes = selectedHours <= 6
          ? plotWidth / (selectedHours * 4) >= 8 ? 15 : 30
          : plotWidth / (selectedHours * 2) >= 10 ? 30 : 60;
        const mediumMinutes = selectedHours <= 6 ? 30 : 60;
        const labelMinutes = selectedHours <= 2 ? 30 * Math.ceil(4 / desiredLabels)
          : 60 * chooseTimeStep(selectedHours / desiredLabels, 1);
        const minorMs = minorMinutes * 60_000;
        for (let timestamp = Math.ceil(startTime / minorMs) * minorMs; timestamp <= endTime; timestamp += minorMs) {
          const major = timestamp % (labelMinutes * 60_000) === 0;
          const medium = timestamp % (mediumMinutes * 60_000) === 0;
          addTick(timestamp, major ? "major" : medium ? "medium" : "minor",
            major ? formatChartTime(timestamp, selectedHours) : "", major);
        }
      } else {
        if (selectedHours <= 168) {
          const tickHours = [6, 12, 24].find(hours => plotWidth / (selectedHours / hours) >= 9) || 24;
          const tickMs = tickHours * 3_600_000;
          for (let timestamp = Math.ceil(startTime / tickMs) * tickMs; timestamp <= endTime; timestamp += tickMs) {
            addTick(timestamp, "minor");
          }
        }
        const days = displayDayTransitions(startTime, endTime);
        const dailyTickEvery = selectedHours <= 168 ? 1 : Math.max(1, Math.ceil(8 * days.length / plotWidth));
        const labelEvery = Math.max(1, Math.ceil(days.length / desiredLabels / dailyTickEvery) * dailyTickEvery);
        days.forEach((timestamp, index) => {
          const major = index % labelEvery === 0;
          const label = selectedHours <= 168
            ? displayTimeFormatter({ weekday: "short", day: "numeric" }).format(new Date(timestamp))
            : formatChartTime(timestamp, selectedHours);
          if (selectedHours <= 168 || index % dailyTickEvery === 0 || major) {
            addTick(timestamp, selectedHours <= 168 || major ? "major" : "medium",
              major ? label : "", selectedHours <= 168 || major);
          }
        });
      }
      return [...ticks.values()].sort((left, right) => left.timestamp - right.timestamp);
    }

    function displayDayTransitions(startTime, endTime) {
      const hourMs = 3_600_000;
      const days = [];
      for (let timestamp = Math.floor(startTime / hourMs) * hourMs; timestamp <= endTime + hourMs; timestamp += hourMs) {
        if (!DISPLAY_DAY_CACHE.has(timestamp)) {
          const formatter = displayTimeFormatter({ year: "numeric", month: "numeric", day: "numeric" });
          const day = formatter.format(new Date(timestamp));
          let boundary = null;
          if (formatter.format(new Date(timestamp - hourMs)) !== day) {
            let earlier = timestamp - hourMs, later = timestamp;
            while (later - earlier > 60_000) {
              const midpoint = Math.floor((earlier + later) / 120_000) * 60_000;
              if (formatter.format(new Date(midpoint)) === day) later = midpoint;
              else earlier = midpoint;
            }
            boundary = later;
          }
          DISPLAY_DAY_CACHE.set(timestamp, boundary);
          while (DISPLAY_DAY_CACHE.size > 4096) DISPLAY_DAY_CACHE.delete(DISPLAY_DAY_CACHE.keys().next().value);
        }
        const midnight = DISPLAY_DAY_CACHE.get(timestamp);
        if (midnight !== null && midnight >= startTime && midnight <= endTime) days.push(midnight);
      }
      return days;
    }

    function chooseTimeStep(idealHours, minimumHours) {
      const steps = [1, 2, 3, 4, 6, 12, 24, 48, 72, 168];
      return steps.find(step => step >= idealHours && step >= minimumHours) || Math.ceil(idealHours / 168) * 168;
    }

    function formatChartTime(timestamp, selectedHours) {
      const date = new Date(timestamp);
      if (selectedHours <= 24) {
        const parts = Object.fromEntries(displayTimeFormatter({ hour: "numeric", minute: "numeric", hourCycle: "h23" })
          .formatToParts(date).map(part => [part.type, part.value]));
        if (Number(parts.minute) !== 0) {
          return displayTimeFormatter({ hour: "numeric", minute: "2-digit" }).format(date);
        }
        const localHour = Number(parts.hour);
        if (localHour === 0) {
          return displayTimeFormatter({ month: "short", day: "numeric" }).format(date);
        }
        return displayTimeFormatter({ hour: "numeric" }).format(date);
      }
      if (selectedHours <= 168) {
        return displayTimeFormatter({ weekday: "short", hour: "numeric" }).format(date);
      }
      return displayTimeFormatter({ month: "short", day: "numeric" }).format(date);
    }

    return { buildTimeAxisTicks, displayDayTransitions, chooseTimeStep, formatChartTime };
  }

  window.DashboardChartAxis = { create };
})();
