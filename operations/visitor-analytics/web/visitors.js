"use strict";
const $ = (id) => document.getElementById(id);
const themeKey = "ctt-dashboard-theme";
const deviceTheme = window.matchMedia("(prefers-color-scheme: dark)");
let savedTheme;
try {
  savedTheme = localStorage.getItem(themeKey);
} catch {}
let followsDevice = !["light", "dark"].includes(savedTheme);
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("themeToggle").setAttribute("aria-pressed", String(theme === "dark"));
  $("themeToggle").setAttribute(
    "aria-label",
    `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
  );
}
applyTheme(
  followsDevice ? (deviceTheme.matches ? "dark" : "light") : savedTheme,
);
$("themeToggle").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  followsDevice = false;
  applyTheme(theme);
  try {
    localStorage.setItem(themeKey, theme);
  } catch {}
});
deviceTheme.addEventListener("change", (event) => {
  if (followsDevice) applyTheme(event.matches ? "dark" : "light");
});
const state = {
  days: 7,
  category: "external",
  data: null,
  request: null,
  rowLimit: 25,
  cursor: "",
};
const names = {
  external: "External",
  home: "Home",
  automation: "Likely bots",
  all: "All traffic",
};
const pages = {
  "/dashboard/": "Dashboard",
  "/dashboard/system.html": "System",
  "/dashboard/data.html": "About the data",
  "/dashboard/api.html": "API",
};
const number = (value) => Number(value || 0).toLocaleString();
const date = (value) => new Date(value * 1000);
const clock = (value) =>
  date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (value) =>
  date(value).toLocaleDateString([], { month: "short", day: "numeric" });
function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function rank(id, values, total, labels = {}) {
  const nodes = values.map((item) => {
    const row = element("div", "", "rank-row"),
      label = element("div", "", "rank-label");
    label.append(
      element("span", labels[item.label] || item.label),
      element("strong", number(item.count)),
    );
    const track = element("div", "", "track"),
      fill = element("i");
    fill.style.width = `${(100 * item.count) / Math.max(1, total)}%`;
    track.append(fill);
    row.append(label, track);
    return row;
  });
  $(id).replaceChildren(
    ...(nodes.length
      ? nodes
      : [element("p", "No signals in this category yet.", "rank-empty")]),
  );
}
function elapsed(seconds) {
  const minutes = Math.floor(seconds / 60),
    remainder = Math.floor(seconds % 60);
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}
function journeyCard(item, open) {
  const card = element("details", "", "journey");
  card.open = open;
  const summary = element("summary"),
    heading = element("div", "", "journey-heading");
  const title = element("div", "", "journey-title");
  title.append(
    element("strong", item.source),
    element("span", names[item.category], `tag ${item.category}`),
  );
  const actions = item.events.filter((event) => event.kind === "action").length;
  heading.append(
    title,
    element(
      "span",
      `${day(item.first)} · ${clock(item.first)} · ${item.device} / ${item.browser}`,
      "muted small",
    ),
  );
  const path = element("div", "", "journey-path");
  for (const [index, event] of item.events
    .filter((event) => event.kind === "page")
    .entries()) {
    if (index) path.append(element("span", "→", "path-arrow"));
    path.append(element("span", event.label, "path-page"));
  }
  const meta = element(
    "span",
    `${item.views} page ${item.views === 1 ? "opening" : "openings"} · ${state.data.demo ? `${actions} sample actions` : state.data.collected ? `${actions} recorded ${actions === 1 ? "action" : "actions"}` : "Clicks not collected"}`,
    "journey-meta",
  );
  summary.append(
    heading,
    path,
    meta,
    element("span", "Timeline & context", "expand-label"),
  );
  const body = element("div", "", "journey-body"),
    timeline = element("ol", "", "timeline");
  timeline.setAttribute("aria-label", `Timeline for ${item.label}`);
  for (const event of item.events) {
    const row = element("li", "", event.kind);
    const time = element("time", `+${elapsed(event.at - item.first)}`);
    time.dateTime = date(event.at).toISOString();
    time.title = `${day(event.at)}, ${clock(event.at)}`;
    const text = element("div");
    text.append(
      element(
        "span",
        event.kind === "page"
          ? "Opened page"
          : state.data.demo
            ? "Sample button action"
            : "Recorded button action",
        "event-kind",
      ),
      element("strong", event.label),
    );
    row.append(time, text);
    timeline.append(row);
  }
  const context = element("aside", "", "journey-context");
  context.append(element("h3", "Visit context"));
  const fields = {
    "Group reference": item.label,
    "Observed span":
      item.events.length > 1
        ? elapsed(item.events.at(-1).at - item.first)
        : "Single request; duration unknown",
    "Approx. location": item.location,
    "Device / OS": `${item.device} / ${item.os}`,
    Browser: item.browser,
    Viewport: item.viewport,
    "Observed IP": item.ip,
  };
  const list = element("dl");
  list.append(
    ...Object.entries(fields).flatMap(([label, value]) => [
      element("dt", label),
      element("dd", value),
    ]),
  );
  context.append(
    list,
    element(
      "p",
      "Last event is not an exit time. A shared IP may represent several people.",
      "small muted",
    ),
  );
  if (item.eventsLimited)
    context.append(
      element("p", "Only the latest 60 events are shown.", "small muted"),
    );
  body.append(timeline, context);
  card.append(summary, body);
  return card;
}
function renderRows() {
  const query = $("search").value.trim().toLowerCase();
  const rows = state.data.activity.filter((item) =>
    [
      item.label,
      item.ip,
      item.location,
      item.browser,
      item.os,
      item.device,
      item.source,
      ...item.pages,
      ...item.events.map((event) => event.label),
    ].some((value) => String(value).toLowerCase().includes(query)),
  );
  $("rows").replaceChildren(
    ...rows
      .slice(0, state.rowLimit)
      .map((item, index) => journeyCard(item, index === 0)),
  );
  if (!rows.length) {
    $("rows").append(
      element(
        "p",
        "No matching visits on this page. Try older visits, another category, period, or filter.",
        "empty-state",
      ),
    );
  }
  $("feedNote").textContent =
    `Showing ${rows.length} ${rows.length===1 ? "visit" : "visits"} on this page · ${state.data.visitors ? `page starts at ${state.data.position+1} of ${state.data.visitors}` : "no visits"} in this category. ` +
    (state.data.demo
      ? "Illustrative journeys, not actual visitors."
      : state.data.collected
        ? "Short-lived browser sessions, not verified identities."
        : "Daily network groups, not confirmed sessions or identities.");
  $("showMore").hidden = !state.data.nextCursor;
  $("pageNewest").disabled = !state.cursor;
}
function render(data) {
  state.data = data;
  state.rowLimit = 25;
  $("modeNotice").textContent = data.demo
    ? "LOCAL WORKSHOP · SYNTHETIC VISITS · LIVE COLLECTION OFF"
    : data.localTest
      ? "LOCAL BROWSER TEST · EVENTS RECORDED LOCALLY · NOT DEPLOYED"
      : data.collected
        ? "PRIVATE OPERATOR VIEW · ENCRYPTED FIRST-PARTY EVENTS"
        : "PRIVATE OPERATOR VIEW · OFFLINE LOG IMPORT · NO BROWSER COLLECTOR";
  for (const [id, key] of [
    ["views", "views"],
    ["visitors", "visitors"],
    ["referred", "referred"],
  ])
    $(id).textContent = number(data[key]);
  $("homeViews").textContent = number(data.totals.home);
  $("groupLabel").textContent = data.demo
    ? "sample visit groups"
    : data.collected
      ? "browser sessions"
      : "daily network groups";
  $("journeyScope").textContent = state.data.demo
    ? "Design samples · not live tracking"
    : data.collected
      ? "Recorded first-party events"
      : "Observed page requests only";
  $("journeyNotice").textContent = state.data.demo
    ? "Sample journeys and button actions illustrate the proposed view. No live interaction collector is running."
    : data.collected
      ? "Browser-reported page visits and named interactions, ordered by event time. Visits may be incomplete; this is not session replay or verified time on page."
      : "Pages are ordered by request time within a daily network group. Clicks, confirmed sessions and time on page are not available from these logs.";
  if (data.collected) {
    $("collectionNotice").textContent =
      "Named page and button events are encrypted in storage. Browser Global Privacy Control and Do Not Track requests are honored. No typed content, fingerprinting, or session replay is recorded.";
    $("sourceLinkNotice").textContent = data.localTest
      ? "Local test links only. No public deployment or public visitor collection is active."
      : `${data.collectionScope === "production" ? "Production" : "Experimental"} entry links. Source tags are detected, then removed from the address bar.`;
    for (const link of document.querySelectorAll("a[data-source]")) {
      link.href = `${data.sourceBase}?src=${link.dataset.source}`;
      link.querySelector("code").textContent = link.href;
    }
  }
  $("updated").textContent =
    `Snapshot ${clock(data.generatedAt)} · refresh on demand`;
  $("homeTitle").textContent = data.currentIsHome
    ? "Your traffic has its own lane."
    : "Separate your own traffic";
  $("homeDescription").textContent =
    `${data.currentIp} · ${data.demo || data.localTest ? "Local preview address, not your public home IP. " : ""}` +
    (data.currentIsHome
      ? "Recognized as home and excluded from External."
      : "Mark this server-observed address to exclude it from External.");
  $("homeToggle").textContent = data.currentIsHome
    ? "Stop excluding this IP"
    : "Mark this IP as home";
  $("homeToggle").disabled = !data.homeAllowed;
  if (!data.homeAllowed)
    $("homeDescription").textContent =
      "A loopback proxy address is visible. Validate proxy forwarding before marking a home IP.";
  $("homeList").replaceChildren(document.createTextNode("Saved home addresses: "));
  if (!data.homes.length) $("homeList").append("none yet");
  for (const ip of data.homes) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = `${ip} ×`;
    remove.setAttribute("aria-label", `Stop excluding saved Home address ${ip}`);
    remove.addEventListener("click", () => saveHome(remove, { enabled: false, remove: ip }));
    $("homeList").append(remove, " ");
  }
  for (const button of $("days").querySelectorAll("button"))
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.days) === state.days),
    );
  for (const button of $("categories").querySelectorAll("button")) {
    const category = button.dataset.category;
    button.setAttribute("aria-pressed", String(category === state.category));
    button.querySelector("span").textContent = number(
      category === "all"
        ? Object.values(data.groupTotals).reduce((a, b) => a + b, 0)
        : data.groupTotals[category],
    );
  }
  rank("sources", data.sources, data.activity.length);
  rank("pages", data.pages, data.pages.reduce((sum,item)=>sum+item.count,0), pages);
  const health=data.collectorStatus;
  $("collectorStatus").textContent = health
    ? `${data.localTest ? "Local test database" : "VPS database"} · ${(health.databaseBytes/1048576).toFixed(1)} MB / ${(health.limitBytes/1048576).toFixed(0)} MB · ${health.warnings.length ? health.warnings.join(" ") : "Backup and redaction checks current."}${health.intakeFailures||health.snapshotFailures ? ` · ${health.intakeFailures} intake / ${health.snapshotFailures} snapshot failures since startup; check private service logs.` : ""}`
    : data.demo
      ? "Local design preview · real visitor records will be stored separately on the VPS, not in this browser."
      : "Private server database · offline navigation logs; refresh on demand.";
  renderRows();
}
async function load(cursor = "") {
  state.request?.abort();
  const request = new AbortController();
  state.request = request;
  $("error").hidden = true;
  $("refresh").disabled = true;
  $("showMore").disabled = true;
  try {
    const response = await fetch(
      `data?days=${state.days}&category=${state.category}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal: request.signal, cache: "no-store" },
    );
    if (!response.ok)
      throw new Error("Could not read the private snapshot. Refresh to retry.");
    const data = await response.json();
    if (!request.signal.aborted) { state.cursor=cursor; render(data); }
  } catch (error) {
    if (error.name !== "AbortError") {
      $("error").textContent = error.message;
      $("error").hidden = false;
    }
  } finally {
    if (state.request === request) { $("refresh").disabled = false; $("showMore").disabled=false; }
  }
}
for (const button of $("days").querySelectorAll("button"))
  button.addEventListener("click", () => {
    state.days = Number(button.dataset.days);
    load();
  });
