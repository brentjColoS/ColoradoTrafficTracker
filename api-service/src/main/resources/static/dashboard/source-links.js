(() => {
  "use strict";
  try {
    const url = new URL(window.location.href);
    const source = url.searchParams.get("src");
    if (!["resume", "linkedin", "github", "portfolio"].includes(source)) return;
    window.CTT_ENTRY_SOURCE = source;
    url.searchParams.delete("src");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    // A restricted History API must not prevent the page from loading.
  }
})();
