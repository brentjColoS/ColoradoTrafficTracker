function flowDiagramPath(root, markers) {
  if (!Number.isFinite(root.width) || !Number.isFinite(root.height) || root.width <= 0 || root.height <= 0
      || markers.length < 2) return null;
  const points = markers.map(marker => [marker.left - root.left + marker.width / 2,
    marker.top - root.top + marker.height / 2]);
  if (points.some(point => point.some(value => !Number.isFinite(value)))) return null;
  return points.map((point, index) => `${index ? "L" : "M"} ${point.map(value => Number(value.toFixed(2))).join(" ")}`).join(" ");
}

function initializeFlowDiagrams() {
  const roots = [...document.querySelectorAll("[data-flow-diagram]")];
  if (!roots.length) return;
  let hidden = false;
  const components = roots.map(root => {
    const markers = [...root.querySelectorAll(".flow-step-number")];
    const track = root.querySelector(".flow-track");
    const line = track?.querySelector("path");
    let frame = null, previous = "", visible = typeof window.IntersectionObserver !== "function";
    const pause = () => root.classList.toggle("motion-paused", document.hidden || hidden || !visible);
    const layout = () => {
      frame = null;
      if (hidden || document.hidden) return;
      const bounds = root.getBoundingClientRect();
      const path = flowDiagramPath(bounds, markers.map(marker => marker.getBoundingClientRect()));
      if (!path || !line) return;
      const signature = `${bounds.width}|${bounds.height}|${path}`;
      if (signature === previous) return;
      previous = signature;
      track.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
      line.setAttribute("d", path);
      root.style.setProperty("--flow-path", `path("${path}")`);
    };
    const schedule = () => {
      if (frame === null && !hidden && !document.hidden) frame = window.requestAnimationFrame(layout);
    };
    pause(); schedule();
    const resize = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(schedule) : null;
    resize?.observe(root);
    markers.forEach(marker => resize?.observe(marker));
    return {root, schedule, pause, visibility(value) { visible = value; pause(); },
      stop() { if (frame !== null) window.cancelAnimationFrame(frame); frame = null; },
      disconnect() { resize?.disconnect(); }};
  });
  const observer = typeof window.IntersectionObserver === "function" ? new window.IntersectionObserver(entries => {
    entries.forEach(entry => components.find(component => component.root === entry.target)?.visibility(entry.isIntersecting));
  }, {rootMargin:"48px 0px",threshold:0}) : null;
  components.forEach(component => observer?.observe(component.root));
  const resume = () => components.forEach(component => { component.pause(); component.schedule(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) components.forEach(component => { component.pause(); component.stop(); });
    else resume();
  });
  window.addEventListener("resize", () => components.forEach(component => component.schedule()));
  window.addEventListener("pagehide", event => {
    hidden = true;
    components.forEach(component => { component.pause(); component.stop(); if (!event.persisted) component.disconnect(); });
    if (!event.persisted) observer?.disconnect();
  });
  window.addEventListener("pageshow", () => { hidden = false; resume(); });
  document.fonts?.ready?.then(resume);
}

initializeFlowDiagrams();
