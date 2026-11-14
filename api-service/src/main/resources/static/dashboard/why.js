"use strict";
window.BrowserTheme.initialize({
  toggle: document.getElementById("themeToggle"),
  icon: document.getElementById("themeIcon"),
  recheckStoredPreference: true
});
const whyPatterns = [
  {date: "2026-09-02", speeds: [67.5814935238095,67.57557570476189,67.57948748345437,67.59135655555552,67.5814935238095,67.5814935238095,67.5814935238095,67.5814935238095,67.5814935238095], samples: [60,60,59,60,60,60,59,60,60]},
  {date: "2026-09-09", speeds: [67.52733043422107,67.69984990476179,67.69984990476179,67.69984990476179,67.69984990476179,67.69984990476179,67.69984990476179,67.69984990476179,67.69984990476179], samples: [59,60,60,59,60,60,60,59,60]},
  {date: "2026-09-16", speeds: [67.61760225020167,67.69984990476179,67.69195947936495,66.75102625079354,67.69984990476179,67.68801426666656,67.67815123492052,67.59754184665042,67.69195947936495], samples: [59,60,60,60,59,60,60,59,60]},
  {date: "2026-09-20", speeds: [66.72538236825386,58.187942088888825,52.17911567715894,47.711429768253915,45.0355892555555,41.9247890428571,41.59123468280867,44.59471173650788,47.80512856984122], samples: [60,60,59,60,60,60,59,60,60]},
];
const whyPattern = document.getElementById("whyPattern");
const whyTime = document.getElementById("whyPatternTime");
const whyClock = document.getElementById("whyPatternClock");
const whyTakeaway = document.getElementById("whyPatternTakeaway");
const whyExplanation = document.getElementById("whyPatternExplanation");
const whyPlay = document.getElementById("whyPatternPlay");
const whyRows = [...whyPattern.querySelectorAll("[data-pattern]")];
// Shared 40–70 mph scale; hourly means from the archive-inclusive I-70 trends API.
const whyY = value => 40 - (value - 40) * 1.2;
whyRows.forEach((row, index) => {
  const curve = whyPatterns[index].speeds.map((value, point) => `${point ? "L" : "M"}${point * 45},${whyY(value)}`).join(" ");
  row.querySelector(".why-pattern-line").setAttribute("d", curve);
  row.querySelector(".why-pattern-area").setAttribute("d", `${curve} L360,44 L0,44 Z`);
});
function updateWhyPattern() {
  const raw = Number(whyTime.value);
  const index = Number.isFinite(raw) ? Math.max(0, Math.min(8, Math.round(raw))) : 5;
  const hour = 10 + index;
  const period = hour < 12 ? "AM" : "PM";
  const nextPeriod = hour + 1 < 12 ? "AM" : "PM";
  const clock = `${hour % 12 || 12}${period === nextPeriod ? "" : ` ${period}`}–${(hour + 1) % 12 || 12} ${nextPeriod}`;
  whyClock.textContent = clock;
  const states = whyRows.map((row, day) => {
    const value = whyPatterns[day].speeds[index];
    const change = index ? value - whyPatterns[day].speeds[index - 1] : 0;
    const state = index === 0 ? "Start" : change <= -1 ? "Slowing" : change >= 1 ? "Clearing" : value < 55 ? "Slow" : value >= 66 ? "Moving" : "Steady";
    row.dataset.state = state.toLowerCase();
    row.querySelector(".why-pattern-speed").textContent = `${value.toFixed(1)} mph`;
    row.querySelector(".why-pattern-state").textContent = state;
    row.querySelector(".why-pattern-cursor").setAttribute("transform", `translate(${index * 45} 0)`);
    const point = row.querySelector(".why-pattern-point");
    point.setAttribute("cy", whyY(value));
    return `${whyPatterns[day].date}: ${value.toFixed(1)} mph, ${state.toLowerCase()}, ${whyPatterns[day].samples[index]} observations`;
  });
  whyTime.setAttribute("aria-valuetext", `${clock}. ${states.join(". ")}`);
  const message = index === 0
    ? ["Similar at 10 a.m.", "All four hourly averages begin near 67 mph. Their afternoon readings are much less alike."]
    : index <= 3
    ? ["Sunday slows earlier.", "By 1–2 p.m., Sunday’s corridor average is below 48 mph. The Wednesdays remain near 67 mph."]
    : index <= 6
    ? ["Three Wednesdays. A slower Sunday.", "The Wednesday averages stay near 67 mph. Sunday reaches 41.6 mph during the 4–5 p.m. hour."]
    : ["Sunday begins to recover.", "Sunday is clearing, but still below 48 mph at 6–7 p.m. The Wednesdays stay near 68 mph."];
  if (whyTakeaway.textContent !== message[0]) whyTakeaway.textContent = message[0];
  if (whyExplanation.textContent !== message[1]) whyExplanation.textContent = message[1];
}
updateWhyPattern();
const whyReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let whyPlaying = typeof window.IntersectionObserver === "function" && !whyReducedMotion?.matches;
let whyPatternVisible = false;
let whySuspended = false;
let whyDisposed = false;
let whyPlaybackTimer;
const whyTrip = document.getElementById("whyTrip");
const whyVideo = document.getElementById("whyTripVideo");
const whyVideoViewport = document.getElementById("whyTripMedia");
const whyVideoToggle = document.getElementById("whyTripToggle");
const whyVideoSupported = typeof window.IntersectionObserver === "function";
let whyVideoWanted = whyVideoSupported;
let whyVideoVisible = false;
let whyVideoPending = false;
let whyVideoFailed = false;
let whyVideoAttempt = 0;
let whyVideoIdleStill = false;
let whyVideoStillTimer;
whyVideo.controls = false;
function canUseWhyVideo() {
  return whyVideoSupported && whyVideoVisible && !document.hidden && !whySuspended && !whyDisposed
    && !whyReducedMotion?.matches && !whyVideoFailed;
}
function canPlayWhyVideo() { return whyVideoWanted && !whyVideoIdleStill && canUseWhyVideo(); }
function syncWhyVideo() {
  const fallback = !whyVideoSupported || Boolean(whyReducedMotion?.matches) || whyVideoFailed;
  if (whyVideoWanted || whyVideoIdleStill || !canUseWhyVideo()) {
    clearTimeout(whyVideoStillTimer);
    whyVideoStillTimer = undefined;
  } else if (whyVideoStillTimer === undefined) {
    const timer = setTimeout(() => {
      if (whyVideoStillTimer !== timer) return;
      whyVideoStillTimer = undefined;
      if (!whyVideoWanted && canUseWhyVideo()) whyVideoIdleStill = true;
      syncWhyVideo();
    }, 180_000);
    whyVideoStillTimer = timer;
  }
  whyTrip.classList.toggle("is-static", fallback || whyVideoIdleStill);
  whyVideoToggle.hidden = fallback;
  whyVideoToggle.textContent = whyVideoWanted ? "Pause video" : "Play video";
  if (!canPlayWhyVideo()) { ++whyVideoAttempt; whyVideo.pause(); return; }
  if (!whyVideo.paused || whyVideoPending) return;
  whyVideoPending = true;
  const attempt = ++whyVideoAttempt;
  whyVideo.muted = true;
  Promise.resolve(whyVideo.play()).then(() => {
    whyVideoPending = false;
    if (!canPlayWhyVideo()) whyVideo.pause();
    else if (whyVideo.paused && attempt !== whyVideoAttempt) syncWhyVideo();
  }).catch(error => {
    whyVideoPending = false;
    if (!canPlayWhyVideo()) return;
    if (error.name === "AbortError" && attempt !== whyVideoAttempt) { syncWhyVideo(); return; }
    whyVideoWanted = false;
    syncWhyVideo();
  });
}
whyVideoToggle.addEventListener("click", () => { whyVideoIdleStill = false; whyVideoWanted = !whyVideoWanted; syncWhyVideo(); });
whyVideo.addEventListener("error", () => { whyVideoFailed = true; syncWhyVideo(); });
function syncWhyMotion() { syncWhyPlayback(); syncWhyVideo(); }
function syncWhyPlayback() {
  clearTimeout(whyPlaybackTimer);
  whyPlay.disabled = Boolean(whyReducedMotion?.matches) || typeof window.IntersectionObserver !== "function";
  if (whyPlay.disabled) whyPlaying = false;
  const active = whyPlaying && whyPatternVisible && !document.hidden && !whySuspended && !whyDisposed;
  whyPattern.dataset.playing = String(active);
  whyPlay.textContent = whyPlay.disabled ? "Motion off" : whyPlaying ? "Pause" : "Play";
  whyPlay.setAttribute("aria-label", whyPlay.disabled ? "Animation off; use the time slider" : whyPlaying ? "Pause comparison" : "Play comparison");
  if (!active) return;
  whyPlaybackTimer = setTimeout(() => {
    const next = Number(whyTime.value) >= 8 ? 0 : Number(whyTime.value) + 1;
    whyPattern.dataset.rewinding = String(next === 0);
    whyTime.value = String(next);
    updateWhyPattern();
    syncWhyPlayback();
  }, Number(whyTime.value) === 8 ? 4500 : 1800);
}
function pauseWhyPlayback() { whyPlaying = false; syncWhyPlayback(); }
whyTime.addEventListener("input", () => { pauseWhyPlayback(); updateWhyPattern(); });
whyTime.addEventListener("pointerdown", pauseWhyPlayback);
whyTime.addEventListener("focus", pauseWhyPlayback);
whyPlay.addEventListener("click", () => { whyPlaying = !whyPlaying; syncWhyPlayback(); });
document.addEventListener("visibilitychange", syncWhyMotion);
whyReducedMotion?.addEventListener("change", syncWhyMotion);
window.addEventListener("pagehide", event => {
  whySuspended = true;
  whyDisposed = !event.persisted;
  syncWhyMotion();
});
window.addEventListener("pageshow", () => { whySuspended = false; syncWhyMotion(); });
syncWhyMotion();
if (typeof window.IntersectionObserver === "function") {
  const whyMotionObserver = new window.IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.target === whyVideoViewport) { whyVideoVisible = entry.isIntersecting; syncWhyVideo(); }
      if (entry.target === whyPattern) { whyPatternVisible = entry.isIntersecting; syncWhyPlayback(); }
    });
  });
  document.querySelectorAll("[data-why-motion]").forEach(node => whyMotionObserver.observe(node));
  window.addEventListener("pagehide", event => { if (!event.persisted) whyMotionObserver.disconnect(); });
}
