(function initPopup() {
  const form = document.getElementById("config-form");
  const startStopButton = document.getElementById("start-stop-button");
  const aggressivenessInput = document.getElementById("aggressiveness");
  const aggressivenessLabel = document.getElementById("aggressiveness-label");
  const refreshButton = document.getElementById("refresh-button");

  const statsSavings = document.getElementById("stat-savings");
  const statsActive = document.getElementById("stat-active");
  const statsWon = document.getElementById("stat-won");
  const offersPill = document.getElementById("pill-offers");
  const countersPill = document.getElementById("pill-counters");
  const activityFeed = document.getElementById("activity-feed");

  let runtimeState = null;
  let settingsState = null;

  form.addEventListener("submit", onSubmit);
  refreshButton.addEventListener("click", onRefresh);
  aggressivenessInput.addEventListener("input", updateAggressivenessLabel);

  bootstrap();

  async function bootstrap() {
    const response = await chrome.runtime.sendMessage({ type: "POPUP_GET_STATE" });
    if (!response.ok) {
      return;
    }
    runtimeState = response.runtime;
    settingsState = response.settings;
    hydrateForm();
    render();
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
    if (runtimeState?.automation?.running) {
      const response = await chrome.runtime.sendMessage({ type: "STOP_AUTOMATION" });
      runtimeState = response.runtime;
      settingsState = response.settings;
      render();
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
    const response = await chrome.runtime.sendMessage({
      type: "START_AUTOMATION",
      payload
    });
    if (!response.ok) {
      return;
    }
    runtimeState = response.runtime;
    settingsState = response.settings;
    render();
  }

  async function onRefresh() {
    const response = await chrome.runtime.sendMessage({ type: "REFRESH_FROM_ACTIVE_TAB" });
    if (!response.ok) {
      return;
    }
    runtimeState = response.runtime;
    settingsState = response.settings;
    render();
  }

  function render() {
    const stats = runtimeState.stats;
    statsSavings.textContent = `$${stats.totalSavings}`;
    statsActive.textContent = String(stats.activeNegotiations);
    statsWon.textContent = String(stats.dealsWon);
    offersPill.textContent = `${stats.offersSent} offers`;
    countersPill.textContent = `${stats.countersReceived} counters`;
    startStopButton.textContent = runtimeState.automation.running ? "Stop Negotiation" : "Start Negotiation";
    startStopButton.dataset.mode = runtimeState.automation.running ? "stop" : "start";

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
      time.textContent = new Date(item.timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      });

      card.append(message, time);
      activityFeed.appendChild(card);
    }
  }
})();
