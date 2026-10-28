function initializeHealthMonitors() {
  const roots = [...document.querySelectorAll("[data-health-monitor]")];
  if (!roots.length) return;
  let pageHidden = false;
  let retained = false;
  const observed = new Map(), sampleTimes = new Map();
  const channels = new Map(roots.flatMap(root => [...root.querySelectorAll("[data-health-channel]")]
    .map(card => [card.dataset.healthChannel, {card, root, label: card.querySelector(".health-activity")}])));
  const visible = new Map(roots.map(root => [root, typeof window.IntersectionObserver !== "function"]));
  const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const paused = root => document.hidden || pageHidden || !visible.get(root);
  const reduced = () => motionPreference?.matches === true;
  const pause = root => {
    root.classList.toggle("health-motion-paused", paused(root));
    if (paused(root) || reduced()) for (const channel of channels.values()) if (channel.root === root) channel.card.classList.remove("health-event-active");
  };
  const record = (key, time, label, newSample = false) => {
    const channel = channels.get(key), millis = Date.parse(time);
    if (!channel || retained || !Number.isFinite(millis) || (!newSample && millis <= (observed.get(key) || 0))) return;
    observed.set(key, Math.max(millis, observed.get(key) || 0));
    const display = new Date(millis).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"});
    channel.label.textContent = `${label} · ${display}`;
    channel.label.title = `${label} observed at ${new Date(millis).toISOString()}. This is an observation, not a continuous service probe.`;
    if (!paused(channel.root) && !reduced()) channel.card.classList.add("health-event-active");
  };
  channels.forEach(({card}) => card.addEventListener("animationend", event => {
    if (event.animationName === "health-packet-arrive") card.classList.remove("health-event-active");
  }));
  window.HealthMonitor = {
    setRetained(value) {
      retained = value;
      if (retained) channels.forEach(({card, label}) => { card.classList.remove("health-event-active"); label.textContent = "Live reactions off"; });
    },
    receive(sections, cache) {
      if (retained || pageHidden) return;
      record("api", new Date().toISOString(), "API reply");
      const samples = [];
      for (const [key, section] of Object.entries(sections || {})) {
        if (section.status !== 200) continue;
        if (key.startsWith("/traffic/map/corridors?")) record("routes", section.fetchedAt, "Catalog read");
        if (!key.startsWith("/traffic/summary?")) continue;
        record("database", section.fetchedAt, "Stored read");
        const previous = cache?.get(key);
        const data = section.data ?? (previous?.version === section.version ? previous.data : null);
        const corridor = new URLSearchParams(key.split("?")[1]).get("corridor");
        const time = Date.parse(data?.latest?.polledAt);
        if (!["I25", "I70"].includes(corridor) || !Number.isFinite(time) || time <= (sampleTimes.get(corridor) || 0)) continue;
        sampleTimes.set(corridor, time); samples.push(time);
      }
      if (samples.length) {
        record("ingest", new Date(Math.max(...samples)).toISOString(), "Sample seen", true);
      }
    }
  };
  roots.forEach(pause);
  motionPreference?.addEventListener?.("change", () => roots.forEach(pause));
  const observer = typeof window.IntersectionObserver === "function" ? new window.IntersectionObserver(entries => {
    entries.forEach(entry => { visible.set(entry.target, entry.isIntersecting); pause(entry.target); });
  }, {rootMargin: "48px 0px", threshold: 0}) : null;
  roots.forEach(root => observer?.observe(root));
  document.addEventListener("visibilitychange", () => roots.forEach(pause));
  window.addEventListener("pagehide", event => {
    pageHidden = true;
    roots.forEach(pause);
    if (!event.persisted) observer?.disconnect();
  });
  window.addEventListener("pageshow", () => { pageHidden = false; roots.forEach(pause); });
}

initializeHealthMonitors();
