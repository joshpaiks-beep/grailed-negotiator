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
  const statsMessages = document.getElementById("stat-messages");
  const messagesPill = document.getElementById("pill-messages");
  const offersPill = document.getElementById("pill-offers");
  const countersPill = document.getElementById("pill-counters");
  const activityFeed = document.getElementById("activity-feed");

  // Budget
  const budgetPanel = document.getElementById("budget-panel");
  const budgetRemaining = document.getElementById("budget-remaining");
  const budgetUsed = document.getElementById("budget-used");
  const budgetMax = document.getElementById("budget-max");
  const budgetFill = document.getElementById("budget-fill");

  // Approvals
  const approvalsPanel = document.getElementById("approvals-panel");
  const approvalsList = document.getElementById("approvals-list");
  const approvalCount = document.getElementById("approval-count");

  // Conversations (message-first)
  const conversationsPanel = document.getElementById("conversations-panel");
  const conversationsList = document.getElementById("conversations-list");
  const conversationsCount = document.getElementById("conversations-count");

  // Active Offers (direct-offer)
  const activeOffersPanel = document.getElementById("active-offers-panel");
  const activeOffersList = document.getElementById("active-offers-list");
  const activeOffersCount = document.getElementById("active-offers-count");

  // History
  const historyToggle = document.getElementById("history-toggle");
  const offerHistory = document.getElementById("offer-history");

  let runtimeState = null;
  let settingsState = null;
  let budgetInfo = null;
  let busy = false;

  form.addEventListener("submit", onSubmit);
  refreshButton.addEventListener("click", onRefresh);
  aggressivenessInput.addEventListener("input", updateAggressivenessLabel);
  historyToggle.addEventListener("click", toggleHistory);

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
      budgetInfo = response.budgetInfo;
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
        budgetInfo = response.budgetInfo;
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
      budgetInfo = response.budgetInfo;
      render();

      const modeLabel = settingsState.negotiationMode === "message-first" ? "message-first" : "direct-offer";
      setStatus(`Automation started (${modeLabel} mode). Keep a Grailed listing or search tab open.`, "success");
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
      budgetInfo = response.budgetInfo;
      render();
      setStatus(runtimeState.activityFeed?.[0]?.message || "Refresh complete.", "info");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function onApprove(listingId) {
    const isMessageFirst = settingsState?.negotiationMode === "message-first";
    setBusy(true, isMessageFirst ? "Approving message..." : "Approving offer...");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "APPROVE_OFFER",
        payload: { listingId }
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not approve.");
      }
      runtimeState = response.runtime;
      settingsState = response.settings;
      budgetInfo = response.budgetInfo;
      render();
      setStatus(isMessageFirst ? "Message approved and queued." : "Offer approved and queued.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function onSkip(listingId) {
    setBusy(true, "Skipping...");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SKIP_OFFER",
        payload: { listingId }
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not skip.");
      }
      runtimeState = response.runtime;
      settingsState = response.settings;
      budgetInfo = response.budgetInfo;
      render();
      setStatus("Skipped.", "info");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleHistory() {
    const isHidden = offerHistory.hidden;
    offerHistory.hidden = !isHidden;
    const icon = historyToggle.querySelector(".toggle-icon");
    if (icon) icon.textContent = isHidden ? "▲" : "▼";
  }

  function render() {
    if (!runtimeState || !settingsState) {
      return;
    }
    const stats = runtimeState.stats;
    const isMessageFirst = settingsState.negotiationMode === "message-first";

    statsSavings.textContent = `$${stats.totalSavings}`;
    statsActive.textContent = String(stats.activeNegotiations);
    statsWon.textContent = String(stats.dealsWon);
    statsMessages.textContent = String(stats.messagesSent || 0);
    messagesPill.textContent = `${stats.messagesSent || 0} msgs`;
    offersPill.textContent = `${stats.offersSent} offers`;
    countersPill.textContent = `${stats.countersReceived} counters`;
    startStopButton.textContent = runtimeState.automation.running ? "Stop Negotiation" : "Start Negotiation";
    startStopButton.dataset.mode = runtimeState.automation.running ? "stop" : "start";
    refreshButton.disabled = busy;
    startStopButton.disabled = busy;

    // Budget panel: always show but dim in message-first mode
    if (isMessageFirst) {
      budgetPanel.style.opacity = "0.5";
    } else {
      budgetPanel.style.opacity = "1";
    }

    renderBudget();
    renderPendingApprovals();
    renderActiveConversations();
    renderActiveOffers();
    renderActivity(runtimeState.activityFeed || []);
    renderOfferHistory(runtimeState.offerHistory || []);
  }

  function renderBudget() {
    if (!budgetInfo) return;
    const remaining = Math.max(0, budgetInfo.budgetRemaining);
    const max = budgetInfo.maxBudget || 500;
    const used = budgetInfo.totalPending || 0;
    const pct = max > 0 ? Math.max(0, Math.min(100, (remaining / max) * 100)) : 0;

    budgetRemaining.textContent = `$${remaining}`;
    budgetUsed.textContent = `$${used} used`;
    budgetMax.textContent = `of $${max}`;
    budgetFill.style.width = `${pct}%`;

    if (pct > 50) {
      budgetFill.style.background = "linear-gradient(90deg, #66d6ab, #4ecdc4)";
    } else if (pct > 20) {
      budgetFill.style.background = "linear-gradient(90deg, #f0c27f, #fc5c7d)";
    } else {
      budgetFill.style.background = "linear-gradient(90deg, #ff5f5f, #ff4444)";
    }
  }

  function renderPendingApprovals() {
    const items = runtimeState.pendingApprovals || [];
    const isMessageFirst = settingsState?.negotiationMode === "message-first";
    approvalsPanel.hidden = items.length === 0;
    approvalCount.textContent = String(items.length);
    approvalsList.innerHTML = "";

    for (const item of items) {
      const card = document.createElement("article");
      card.className = "approval-card";

      const info = document.createElement("div");
      info.className = "approval-info";

      if (item.photoUrl) {
        const img = document.createElement("img");
        img.src = item.photoUrl;
        img.className = "approval-thumb";
        img.alt = item.listingTitle || "Listing photo";
        info.appendChild(img);
      }

      const details = document.createElement("div");
      details.className = "approval-details";

      const title = document.createElement("strong");
      title.className = "approval-title";
      title.textContent = item.listingTitle || item.listingId;

      const priceInfo = document.createElement("div");
      priceInfo.className = "approval-prices";
      priceInfo.innerHTML = `
        <span class="asking">Asking: $${item.askingPrice}</span>
        <span class="offer-amount">Target: $${item.offerAmount}</span>
      `;

      const meta = document.createElement("small");
      const parts = [item.brand, item.size, item.sellerName ? `@${item.sellerName}` : ""].filter(Boolean);
      meta.textContent = parts.length ? parts.join(" • ") : "";

      details.append(title, priceInfo, meta);
      info.append(details);

      const actions = document.createElement("div");
      actions.className = "approval-actions";

      const approveBtn = document.createElement("button");
      approveBtn.className = "approve-btn";
      approveBtn.textContent = isMessageFirst ? "Message Seller" : "Approve & Send";
      approveBtn.disabled = busy;
      approveBtn.addEventListener("click", () => onApprove(item.listingId));

      const skipBtn = document.createElement("button");
      skipBtn.className = "skip-btn";
      skipBtn.textContent = "Skip";
      skipBtn.disabled = busy;
      skipBtn.addEventListener("click", () => onSkip(item.listingId));

      actions.append(approveBtn, skipBtn);
      card.append(info, actions);
      approvalsList.appendChild(card);
    }
  }

  function renderActiveConversations() {
    const items = runtimeState.activeConversations || [];
    conversationsPanel.hidden = items.length === 0;
    conversationsCount.textContent = String(items.length);
    conversationsList.innerHTML = "";

    const STATUS_LABELS = {
      messaged: "📤 Messaged",
      awaiting_reply: "⏳ Awaiting Reply",
      in_negotiation: "💬 In Negotiation",
      agreed: "🤝 Agreed",
      completed: "✅ Completed"
    };

    for (const item of items) {
      const card = document.createElement("article");
      card.className = "conversation-card";

      const left = document.createElement("div");
      left.className = "conversation-info";

      const title = document.createElement("strong");
      title.textContent = item.listingTitle || item.listingId;

      const seller = document.createElement("span");
      seller.className = "conversation-seller";
      seller.textContent = item.sellerName ? `@${item.sellerName}` : "";

      const target = document.createElement("span");
      target.className = "conversation-target";
      target.textContent = `Target: $${item.offerAmount || "?"}`;

      left.append(title, seller, target);

      const right = document.createElement("div");
      right.className = "conversation-meta";

      const status = document.createElement("span");
      status.className = "conversation-status";
      status.textContent = STATUS_LABELS[item.status] || item.status;

      const time = document.createElement("time");
      try {
        const d = new Date(item.sentAt);
        time.textContent = Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        });
      } catch (_) {
        time.textContent = "";
      }

      right.append(status, time);
      card.append(left, right);
      conversationsList.appendChild(card);
    }
  }

  function renderActiveOffers() {
    const items = runtimeState.activeOffers || [];
    activeOffersPanel.hidden = items.length === 0;
    activeOffersCount.textContent = String(items.length);
    activeOffersList.innerHTML = "";

    for (const item of items) {
      const card = document.createElement("article");
      card.className = "active-offer-card";

      const title = document.createElement("strong");
      title.textContent = item.listingTitle || item.listingId;

      const offerInfo = document.createElement("span");
      offerInfo.className = "offer-amount";
      offerInfo.textContent = `$${item.offerAmount}`;

      const status = document.createElement("span");
      status.className = "offer-status";
      status.textContent = item.status === "sent" ? "Awaiting response" : item.status;

      const time = document.createElement("time");
      try {
        const d = new Date(item.sentAt);
        time.textContent = Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        });
      } catch (_) {
        time.textContent = "";
      }

      card.append(title, offerInfo, status, time);
      activeOffersList.appendChild(card);
    }
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
      if (item.type === "message_sent") card.classList.add("activity-message");

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

  function renderOfferHistory(items) {
    offerHistory.innerHTML = "";
    const recent = items.slice(0, 20);

    if (!recent.length) {
      const empty = document.createElement("div");
      empty.className = "activity-empty";
      empty.textContent = "No offers sent yet.";
      offerHistory.appendChild(empty);
      return;
    }

    for (const item of recent) {
      const row = document.createElement("article");
      row.className = "history-row";

      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.listingTitle || item.listingId;

      const meta = document.createElement("small");
      const typeLabel = {
        offer_sent: "Sent",
        offer_won: "Won ✅",
        offer_lost: "Lost",
        offer_walked: "Walked 🚶"
      }[item.type] || item.type;
      meta.textContent = `${typeLabel} • $${item.offer}`;

      left.append(title, meta);

      const time = document.createElement("time");
      try {
        const d = new Date(item.timestamp);
        time.textContent = Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        });
      } catch (_) {
        time.textContent = "";
      }

      row.append(left, time);
      offerHistory.appendChild(row);
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
