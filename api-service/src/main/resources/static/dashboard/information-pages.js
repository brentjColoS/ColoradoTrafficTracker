const informationElements = {
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  architectureStage: document.getElementById("systemArchitecture"),
  systemOverview: document.getElementById("systemOverview"),
  systemState: document.getElementById("systemState"),
  systemStatusTitle: document.getElementById("systemStatusTitle"),
  systemSummary: document.getElementById("systemSummary"),
  systemCheckedAt: document.getElementById("systemCheckedAt"),
  operationalChecks: document.getElementById("operationalChecks"),
  statusRefresh: document.getElementById("statusRefresh")
};

initializeInformationPage();

function initializeInformationPage() {
  initializeInformationTheme();
  initializeArchitectureHighlights();
  if (!informationElements.systemOverview) return;
  informationElements.statusRefresh?.addEventListener("click", () => void loadOperationalStatus());
  void loadOperationalStatus();
}

function initializeArchitectureHighlights() {
  const stage = informationElements.architectureStage;
  if (!stage || typeof document.querySelectorAll !== "function") return;

  const items = [...document.querySelectorAll("[data-architecture-flow]")];
  const sources = items.filter(item => item.matches?.("[tabindex]"));
  const flowTokens = item => String(item.dataset.architectureFlow || "").split(/\s+/).filter(Boolean);

  const showFlow = source => {
    const primaryFlow = source.dataset.architecturePrimary || flowTokens(source)[0] || "";
    const activeTokens = new Set(String(primaryFlow).split(/\s+/).filter(Boolean));
    stage.classList.add("has-active-flow");
    for (const item of items) {
      const related = flowTokens(item).some(token => activeTokens.has(token));
      item.classList.toggle("is-related", related);
      item.classList.toggle("is-muted", !related);
    }
  };

  const clearFlow = () => {
    stage.classList.remove("has-active-flow");
    for (const item of items) item.classList.remove("is-related", "is-muted");
  };

  for (const source of sources) {
    source.addEventListener("pointerenter", () => showFlow(source));
    source.addEventListener("pointerleave", clearFlow);
    source.addEventListener("focus", () => showFlow(source));
    source.addEventListener("blur", clearFlow);
  }
}

function informationRuntime(pathname) {
  const experimental = pathname === "/dashboard-experimental"
    || String(pathname || "").startsWith("/dashboard-experimental/");
  return { apiBase: experimental ? "/dashboard-experimental-api" : "/dashboard-api" };
}

function initializeInformationTheme() {
  let storedTheme;
  try { storedTheme = window.localStorage.getItem("ctt-dashboard-theme"); } catch { /* Storage can be disabled. */ }
  const deviceTheme = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const followsDeviceTheme = storedTheme !== "dark" && storedTheme !== "light";
  applyInformationTheme(followsDeviceTheme && deviceTheme?.matches ? "dark" : storedTheme === "dark" ? "dark" : "light");

  deviceTheme?.addEventListener?.("change", event => {
    let savedTheme;
    try { savedTheme = window.localStorage.getItem("ctt-dashboard-theme"); } catch { /* Keep the current theme. */ }
    if (savedTheme !== "dark" && savedTheme !== "light") {
      applyInformationTheme(event.matches ? "dark" : "light");
    }
  });

  informationElements.themeToggle?.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { window.localStorage.setItem("ctt-dashboard-theme", nextTheme); } catch { /* Theme still works for this visit. */ }
    applyInformationTheme(nextTheme);
  });
}

function applyInformationTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const darkMode = theme === "dark";
  informationElements.themeToggle?.setAttribute("aria-pressed", String(darkMode));
  informationElements.themeToggle?.setAttribute("aria-label", darkMode ? "Switch to light mode" : "Switch to dark mode");
  informationElements.themeIcon?.setAttribute("href", darkMode ? "#icon-sun" : "#icon-moon");
}

async function loadOperationalStatus() {
  const runtime = informationRuntime(window.location.pathname);
  informationElements.statusRefresh.disabled = true;
  try {
    const response = await window.fetch(`${runtime.apiBase}/system/operational-status`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`status endpoint returned HTTP ${response.status}`);
    renderOperationalStatus(await response.json());
  } catch (error) {
    renderStatusUnavailable(error);
  } finally {
    informationElements.statusRefresh.disabled = false;
  }
}

