(() => {
  function create({ apiBase }) {
    const elements = {
      apiExplorerForm: document.getElementById("apiExplorerForm"),
      apiPreset: document.getElementById("apiPreset"),
      apiCorridor: document.getElementById("apiCorridor"),
      apiRequestPath: document.getElementById("apiRequestPath"),
      apiRun: document.getElementById("apiRun"),
      apiCopy: document.getElementById("apiCopy"),
      apiHistoryRecipe: document.getElementById("apiHistoryRecipe"),
      apiRecipePath: document.getElementById("apiRecipePath"),
      apiResponseState: document.getElementById("apiResponseState"),
      apiResponseMeta: document.getElementById("apiResponseMeta"),
      apiResponseBody: document.getElementById("apiResponseBody")
    };

    const API_EXPLORER_TIMEOUT_MS = 8_000;
    const API_EXAMPLES = Object.freeze({
     latest: corridor => `/traffic/latest?corridor=${corridor}&preferUsable=true`,
     summary: corridor => `/traffic/summary?corridor=${corridor}`,
     history: corridor => `/traffic/history?corridor=${corridor}&windowMinutes=120&limit=12&includeIncidents=false`,
     incidents: corridor => `/traffic/map/incidents/recent?corridor=${corridor}&windowMinutes=1440&limit=12`,
     status: () => "/system/operational-status"
    });

    function initializeApiExplorer() {
      const form = elements.apiExplorerForm;
      if (!form) return;

      const update = () => {
        const preset = elements.apiPreset?.value || "latest";
        const needsCorridor = preset !== "status";
        if (elements.apiCorridor) elements.apiCorridor.disabled = !needsCorridor;
        elements.apiRequestPath.textContent = apiExplorerPath();
      };

      elements.apiPreset?.addEventListener("change", update);
      elements.apiCorridor?.addEventListener("change", update);
      if (elements.apiRecipePath) {
        elements.apiRecipePath.textContent = `${apiBase()}${API_EXAMPLES.history("I70")}`;
      }
      elements.apiHistoryRecipe?.addEventListener("click", () => {
        elements.apiPreset.value = "history";
        elements.apiCorridor.value = "I70";
        update();
        form.scrollIntoView?.({block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
        elements.apiRun?.focus?.({preventScroll: true});
      });
      elements.apiCopy?.addEventListener("click", () => void copyApiExplorerPath());
      elements.apiRun?.addEventListener("click", event => {
        event.preventDefault();
        void runApiExplorerRequest();
      });
      form.addEventListener("submit", event => {
        event.preventDefault();
        void runApiExplorerRequest();
      });
      update();
    }

    function apiExplorerPath() {
      const preset = elements.apiPreset?.value || "latest";
      const corridor = elements.apiCorridor?.value === "I70" ? "I70" : "I25";
      const template = Object.hasOwn(API_EXAMPLES, preset) ? API_EXAMPLES[preset] : API_EXAMPLES.latest;
      return `${apiBase()}${template(corridor)}`;
    }

    async function copyApiExplorerPath() {
      const buttonLabel = elements.apiCopy?.querySelector?.("span");
      try {
        if (!window.navigator?.clipboard?.writeText) throw new Error("Clipboard access unavailable");
        await window.navigator.clipboard.writeText(apiExplorerPath());
        if (buttonLabel) buttonLabel.textContent = "Copied";
      } catch {
        if (buttonLabel) buttonLabel.textContent = "Copy unavailable";
      } finally {
        window.setTimeout?.(() => {
          if (buttonLabel) buttonLabel.textContent = "Copy path";
        }, 1600);
      }
    }

    async function runApiExplorerRequest() {
      const responsePanel = elements.apiResponseBody?.closest?.(".api-response");
      if (!responsePanel || elements.apiRun?.disabled) return;
      const path = apiExplorerPath();
      elements.apiRun.disabled = true;
      responsePanel.classList.remove("is-success", "is-error");
      responsePanel.classList.add("is-loading");
      elements.apiResponseState.textContent = "Loading";
      elements.apiResponseMeta.textContent = path;
      elements.apiResponseBody.textContent = "Reading retained data…";

      try {
        const startedAt = Date.now();
        const response = await window.fetch(path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(API_EXPLORER_TIMEOUT_MS) });
        const contentType = response.headers?.get?.("content-type") || "";
        const payload = contentType.includes("json") ? await response.json() : await response.text();
        if (!response.ok) throw new ApiExplorerError(response.status, payload, response.headers?.get?.("retry-after"));
        const elapsedMs = Date.now() - startedAt;
        responsePanel.classList.add("is-success");
        elements.apiResponseState.textContent = `${response.status} OK`;
        const remaining = response.headers?.get?.("x-ratelimit-remaining");
        const ceiling = response.headers?.get?.("x-ratelimit-limit");
        elements.apiResponseMeta.textContent = `${elapsedMs} ms${remaining !== null && remaining !== undefined ? ` · ${remaining}${ceiling ? ` / ${ceiling}` : ""} reads remain this minute` : ""}`;
        elements.apiResponseBody.textContent = apiResponseText(payload);
      } catch (error) {
        responsePanel.classList.add("is-error");
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        elements.apiResponseState.textContent = error?.status ? `HTTP ${error.status}` : timedOut ? "Timed out" : "Unavailable";
        elements.apiResponseMeta.textContent = error?.status === 429
          ? `Rate limit reached. Honor Retry-After${error.retryAfter ? `: ${error.retryAfter}` : ""} before running again.`
          : error?.status ? "Check the response and request, then run again."
          : timedOut ? "The eight-second read timed out. Run the example again to retry."
          : "The retained-data request could not be completed. Run again to retry.";
        elements.apiResponseBody.textContent = apiResponseText(error?.payload || {
          message: error?.message || "The API request failed without an explanation."
        });
      } finally {
        responsePanel.classList.remove("is-loading");
        elements.apiRun.disabled = false;
      }
    }

    function apiResponseText(payload) {
      const formatted = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) ?? "";
      const limit = 18_000;
      return formatted.length > limit ? `${formatted.slice(0, limit)}\n\n… response shortened for this preview` : formatted;
    }

    class ApiExplorerError extends Error {
      constructor(status, payload, retryAfter) {
        super(`API request returned HTTP ${status}`);
        this.status = status;
        this.payload = payload;
        this.retryAfter = retryAfter;
      }
    }

    return { initialize: initializeApiExplorer, path: apiExplorerPath, run: runApiExplorerRequest, responseText: apiResponseText };
  }

  window.InformationApi = { create };
})();
