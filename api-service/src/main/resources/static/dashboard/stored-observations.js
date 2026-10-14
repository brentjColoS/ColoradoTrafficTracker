function initializeStoredObservations() {
  const panel = document.querySelector("[data-stored-observations]");
  if (!panel) return;
  const cards = [...panel.querySelectorAll("[data-observation-counter]")].map(card => ({
    card, key: card.dataset.observationCounter,
    number: card.querySelector("[data-observation-number]"),
    gain: card.querySelector("[data-observation-gain]"), value: null, frame: null
  }));
  const note = panel.querySelector("[data-observation-note]");
  const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const format = value => value.toLocaleString();
  let visible = typeof window.IntersectionObserver !== "function", lastObserved = -Infinity, pageHidden = false;
  const canAnimate = () => visible && !document.hidden && !pageHidden && !preference?.matches;
  const finish = entry => {
    if (entry.frame !== null) window.cancelAnimationFrame(entry.frame);
    entry.frame = null;
    if (entry.value !== null) entry.number.textContent = format(entry.value);
    entry.card.classList.remove("pipeline-counter-active");
  };
  const settle = () => { if (!canAnimate()) cards.forEach(finish); };
  window.StoredObservations = {
    receive(section, cache) {
      const data = section?.data ?? (section?.version && section.version === cache?.version ? cache.data : null);
      const observed = Date.parse(data?.observedAt);
      const values = {total: data?.total, I25: data?.corridors?.I25, I70: data?.corridors?.I70};
      if (section?.status !== 200 || !Number.isFinite(observed) ||
          !Object.values(values).every(value => Number.isSafeInteger(value) && value >= 0) ||
          values.total !== values.I25 + values.I70) {
        cards.forEach(entry => { finish(entry); entry.number.textContent = "—"; entry.gain.textContent = ""; });
        note.textContent = "Stored observation totals unavailable";
        return;
      }
      if (observed < lastObserved) return;
      const repeated = observed === lastObserved;
      lastObserved = observed;
      note.textContent = data.synthetic === true ? "Demo database totals · Live + archived" : "Live + archived · Tracked corridors";
      note.title = `Database total checked at ${new Date(observed).toISOString()}; not the selected graph window.`;
      cards.forEach(entry => {
        const previous = entry.value, target = values[entry.key];
        if (previous === target && repeated && entry.number.textContent !== "—") return;
        finish(entry);
        entry.value = target;
        entry.number.textContent = format(target);
        entry.number.setAttribute("aria-label", format(target));
        entry.gain.textContent = previous !== null && target > previous ? `+${format(target - previous)} added` : "";
        if (previous === null || target <= previous || !canAnimate()) return;
        entry.number.textContent = format(previous);
        entry.card.classList.add("pipeline-counter-active");
        let start;
        const tick = time => {
          if (!canAnimate()) { finish(entry); return; }
          start ??= time;
          const progress = Math.min(1, (time - start) / 900);
          entry.number.textContent = format(previous + Math.floor((target - previous) * progress));
          if (progress < 1) entry.frame = window.requestAnimationFrame(tick);
          else finish(entry);
        };
        entry.frame = window.requestAnimationFrame(tick);
      });
    }
  };
  const observer = typeof window.IntersectionObserver === "function" ? new window.IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting); settle();
  }, {threshold: 0}) : null;
  observer?.observe(panel);
  preference?.addEventListener?.("change", settle);
  document.addEventListener("visibilitychange", settle);
  window.addEventListener("pagehide", event => { pageHidden = true; settle(); if (!event.persisted) observer?.disconnect(); });
  window.addEventListener("pageshow", () => { pageHidden = false; settle(); });
}

initializeStoredObservations();
