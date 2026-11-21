(() => {
  function create({read, repaint, timers = window}) {
    let cached = null, pending = null, controller = null, timer = null, retryAt = 0, revision = 0;
    let periods = [], status = "idle";
    const stop = () => {
      timers.clearTimeout(timer); timer = null; controller?.abort(); controller = null; pending = null;
    };
    function ensure(active, start, end) {
      if (!active) {
        stop(); cached = null;
        if (periods.length || status !== "idle") { periods = []; status = "idle"; revision++; }
        return;
      }
      const finish = Math.floor(end/60_000)*60_000;
      const hours = Math.min(720, Math.max(1, Math.ceil((end-start)/3_600_000)));
      const key = `${hours}|${finish}`;
      if (cached?.key === key || pending === key) return;
      if (Date.now() < retryAt) { periods = []; status = "unavailable"; return; }
      stop(); cached = null; periods = []; revision++; status = "loading"; pending = key;
      timer = timers.setTimeout(async () => {
        timer = null;
        const request = new AbortController(); controller = request;
        try {
          const history = await read(hours, finish, request.signal);
          if (request.signal.aborted) return;
          if (history?.corridor !== "I70" || !Array.isArray(history.observations)
              || history.observations.length > 6000 || Math.abs(Date.parse(history.end)-finish) > 1000
              || Math.abs(Date.parse(history.start)-(finish-hours*3_600_000)) > 1000) throw new Error("Invalid sign history");
          periods = window.VariableSpeedSigns.historyPeriods(history);
          cached = {key}; status = history.observations.length ? "ready" : "empty";
        } catch (error) {
          if (request.signal.aborted) return;
          periods = []; status = "unavailable"; retryAt = Date.now()+60_000;
        } finally {
          if (controller === request) {
            controller = null; pending = null; revision++; repaint();
          }
        }
      }, 220);
    }
    return {ensure, stop, get periods() { return periods; }, get status() { return status; }, get revision() { return revision; }};
  }
  if (typeof window !== "undefined") window.VariableSpeedHistory = {create};
  if (typeof module !== "undefined") module.exports = {create};
})();
