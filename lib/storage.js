(function initStorage(globalScope) {
  const DEFAULT_SETTINGS = {
    aiMode: true,
    workerUrl: "",
    defaultAggressiveness: 45,
    notificationsEnabled: true,
    offerLimitHour: 10,
    offerLimitDay: 30,
    blockedSellers: [],
    dealLog: []
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
      countersReceived: 0
    },
    offerHistory: []
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
      offerLimitHour: clampNumber(settings?.offerLimitHour, 1, 1000, DEFAULT_SETTINGS.offerLimitHour),
      offerLimitDay: clampNumber(settings?.offerLimitDay, 1, 10000, DEFAULT_SETTINGS.offerLimitDay),
      blockedSellers: normalizeStringArray(settings?.blockedSellers),
      dealLog: Array.isArray(settings?.dealLog) ? settings.dealLog.slice(0, 200) : []
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
      offerHistory: runtime.offerHistory || []
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
      offerHistory: nextRuntime.offerHistory || current.offerHistory
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
      return ["queued", "scheduled", "negotiating", "countered", "waiting_response"].includes(item.status);
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
      return ["queued", "scheduled", "negotiating", "countered", "waiting_response"].includes(item.status);
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
    appendOfferHistory
  };
})(self);
