function initializeHealthMonitors() {
  const roots = [...document.querySelectorAll("[data-health-monitor]")];
  if (!roots.length) return;
  let pageHidden = false;
  const visible = new Map(roots.map(root => [root, typeof window.IntersectionObserver !== "function"]));
  const pause = root => root.classList.toggle("health-motion-paused", document.hidden || pageHidden || !visible.get(root));
  roots.forEach(pause);
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
