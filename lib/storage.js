(function initStorage(globalScope) {
  const DEFAULT_SETTINGS = {
    aiMode: true,
    workerUrl: "",
    defaultAggressiveness: 45,
    notificationsEnabled: true,
    offerLimitHour: 3,
    offerLimitDay: 10,
    messageLimitHour: 10,         // messages are safe — higher limits
    messageLimitDay: 30,
    blockedSellers: [],
    dealLog: [],
    // Negotiation mode: "message-first" (default) or "direct-offer"
    negotiationMode: "message-first",
    // Legacy offer automation settings (used in direct-offer mode)
    offerMode: "approval",        // "approval" or "auto"
    maxConcurrentOffers: 1,       // 1-3
    maxTotalPending: 500          // budget lock in $
  };

  const DEFAULT_RUNTIME = {
    automation: {
      running: false,
      config: null,
      startedAt: null,
      sourceTabId: null
    },
    negotiations: {},
    activityFeed: [],
    stats: {
      totalSavings: 0,
      activeNegotiations: 0,
      dealsWon: 0,
      offersSent: 0,
      countersReceived: 0,
      messagesSent: 0
    },
    offerHistory: [],
    // Offer queue for approval flow
    pendingApprovals: [],   // listings awaiting user approval
    activeOffers: [],       // offers sent, awaiting seller response
    // Message tracking (separate from offers — messages are free/safe)
    messageHistory: [],     // { listingId, sellerName, messageText, sentAt, status, messageType }
    activeConversations: [] // { listingId, sellerName, lastMessage, sentAt, status }
  };

  function getStorageArea() {
    return chrome.storage.local;
  }

  function normalizeSettings(settings) {
    return {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
      aiMode: settings?.aiMode !== false,
      workerUrl: String(settings?.workerUrl || "").trim(),
      defaultAggressiveness: clampNumber(settings?.defaultAggressiveness, 0, 100, DEFAULT_SETTINGS.defaultAggressiveness),
      notificationsEnabled: settings?.notificationsEnabled !== false,
      offerLimitHour: clampNumber(settings?.offerLimitHour, 1, 100, DEFAULT_SETTINGS.offerLimitHour),
      offerLimitDay: clampNumber(settings?.offerLimitDay, 1, 1000, DEFAULT_SETTINGS.offerLimitDay),
      messageLimitHour: clampNumber(settings?.messageLimitHour, 1, 100, DEFAULT_SETTINGS.messageLimitHour),
      messageLimitDay: clampNumber(settings?.messageLimitDay, 1, 1000, DEFAULT_SETTINGS.messageLimitDay),
      negotiationMode: settings?.negotiationMode === "direct-offer" ? "direct-offer" : "message-first",
      blockedSellers: normalizeStringArray(settings?.blockedSellers),
      dealLog: Array.isArray(settings?.dealLog) ? settings.dealLog.slice(0, 200) : [],
      offerMode: settings?.offerMode === "auto" ? "auto" : "approval",
      maxConcurrentOffers: clampNumber(settings?.maxConcurrentOffers, 1, 3, DEFAULT_SETTINGS.maxConcurrentOffers),
      maxTotalPending: clampNumber(settings?.maxTotalPending, 1, 100000, DEFAULT_SETTINGS.maxTotalPending)
    };
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeStringArray(values) {
    if (!Array.isArray(values)) {
      return [];
    }
    return Array.from(new Set(values
      .map((value) => String(value || "").trim())
      .filter(Boolean)));
  }

  async function get(keys) {
    return getStorageArea().get(keys);
  }

  async function getSettings() {
    const result = await getStorageArea().get("settings");
    return normalizeSettings(result.settings);
  }

  async function setSettings(nextSettings) {
    const current = await getSettings();
    const merged = normalizeSettings({ ...current, ...(nextSettings || {}) });
    await getStorageArea().set({ settings: merged });
    return merged;
  }

  async function getRuntime() {
    const result = await getStorageArea().get("runtime");
    const runtime = result.runtime || {};
    return {
      ...DEFAULT_RUNTIME,
      ...runtime,
      automation: { ...DEFAULT_RUNTIME.automation, ...(runtime.automation || {}) },
      stats: { ...DEFAULT_RUNTIME.stats, ...(runtime.stats || {}) },
      negotiations: runtime.negotiations || {},
      activityFeed: runtime.activityFeed || [],
      offerHistory: runtime.offerHistory || [],
      pendingApprovals: runtime.pendingApprovals || [],
      activeOffers: runtime.activeOffers || [],
      messageHistory: runtime.messageHistory || [],
      activeConversations: runtime.activeConversations || []
    };
  }

  async function setRuntime(nextRuntime) {
    const current = await getRuntime();
    const merged = {
      ...current,
      ...nextRuntime,
      automation: { ...current.automation, ...(nextRuntime.automation || {}) },
      stats: { ...current.stats, ...(nextRuntime.stats || {}) },
      negotiations: nextRuntime.negotiations || current.negotiations,
      activityFeed: nextRuntime.activityFeed || current.activityFeed,
      offerHistory: nextRuntime.offerHistory || current.offerHistory,
      pendingApprovals: nextRuntime.pendingApprovals !== undefined ? nextRuntime.pendingApprovals : current.pendingApprovals,
      activeOffers: nextRuntime.activeOffers !== undefined ? nextRuntime.activeOffers : current.activeOffers,
      messageHistory: nextRuntime.messageHistory !== undefined ? nextRuntime.messageHistory : current.messageHistory,
      activeConversations: nextRuntime.activeConversations !== undefined ? nextRuntime.activeConversations : current.activeConversations
    };
    await getStorageArea().set({ runtime: merged });
    return merged;
  }

  async function appendActivity(entry) {
    const runtime = await getRuntime();
    const activityFeed = [entry, ...runtime.activityFeed].slice(0, 50);
    return setRuntime({ activityFeed });
  }

  async function upsertNegotiation(record) {
    if (!record?.listingId) {
      return getRuntime();
    }
    const runtime = await getRuntime();
    const negotiations = {
      ...runtime.negotiations,
      [record.listingId]: {
        ...(runtime.negotiations[record.listingId] || {}),
        ...record
      }
    };
    const activeNegotiations = Object.values(negotiations).filter((item) => {
      return ["queued", "scheduled", "negotiating", "countered", "waiting_response", "pending_approval"].includes(item.status);
    }).length;
    return setRuntime({
      negotiations,
      stats: {
        ...runtime.stats,
        activeNegotiations
      }
    });
  }

  async function removeNegotiation(listingId) {
    const runtime = await getRuntime();
    const negotiations = { ...runtime.negotiations };
    delete negotiations[listingId];
    const activeNegotiations = Object.values(negotiations).filter((item) => {
      return ["queued", "scheduled", "negotiating", "countered", "waiting_response", "pending_approval"].includes(item.status);
    }).length;
    return setRuntime({
      negotiations,
      stats: {
        ...runtime.stats,
        activeNegotiations
      }
    });
  }

  async function appendOfferHistory(entry) {
    const runtime = await getRuntime();
    const offerHistory = [entry, ...runtime.offerHistory].slice(0, 200);
    return setRuntime({ offerHistory });
  }

  // --- Pending Approval helpers ---

  async function addPendingApproval(item) {
    const runtime = await getRuntime();
    // Don't add duplicates
    const exists = runtime.pendingApprovals.some(p => p.listingId === item.listingId);
    if (exists) return runtime;
    const pendingApprovals = [...runtime.pendingApprovals, item].slice(0, 50);
    return setRuntime({ pendingApprovals });
  }

  async function removePendingApproval(listingId) {
    const runtime = await getRuntime();
    const pendingApprovals = runtime.pendingApprovals.filter(p => p.listingId !== listingId);
    return setRuntime({ pendingApprovals });
  }

  // --- Active Offer helpers ---

  async function addActiveOffer(item) {
    const runtime = await getRuntime();
    const exists = runtime.activeOffers.some(o => o.listingId === item.listingId);
    if (exists) {
      // Update existing
      const activeOffers = runtime.activeOffers.map(o =>
        o.listingId === item.listingId ? { ...o, ...item } : o
      );
      return setRuntime({ activeOffers });
    }
    const activeOffers = [...runtime.activeOffers, item].slice(0, 20);
    return setRuntime({ activeOffers });
  }

  async function removeActiveOffer(listingId) {
    const runtime = await getRuntime();
    const activeOffers = runtime.activeOffers.filter(o => o.listingId !== listingId);
    return setRuntime({ activeOffers });
  }

  async function getActiveOfferCount() {
    const runtime = await getRuntime();
    return runtime.activeOffers.length;
  }

  async function getTotalPendingAmount() {
    const runtime = await getRuntime();
    return runtime.activeOffers.reduce((sum, o) => sum + (Number(o.offerAmount) || 0), 0);
  }

  // --- Message tracking helpers (separate from offers) ---

  async function addMessageRecord(record) {
    const runtime = await getRuntime();
    const messageHistory = [record, ...runtime.messageHistory].slice(0, 200);
    return setRuntime({ messageHistory });
  }

  async function addActiveConversation(item) {
    const runtime = await getRuntime();
    const exists = runtime.activeConversations.some(c => c.listingId === item.listingId);
    if (exists) {
      const activeConversations = runtime.activeConversations.map(c =>
        c.listingId === item.listingId ? { ...c, ...item } : c
      );
      return setRuntime({ activeConversations });
    }
    const activeConversations = [...runtime.activeConversations, item].slice(0, 100);
    return setRuntime({ activeConversations });
  }

  async function updateConversationStatus(listingId, status) {
    const runtime = await getRuntime();
    const activeConversations = runtime.activeConversations.map(c =>
      c.listingId === listingId ? { ...c, status, updatedAt: new Date().toISOString() } : c
    );
    return setRuntime({ activeConversations });
  }

  async function removeActiveConversation(listingId) {
    const runtime = await getRuntime();
    const activeConversations = runtime.activeConversations.filter(c => c.listingId !== listingId);
    return setRuntime({ activeConversations });
  }

  globalScope.GrailedStorage = {
    DEFAULT_SETTINGS,
    DEFAULT_RUNTIME,
    get,
    getSettings,
    setSettings,
    getRuntime,
    setRuntime,
    appendActivity,
    upsertNegotiation,
    removeNegotiation,
    appendOfferHistory,
    // New helpers
    addPendingApproval,
    removePendingApproval,
    addActiveOffer,
    removeActiveOffer,
    getActiveOfferCount,
    getTotalPendingAmount,
    // Message tracking
    addMessageRecord,
    addActiveConversation,
    updateConversationStatus,
    removeActiveConversation
  };
})(self);
