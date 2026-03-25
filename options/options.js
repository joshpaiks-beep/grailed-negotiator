(function initOptions() {
  const form = document.getElementById("settings-form");
  const dealLog = document.getElementById("deal-log");
  const statusBanner = document.getElementById("status-banner");
  let busy = false;

  form.addEventListener("submit", onSubmit);
  bootstrap();

  async function bootstrap() {
    setBusy(true, "Loading settings...");
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_OPTIONS_STATE" });
      if (!response.ok) {
        throw new Error(response.error || "Could not load settings.");
      }
      hydrate(response.settings);
      renderDealLog(response.settings.dealLog || []);
      setStatus("Settings loaded.", "info");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function hydrate(settings) {
    form.aiMode.checked = settings.aiMode !== false;
    form.workerUrl.value = settings.workerUrl || "";
    form.defaultAggressiveness.value = settings.defaultAggressiveness ?? 45;
    form.notificationsEnabled.checked = Boolean(settings.notificationsEnabled);
    // Negotiation mode
    form.negotiationMode.value = settings.negotiationMode || "message-first";
    form.offerMode.value = settings.offerMode || "approval";
    // Message rate limits
    form.messageLimitHour.value = settings.messageLimitHour ?? 10;
    form.messageLimitDay.value = settings.messageLimitDay ?? 30;
    // Direct offer settings
    form.offerLimitHour.value = settings.offerLimitHour ?? 3;
    form.offerLimitDay.value = settings.offerLimitDay ?? 10;
    form.maxConcurrentOffers.value = settings.maxConcurrentOffers ?? 1;
    form.maxTotalPending.value = settings.maxTotalPending ?? 500;
    form.blockedSellers.value = (settings.blockedSellers || []).join("\n");
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true, "Saving settings...");
    const payload = {
      aiMode: form.aiMode.checked,
      workerUrl: form.workerUrl.value.trim(),
      defaultAggressiveness: Number(form.defaultAggressiveness.value) || 45,
      notificationsEnabled: form.notificationsEnabled.checked,
      negotiationMode: form.negotiationMode.value,
      offerMode: form.offerMode.value,
      messageLimitHour: Number(form.messageLimitHour.value) || 10,
      messageLimitDay: Number(form.messageLimitDay.value) || 30,
      offerLimitHour: Number(form.offerLimitHour.value) || 3,
      offerLimitDay: Number(form.offerLimitDay.value) || 10,
      maxConcurrentOffers: Math.min(3, Math.max(1, Number(form.maxConcurrentOffers.value) || 1)),
      maxTotalPending: Math.max(1, Number(form.maxTotalPending.value) || 500),
      blockedSellers: form.blockedSellers.value
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
    };
    try {
      if (payload.workerUrl && !/^https?:\/\//i.test(payload.workerUrl)) {
        throw new Error("Worker URL must start with http:// or https://.");
      }
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        payload
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not save settings.");
      }
      hydrate(response.settings);
      renderDealLog(response.settings.dealLog || []);
      setStatus("Settings saved.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function renderDealLog(entries) {
    dealLog.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "deal-empty";
      empty.textContent = "No completed negotiation history yet.";
      dealLog.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement("article");
      row.className = "deal-row";

      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = entry.title || entry.listingId;
      const meta = document.createElement("small");
      meta.textContent = `${entry.outcome} • ${new Date(entry.timestamp).toLocaleString()}`;
      left.append(title, meta);

      const right = document.createElement("div");
      right.textContent = `$${entry.finalPrice} / saved $${entry.savings}`;

      row.append(left, right);
      dealLog.appendChild(row);
    }
  }

  function setBusy(nextBusy, message) {
    busy = nextBusy;
    Array.from(form.elements).forEach((element) => {
      element.disabled = busy;
    });
    if (message) {
      setStatus(message, "info");
    }
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
