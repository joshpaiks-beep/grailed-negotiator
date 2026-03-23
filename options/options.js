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
    form.offerLimitHour.value = settings.offerLimitHour ?? 10;
    form.offerLimitDay.value = settings.offerLimitDay ?? 30;
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
      offerLimitHour: Number(form.offerLimitHour.value) || 10,
      offerLimitDay: Number(form.offerLimitDay.value) || 30,
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