for (const button of $("categories").querySelectorAll("button"))
  button.addEventListener("click", () => {
    state.category = button.dataset.category;
    load();
  });
$("search").addEventListener("input", () => {
  state.rowLimit = 25;
  if (state.data) renderRows();
});
$("showMore").addEventListener("click", () => {
  if(state.data?.nextCursor) load(state.data.nextCursor);
});
$("pageNewest").addEventListener("click", () => load());
$("refresh").addEventListener("click", () => load());
for (const button of document.querySelectorAll("[data-copy-source]")) {
  button.addEventListener("click", async () => {
    const link = button.closest("li").querySelector("a");
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(link.href);
      for (const other of document.querySelectorAll("[data-copy-source]"))
        other.textContent = "Copy";
      button.textContent = "Copied";
      $("sourceCopyStatus").textContent =
        `Copied ${button.dataset.copySource} source link.`;
    } catch {
      $("sourceCopyStatus").textContent =
        "Clipboard unavailable. Select the displayed URL or use Copy Link from its menu.";
    } finally {
      button.disabled = false;
    }
  });
}
async function saveHome(button, action) {
  if (!state.data) return;
  button.disabled = true;
  try {
    const response = await fetch("home", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Visitor-Action": state.data.actionToken,
      },
      body: JSON.stringify(action),
    });
    if (!response.ok)
      throw new Error(
        "Home classification could not be saved. Refresh and try again.",
      );
    await load();
  } catch (error) {
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    button.disabled = false;
    $("homeToggle").disabled = !state.data?.homeAllowed;
  }
}
$("homeToggle").addEventListener("click", () => saveHome($("homeToggle"), { enabled: !state.data?.currentIsHome }));
load();