function renderOperationalStatus(status) {
  const overall = normalizedStatus(status?.status);
  informationElements.systemOverview.dataset.status = overall;
  informationElements.systemState.textContent = statusLabel(overall);
  informationElements.systemStatusTitle.textContent = overall === "HEALTHY"
    ? "Current data services are healthy"
    : overall === "DEGRADED" ? "Current data services are degraded"
      : "Current traffic ingest is out of service";
  informationElements.systemSummary.textContent = status?.summary || "The service returned no overall explanation.";
  informationElements.systemCheckedAt.textContent = status?.checkedAt
    ? `Checked ${formatStatusTime(status.checkedAt)}` : "Check time was not provided.";

  const checks = Array.isArray(status?.checks) ? status.checks : [];
  informationElements.operationalChecks.replaceChildren();
  if (checks.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No component checks were returned. Refresh the status or inspect the operational-status endpoint.";
    informationElements.operationalChecks.appendChild(empty);
    return;
  }
  for (const check of checks) {
    informationElements.operationalChecks.appendChild(buildOperationalCheck(check));
  }
}

function buildOperationalCheck(check) {
  const status = normalizedStatus(check?.status);
  const card = document.createElement("article");
  card.className = "operational-check";
  card.dataset.status = status;

  const heading = document.createElement("div");
  heading.className = "check-heading";
  const title = document.createElement("h3");
  title.textContent = componentLabel(check?.component);
  const state = document.createElement("span");
  state.className = "check-state";
  state.textContent = statusLabel(status);
  heading.append(title, state);

  const message = document.createElement("p");
  message.className = "check-message";
  message.textContent = check?.message || "This check did not provide an explanation.";
  card.append(heading, message);

  const meta = checkMetadata(check);
  if (meta) card.appendChild(meta);
  if (status !== "HEALTHY") card.appendChild(checkAction(check?.suggestedAction));
  return card;
}

function checkMetadata(check) {
  const values = [];
  if (check?.code) values.push(String(check.code).replaceAll("_", " ").toLowerCase());
  if (Number.isFinite(check?.ageMinutes)) values.push(`${check.ageMinutes} min old`);
  if (Number.isFinite(check?.thresholdMinutes)) values.push(`${check.thresholdMinutes} min threshold`);
  if (values.length === 0 && check?.observedAt) values.push(`observed ${formatStatusTime(check.observedAt)}`);
  if (values.length === 0) return null;
  const meta = document.createElement("p");
  meta.className = "check-meta";
  meta.textContent = values.join(" · ");
  return meta;
}

function checkAction(suggestedAction) {
  const action = document.createElement("p");
  action.className = "check-action";
  const label = document.createElement("strong");
  label.textContent = "Next action: ";
  action.append(label, document.createTextNode(suggestedAction
    || "Review this component’s current ingest logs; no specific recovery action was returned."));
  return action;
}

function renderStatusUnavailable(error) {
  informationElements.systemOverview.dataset.status = "UNAVAILABLE";
  informationElements.systemState.textContent = "Status unavailable";
  informationElements.systemStatusTitle.textContent = "The operational status could not be loaded";
  informationElements.systemSummary.textContent = "This page could not reach the status endpoint. That connection failure does not by itself mean traffic ingestion is down.";
  informationElements.systemCheckedAt.textContent = "Refresh this page or check the operational-status endpoint directly.";
  informationElements.operationalChecks.replaceChildren();
  const detail = document.createElement("p");
  detail.textContent = error?.message
    ? `Status request failed: ${error.message}.` : "The status request failed without an error message.";
  informationElements.operationalChecks.appendChild(detail);
}

function normalizedStatus(value) {
  const status = String(value || "").toUpperCase();
  return ["HEALTHY", "DEGRADED", "OUT_OF_SERVICE"].includes(status) ? status : "DEGRADED";
}

function statusLabel(status) {
  if (status === "OUT_OF_SERVICE") return "Out of service";
  return status === "HEALTHY" ? "Healthy" : "Degraded";
}

function componentLabel(component) {
  const [type, name] = String(component || "unknown").split(":", 2);
  if (type === "flow") return `${name || "Corridor"} traffic flow`;
  if (type === "incidents") return "CDOT incidents";
  if (type === "provider") return "TomTom provider";
  if (type === "database") return "Traffic database";
  return String(component || "Unknown component").replaceAll("_", " ");
}

function formatStatusTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "at an unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
