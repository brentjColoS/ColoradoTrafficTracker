(() => {
  if (window.BrowserMotion) return;
  const key = "ctt-motion-override";
  const device = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const listeners = new Set();
  const savedChoice = () => {
    try { return window.localStorage.getItem(key); } catch { return undefined; }
  };
  let enabled = savedChoice() === "on";
  const preference = {
    get matches() { return device?.matches === true && !enabled; },
    addEventListener(type, callback) { if (type === "change") listeners.add(callback); },
    removeEventListener(type, callback) { if (type === "change") listeners.delete(callback); }
  };
  window.BrowserMotion = { media: () => preference };
  const theme = document.getElementById("themeToggle");
  let button;
  if (theme) {
    const controls = document.createElement("div");
    controls.className = "site-controls";
    theme.before(controls);
    controls.appendChild(theme);
    button = document.createElement("button");
    button.type = "button";
    button.className = "motion-toggle";
    button.setAttribute("data-motion-toggle", "");
    const label = document.createElement("span");
    label.className = "motion-toggle-label";
    label.textContent = "Motion";
    const track = document.createElement("span");
    track.className = "motion-toggle-track";
    track.setAttribute("aria-hidden", "true");
    button.appendChild(label);
    button.appendChild(track);
    controls.appendChild(button);
    button.addEventListener("click", () => {
      if (!device?.matches) return;
      enabled = !enabled;
      try { window.localStorage.setItem(key, enabled ? "on" : "off"); } catch { /* Keep this page's choice. */ }
      apply();
    });
  }
  let previous;
  function apply() {
    const reduced = preference.matches;
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
    if (button) {
      button.hidden = device?.matches !== true;
      button.setAttribute("aria-pressed", String(enabled));
      button.setAttribute("aria-label", enabled ? "Disable motion and follow browser preference" : "Enable motion despite browser reduced-motion preference");
      button.title = enabled ? "Motion enabled for this site. Turn off to follow your browser's reduced-motion setting."
        : "Your browser requests reduced motion. Turn on to enable this site's animations.";
    }
    if (previous !== undefined && previous !== reduced) {
      for (const callback of listeners) callback({matches:reduced, media:"(prefers-reduced-motion: reduce)"});
    }
    previous = reduced;
  }
  device?.addEventListener?.("change", apply);
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    enabled = event.newValue === "on";
    apply();
  });
  window.addEventListener("pageshow", () => {
    const saved = savedChoice();
    if (saved !== undefined) enabled = saved === "on";
    apply();
  });
  apply();
})();
