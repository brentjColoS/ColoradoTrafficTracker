(() => {
  const capturedAt = Date.parse(document.documentElement.dataset.variableLimitDemoAt || "");
  const live = document.documentElement.dataset.variableLimitDemoLive === "true";
  if ((!live && !Number.isFinite(capturedAt)) || !window.VariableSpeedSigns) return;
  const nativeFetch = window.fetch.bind(window);
  let pending, expiresAt = 0;
  function snapshot() {
    if (pending && (!live || Date.now() < expiresAt)) return pending;
    expiresAt = Date.now() + 60_000;
    pending = nativeFetch(live ? "/dashboard-api/traffic/map/variable-speed-limits/current?corridor=I70"
      : "variable-limit-snapshot.json", {cache:"no-store"})
    .then(response => {
      if (!response.ok) throw new Error("Saved sign snapshot unavailable");
      return response.json();
    }).then(data => {
      if (data.corridor !== "I70" || (!live && Date.parse(data.generatedAt) !== capturedAt)) {
        throw new Error("Saved sign snapshot does not match the demo capture");
      }
      const status = live && document.getElementById("variableLimitLiveStatus");
      if (status) status.textContent = data.fetchedAt
        ? `Last successful sign read: ${new Intl.DateTimeFormat(undefined, {hour:"numeric", minute:"2-digit", timeZoneName:"short"}).format(new Date(data.fetchedAt))}. ${data.signs.filter(sign => sign.lastAttemptAt).length} of ${data.signs.length} devices checked.`
        : "Initial sign checks are in progress; unchecked limits remain unavailable.";
      return data;
    }).catch(() => {
      const status = live && document.getElementById("variableLimitLiveStatus");
      if (status) status.textContent = "Live sign read unavailable. Select Sync now to retry.";
      return null;
    });
    return pending;
  }
  const signs = window.VariableSpeedSigns;
  if (!live) window.VariableSpeedSigns = {...signs,
    signs:(data, confirmed) => signs.signs(data, confirmed, capturedAt),
    summary:(data, confirmed) => signs.summary(data, confirmed, capturedAt)};
  window.fetch = async (input, options) => {
    const response = await nativeFetch(input, options);
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.endsWith("/traffic/dashboard/snapshot")
      || url.searchParams.get("historical") === "true" || !response.ok) return response;
    const sections = await response.json();
    const saved = await snapshot();
    sections["/traffic/map/variable-speed-limits/current?corridor=I70"] = {
      status:saved ? 200 : 503, version:live ? `live-signs-${saved?.generatedAt || "unavailable"}` : `saved-signs-${capturedAt}`,
      ...(saved ? {data:saved} : {})};
    return new Response(JSON.stringify(sections), {status:response.status,
      headers:{"Content-Type":"application/json", "Cache-Control":"no-store"}});
  };
})();
