(() => {
  function storedTheme() {
    try { return window.localStorage.getItem("ctt-dashboard-theme"); }
    catch { return null; }
  }

  function initialize({ toggle, icon, iconPrefix = "", onChange = () => {}, recheckStoredPreference = false }) {
    const stored = storedTheme();
    let followsDevice = stored !== "dark" && stored !== "light";
    const device = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = theme => {
      document.documentElement.dataset.theme = theme;
      const dark = theme === "dark";
      toggle?.setAttribute("aria-pressed", String(dark));
      toggle?.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      icon?.setAttribute("href", `${iconPrefix}#icon-${dark ? "sun" : "moon"}`);
      onChange(theme);
    };
    apply(followsDevice && device?.matches ? "dark" : stored === "dark" ? "dark" : "light");
    device?.addEventListener?.("change", event => {
      // Information pages historically recheck storage, including failed writes.
      const saved = recheckStoredPreference ? storedTheme() : null;
      if (recheckStoredPreference ? saved !== "dark" && saved !== "light" : followsDevice) {
        apply(event.matches ? "dark" : "light");
      }
    });
    toggle?.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      followsDevice = false;
      try { window.localStorage.setItem("ctt-dashboard-theme", next); } catch { /* Keep the choice for this visit. */ }
      apply(next);
    });
  }

  window.BrowserTheme = { initialize };
})();
