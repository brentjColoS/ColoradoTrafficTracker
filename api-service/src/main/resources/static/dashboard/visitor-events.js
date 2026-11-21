(() => {
  "use strict";
  const endpoint = document.querySelector('meta[name="ctt-visitor-endpoint"]')?.content;
  const prefix = {"/visitor-events":"/dashboard/", "/dashboard-experimental-events":"/dashboard-experimental/"}[endpoint];
  if (!prefix || !window.location.pathname.startsWith(prefix)) return;
  const suffix = window.location.pathname.slice(prefix.length);
  if (!["", "index.html", "system.html", "data.html", "api.html"].includes(suffix)) return;
  const optedOut = () => navigator.globalPrivacyControl === true;
  const key = "ctt-visitor-session:"+prefix, sources = ["resume", "linkedin", "github", "portfolio"];
  const page = window.location.pathname;
  let session, queue = [], timer, pending = false, stopped = false;
  function stop(clearSession = false) {
    stopped = true; queue = []; clearTimeout(timer);
    if (clearSession) try { sessionStorage.removeItem(key); } catch {}
  }
  function allowed() {
    if (optedOut()) stop(true);
    return !stopped;
  }
  if (!allowed()) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved && typeof saved.id === "string" && sources.concat("").includes(saved.source)
        && typeof saved.referrer === "string" && saved.referrer.length <= 100
        && Number.isFinite(saved.last) && Number.isFinite(saved.started)) session = saved;
  } catch { stop(); return; }
  function renew() {
    const now = Date.now(), source = sources.includes(window.CTT_ENTRY_SOURCE) ? window.CTT_ENTRY_SOURCE : "";
    const changed = !session || now-session.last > 1800000 || now-session.started > 86400000
      || now < session.last || source && source !== session.source;
    if (changed) {
      flush(true);
      let referrer = "";
      try { const host = new URL(document.referrer).hostname; if (host !== window.location.hostname) referrer = host.slice(0,100); } catch {}
      session = {id:crypto.randomUUID(), source, referrer, started:now, last:now};
    }
    session.last = now;
    sessionStorage.setItem(key, JSON.stringify(session));
    return changed;
  }
  function envelope(events) {
    return {session:session.id, source:session.source, referrer:session.referrer,
      viewport:{width:Math.max(1,Math.min(10000,Math.round(window.innerWidth))),
                height:Math.max(1,Math.min(10000,Math.round(window.innerHeight)))}, events};
  }
  function flush(unload = false) {
    clearTimeout(timer); timer = null;
    if (!allowed() || !queue.length || pending && !unload) return;
    const body = JSON.stringify(envelope(queue.splice(0,20)));
    if (unload && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(endpoint, new Blob([body], {type:"application/json"}))) return; } catch {}
    }
    pending = true;
    fetch(endpoint, {method:"POST",headers:{"Content-Type":"application/json"},body,
      credentials:"omit",mode:"same-origin",cache:"no-store",keepalive:true})
      .then(response => { if (!response.ok) stop(); })
      .catch(() => stop()).finally(() => {
        pending = false;
        if (queue.length && allowed()) timer = setTimeout(flush,5000);
      });
  }
  function event(action) { return {id:crypto.randomUUID(),at:Date.now(),page,action}; }
  function track(action = "") {
    if (!allowed()) return;
    try {
      const changed = renew();
      if (changed && action) queue.push(event(""));
      if (queue.length < 20) queue.push(event(action));
      if (queue.length === 20 && !pending) flush();
      if (!timer && queue.length) timer = setTimeout(flush,5000);
    } catch { stop(); }
  }
  document.addEventListener("click", click => {
    if (!click.isTrusted || !allowed()) return;
    const node = click.target.closest?.("button,a,summary");
    if (!node || node.disabled) return;
    let action;
    const corridor = node.dataset.corridorFocus, range = node.dataset.hours, view = node.dataset.chartView;
    if (["ALL","I25","I70"].includes(corridor)) action = "corridor:"+corridor;
    else if (["2","6","24","168","720"].includes(range)) action = "range:"+range;
    else if (["overall","zones"].includes(view)) action = "view:"+view;
    else if (node.matches(".incident-details > summary") && !node.parentElement.open) action = "incident:details";
    else if (node.matches(".status-details > summary") && !node.parentElement.open) action = "system:details";
    else if (node.hasAttribute("data-incident-toggle")) action = "incident:all";
    else if (node.closest("#corridorZoneButtons")) action = "zone:select";
    else if (node.id === "zoneFinderToggle") action = "zone-finder:"+(node.getAttribute("aria-pressed")==="true"?"on":"off");
    else if (node.id === "historyScrollToggle") action = "history:scroll-"+(node.getAttribute("aria-pressed")==="true"?"on":"off");
    else if (node.id === "themeToggle") action = "theme:"+(document.documentElement.dataset.theme === "dark"?"dark":"light");
    else action = {historyOlder:"history:older",historyNewer:"history:newer",historyFirst:"history:first",
      historyCurrent:"history:current",refreshButton:"sync:manual",sigmaIncrease:"sigma:wider",sigmaDecrease:"sigma:narrower",
      corridorZoneReset:"zone:reset",incidentLegendToggle:"incident:types",apiCopy:"api:copy",apiHistoryRecipe:"api:recipe"}[node.id];
    if (!action && node.matches("a[href]")) {
      try {
        const url = new URL(node.href);
        if (url.hostname === "github.com" && url.pathname.startsWith("/brentjColoS/ColoradoTrafficTracker")) action = "navigation:github";
        else if (url.origin === window.location.origin && url.pathname !== page) {
          const destination = {"":"dashboard","index.html":"dashboard","system.html":"system","data.html":"data","api.html":"api"}[url.pathname.slice(prefix.length)];
          if (url.pathname.startsWith(prefix) && destination) action = "navigation:"+destination;
        }
      } catch {}
    }
    if (action) track(action);
  });
  // The explorer disables its submit button and prevents submission in its click handler.
  document.addEventListener("click", click => {
    const button = click.target.closest?.("#apiRun");
    if (click.isTrusted && button && !button.disabled) track("api:run");
  }, true);
  document.addEventListener("submit", submit => {
    if (submit.isTrusted && submit.target.id === "apiExplorerForm" && !submit.submitter) track("api:run");
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(true); });
  window.addEventListener("pagehide", () => flush(true));
  window.addEventListener("pageshow", event => { if (event.persisted) track(); });
  track();
})();
