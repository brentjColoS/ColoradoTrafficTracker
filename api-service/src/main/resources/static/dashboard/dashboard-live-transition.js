(() => {
  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => 1-Math.pow(1-clamp(value),3);
  function create({draw, requestFrame, cancelFrame, now = () => performance.now()}) {
    const routes = new Map();
    let scope, scheduled = null;
    function sample(route) {
      const at = now(), slide = route.slide, reveal = route.reveal;
      const moving = !!slide && at < slide.started+420;
      const growing = !!reveal && at < reveal.started+240;
      return {end: moving ? slide.from+(slide.to-slide.from)*ease((at-slide.started)/420) : route.end,
        incoming:growing ? {...reveal,scale:Math.max(.12,ease((at-reveal.started)/240))} : null,
        active:moving || growing};
    }
    function wake() {
      if (scheduled !== null) return;
      scheduled = requestFrame(() => {
        scheduled = null; draw();
        if ([...routes.values()].some(route=>sample(route).active)) wake();
      });
    }
    function reset() {
      if (scheduled !== null) cancelFrame(scheduled);
      scheduled = null; routes.clear();
    }
    function observe({key,corridor,end,latest,animate}) {
      if (scope !== key) { reset(); scope = key; }
      const previous = routes.get(corridor), at = now();
      if (!previous || !animate || !previous.latest || !latest || end-previous.end > 300000 || end < previous.end-1000) {
        routes.set(corridor,{end,latest}); return;
      }
      const current = sample(previous);
      if (end-previous.end > 1000) {
        previous.slide = {from:current.end,to:end,started:at}; previous.end = end;
      }
      if (latest > previous.latest) {
        previous.reveal = {after:previous.latest,until:latest,
          started:Math.max(at,(previous.slide?.started || 0)+420)};
        previous.latest = latest;
      }
      if (sample(previous).active) wake();
      else { previous.slide = null; previous.reveal = null; previous.end = end; }
    }
    return {observe,reset,frame:corridor=>routes.has(corridor) ? sample(routes.get(corridor)) : null};
  }
  if (typeof window !== "undefined") window.DashboardLiveTransition = {create};
  if (typeof module !== "undefined") module.exports = {create};
})();
