function flowDiagramPath(root, markers) {
  if (!Number.isFinite(root.width) || !Number.isFinite(root.height) || root.width <= 0 || root.height <= 0
      || markers.length < 2) return null;
  const points = markers.map(marker => [marker.left - root.left + marker.width / 2,
    marker.top - root.top + marker.height / 2]);
  if (points.some(point => point.some(value => !Number.isFinite(value)))) return null;
  const format = point => point.map(value => Number(value.toFixed(2))).join(" ");
  let path = `M ${format(points[0])}`;
  for (let index = 1; index < points.length; index++) {
    const [x, y] = points[index - 1], [nextX, nextY] = points[index];
    const horizontal = Math.abs(nextX - x) >= Math.abs(nextY - y);
    const bend = Math.min(24, (horizontal ? Math.abs(nextX - x) : Math.abs(nextY - y)) / 4);
    const controls = horizontal
      ? [[x + (nextX - x) / 3, y + bend], [nextX - (nextX - x) / 3, nextY + bend]]
      : [[x - bend, y + (nextY - y) / 3], [nextX - bend, nextY - (nextY - y) / 3]];
    path += ` C ${controls.map(format).join(" ")} ${format(points[index])}`;
  }
  return path;
}

function initializeFlowDiagrams() {
  const roots = [...document.querySelectorAll("[data-flow-diagram]")];
  if (!roots.length) return;
  let hidden = false;
  const components = roots.map(root => {
    const markers = [...root.querySelectorAll(".flow-station")];
    const track = root.querySelector(".flow-track");
    const links = [...(track?.querySelectorAll(".flow-link") || [])];
    const car = root.querySelector(".flow-scene-car:not(.flow-oncoming-car)");
    const chooseScene = () => root.classList.toggle("has-collision", Math.random() < .1);
    const nextScene = event => {
      if (event.target === car && ["flow-car-observation", "flow-car-collision"].includes(event.animationName)) chooseScene();
    };
    if (car) { chooseScene(); car.addEventListener("animationiteration", nextScene); }
    let frame = null, previous = "", visible = typeof window.IntersectionObserver !== "function";
    const pause = () => root.classList.toggle("motion-paused", document.hidden || hidden || !visible);
    const layout = () => {
      frame = null;
      if (hidden || document.hidden) return;
      const bounds = root.getBoundingClientRect();
      const positions = markers.map(marker => marker.getBoundingClientRect());
      const paths = positions.slice(1).map((position, index) => flowDiagramPath(bounds, [positions[index], position]));
      if (!paths.length || paths.some(path => !path) || !track) return;
      const signature = `${bounds.width}|${bounds.height}|${paths.join("|")}`;
      if (signature === previous) return;
      previous = signature;
      track.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
      paths.forEach((path, index) => {
        links[index]?.setAttribute("d", path);
        root.style.setProperty(`--flow-link-${index}`, `path("${path}")`);
      });
      const last = positions[positions.length - 1], prior = positions[positions.length - 2];
      const dx = Math.abs(last.left + last.width / 2 - prior.left - prior.width / 2);
      const dy = Math.abs(last.top + last.height / 2 - prior.top - prior.height / 2);
      root.style.setProperty("--flow-window-width", `${dx >= dy ? Math.max(56, Math.min(94, dx - 76)) : 70}px`);
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
      disconnect() { resize?.disconnect(); car?.removeEventListener("animationiteration", nextScene); }};
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
