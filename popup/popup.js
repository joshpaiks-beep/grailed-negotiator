(function initPopup() {
  const form = document.getElementById("config-form");
  const startStopButton = document.getElementById("start-stop-button");
  const aggressivenessInput = document.getElementById("aggressiveness");
  const aggressivenessLabel = document.getElementById("aggressiveness-label");
  const refreshButton = document.getElementById("refresh-button");
  const statusBanner = document.getElementById("status-banner");

  const statsSavings = document.getElementById("stat-savings");
  const statsActive = document.getElementById("stat-active");
  const statsWon = document.getElementById("stat-won");
  const offersPill = document.getElementById("pill-offers");
  const countersPill = document.getElementById("pill-counters");
  const activityFeed = document.getElementById("activity-feed");

  let runtimeState = null;
  let settingsState = null;
  let busy = false;

  form.addEventListener("submit", onSubmit);
  refreshButton.addEventListener("click", onRefresh);
  aggressivenessInput.addEventListener("input", updateAggressivenessLabel);

  bootstrap();

  async function bootstrap() {
    setBusy(true, "Loading current automation state...");
    try {
      const response = await chrome.runtime.sendMessage({ type: "POPUP_GET_STATE" });
      if (!response.ok) {
        throw new Error(response.error || "Could not load popup state.");
      }
      runtimeState = response.runtime;
      settingsState = response.settings;
      hydrateForm();
      render();
      setStatus(runtimeState.activityFeed?.[0]?.message || "", runtimeState.activityFeed?.[0]?.type === "error" ? "error" : "info");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function hydrateForm() {
    const config = runtimeState.automation.config || {};
    form.brand.value = config.brand || "";
    form.size.value = config.size || "";
    form.category.value = config.category || "";
    form.maxPrice.value = config.maxPrice || "";
    form.aggressiveness.value = config.aggressiveness ?? settingsState.defaultAggressiveness ?? 45;
    updateAggressivenessLabel();
  }

  function updateAggressivenessLabel() {
    const value = Number(aggressivenessInput.value);
    if (value < 25) {
      aggressivenessLabel.textContent = "Chill";
    } else if (value < 55) {
      aggressivenessLabel.textContent = "Balanced";
    } else if (value < 80) {
      aggressivenessLabel.textContent = "Bold";
    } else {
      aggressivenessLabel.textContent = "Savage";
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true, runtimeState?.automation?.running ? "Stopping automation..." : "Starting automation...");
    try {
      if (runtimeState?.automation?.running) {
        const response = await chrome.runtime.sendMessage({ type: "STOP_AUTOMATION" });
        if (!response.ok) {
          throw new Error(response.error || "Could not stop automation.");
        }
        runtimeState = response.runtime;
        settingsState = response.settings;
        render();
        setStatus("Automation stopped.", "info");
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const payload = {
        brand: form.brand.value.trim(),
        size: form.size.value.trim(),
        category: form.category.value.trim(),
        maxPrice: Number(form.maxPrice.value) || null,
        aggressiveness: Number(form.aggressiveness.value),
        sourceTabId: tab?.id || null
      };
      if (!payload.maxPrice) {
        throw new Error("Set a max price before starting automation.");
      }

      const response = await chrome.runtime.sendMessage({
        type: "START_AUTOMATION",
        payload
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not start automation.");
      }
      runtimeState = response.runtime;
      settingsState = response.settings;
      render();
      setStatus("Automation started. Keep a Grailed listing or search tab open for discovery.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function onRefresh() {
    setBusy(true, "Refreshing matches from the active tab...");
    try {
      const response = await chrome.runtime.sendMessage({ type: "REFRESH_FROM_ACTIVE_TAB" });
      if (!response.ok) {
        throw new Error(response.error || "Could not refresh from the active tab.");
      }
      runtimeState = response.runtime;
      settingsState = response.settings;
      render();
      setStatus(runtimeState.activityFeed?.[0]?.message || "Refresh complete.", "info");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function render() {
    if (!runtimeState || !settingsState) {
      return;
    }
    const stats = runtimeState.stats;
    statsSavings.textContent = `$${stats.totalSavings}`;
    statsActive.textContent = String(stats.activeNegotiations);
    statsWon.textContent = String(stats.dealsWon);
    offersPill.textContent = `${stats.offersSent} offers`;
    countersPill.textContent = `${stats.countersReceived} counters`;
    startStopButton.textContent = runtimeState.automation.running ? "Stop Negotiation" : "Start Negotiation";
    startStopButton.dataset.mode = runtimeState.automation.running ? "stop" : "start";
    refreshButton.disabled = busy;
    startStopButton.disabled = busy;

    renderActivity(runtimeState.activityFeed || []);
  }

  function renderActivity(items) {
    activityFeed.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "activity-empty";
      empty.textContent = "No activity yet. Start on a Grailed search or listing page.";
      activityFeed.appendChild(empty);
      return;
    }

    for (const item of items) {
      const card = document.createElement("article");
      card.className = "activity-item";

      const message = document.createElement("p");
      message.textContent = item.message;

      const time = document.createElement("time");
      try {
        const d = new Date(item.timestamp);
        time.textContent = Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit"
        });
      } catch (_) {
        time.textContent = "";
      }

      card.append(message, time);
      activityFeed.appendChild(card);
    }
  }

  function setBusy(nextBusy, message) {
    busy = nextBusy;
    if (message) {
      setStatus(message, "info");
    }
    render();
  }

  function setStatus(message, tone) {
    if (!message) {
      statusBanner.hidden = true;
      statusBanner.textContent = "";
      statusBanner.dataset.tone = "";
      return;
    }
    statusBanner.hidden = false;
    statusBanner.textContent = message;
    statusBanner.dataset.tone = tone || "info";
  }
})();
