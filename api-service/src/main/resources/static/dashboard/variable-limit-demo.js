(() => {
  const capturedAt = Date.parse(document.documentElement.dataset.variableLimitDemoAt || "");
  if (!Number.isFinite(capturedAt) || !window.VariableSpeedSigns) return;
  const nativeFetch = window.fetch.bind(window);
  const snapshot = nativeFetch("variable-limit-snapshot.json", {cache:"no-store"})
    .then(response => {
      if (!response.ok) throw new Error("Saved sign snapshot unavailable");
      return response.json();
    }).then(data => {
      if (data.corridor !== "I70" || Date.parse(data.generatedAt) !== capturedAt) {
        throw new Error("Saved sign snapshot does not match the demo capture");
      }
      return data;
    }).catch(() => null);
  const signs = window.VariableSpeedSigns;
  window.VariableSpeedSigns = {...signs,
    signs:(data, confirmed) => signs.signs(data, confirmed, capturedAt),
    summary:(data, confirmed) => signs.summary(data, confirmed, capturedAt)};
  window.fetch = async (input, options) => {
    const response = await nativeFetch(input, options);
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.endsWith("/traffic/dashboard/snapshot")
      || url.searchParams.get("historical") === "true" || !response.ok) return response;
    const sections = await response.json();
    const saved = await snapshot;
    sections["/traffic/map/variable-speed-limits/current?corridor=I70"] = {
      status:saved ? 200 : 503, version:`saved-signs-${capturedAt}`, ...(saved ? {data:saved} : {})};
    return new Response(JSON.stringify(sections), {status:response.status,
      headers:{"Content-Type":"application/json", "Cache-Control":"no-store"}});
  };
})();
