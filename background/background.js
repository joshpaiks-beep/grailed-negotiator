importScripts("../lib/templates.js", "../lib/storage.js", "../lib/negotiator.js", "../lib/ai-negotiator.js");

const OFFER_ALARM_PREFIX = "offer:";
const EXECUTION_TABS = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  await GrailedStorage.setSettings({});
  await GrailedStorage.setRuntime({});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("Message handling failed", error);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(OFFER_ALARM_PREFIX)) {
    return;
  }
  const listingId = alarm.name.replace(OFFER_ALARM_PREFIX, "");
  try {
    await executeNegotiation(listingId);
  } catch (error) {
    console.error("Alarm execution failed", error);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !EXECUTION_TABS.has(tabId)) {
    return;
  }
  const context = EXECUTION_TABS.get(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE_NEGOTIATION_STEP",
      negotiation: context.negotiation,
      config: context.config
    });
  } catch (error) {
    console.error("Failed to dispatch execution step", error);
  }
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "POPUP_GET_STATE":
      return getPopupState();
    case "START_AUTOMATION":
      return startAutomation(message.payload, sender);
    case "STOP_AUTOMATION":
      return stopAutomation();
    case "GET_OPTIONS_STATE":
      return getOptionsState();
    case "SAVE_SETTINGS":
      return saveSettings(message.payload);
    case "CONTENT_EXECUTION_RESULT":
      return handleExecutionResult(message.payload, sender);
    case "REFRESH_FROM_ACTIVE_TAB":
      return refreshFromActiveTab();
    default:
      return {};
  }
}

async function getPopupState() {
  const [runtime, settings] = await Promise.all([
    GrailedStorage.getRuntime(),
    GrailedStorage.getSettings()
  ]);
  return { runtime, settings };
}

async function getOptionsState() {
  const [runtime, settings] = await Promise.all([
    GrailedStorage.getRuntime(),
    GrailedStorage.getSettings()
  ]);
  return { runtime, settings };
}

async function saveSettings(payload) {
  // Persist AI-specific settings to chrome.storage.local for ai-negotiator.js
  if (payload.aiMode !== undefined || payload.workerUrl) {
    await chrome.storage.local.set({
      aiMode: payload.aiMode !== false,
      workerUrl: payload.workerUrl || '',
    });
  }
  const settings = await GrailedStorage.setSettings(payload);
  return { settings };
}

async function startAutomation(config, sender) {
  const runtime = await GrailedStorage.getRuntime();
  const sourceTabId = sender.tab?.id || config.sourceTabId || null;
  await GrailedStorage.setRuntime({
    automation: {
      running: true,
      config,
      startedAt: new Date().toISOString(),
      sourceTabId
    }
  });
  await GrailedStorage.appendActivity({
    type: "system",
    message: "Automation started.",
    timestamp: new Date().toISOString()
  });
  await seedFromTab(sourceTabId, config);
  await scheduleQueuedNegotiations();
  return getPopupState();
}

async function stopAutomation() {
  const runtime = await GrailedStorage.getRuntime();
  const alarmNames = Object.keys(runtime.negotiations).map((listingId) => `${OFFER_ALARM_PREFIX}${listingId}`);
  await Promise.all(alarmNames.map((name) => chrome.alarms.clear(name)));
  await GrailedStorage.setRuntime({
    automation: {
      ...runtime.automation,
      running: false
    }
  });
  await GrailedStorage.appendActivity({
    type: "system",
    message: "Automation stopped.",
    timestamp: new Date().toISOString()
  });
  return getPopupState();
}

async function refreshFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return getPopupState();
  }
  const runtime = await GrailedStorage.getRuntime();
  if (!runtime.automation.config) {
    return getPopupState();
  }
  await seedFromTab(tab.id, runtime.automation.config);
  await scheduleQueuedNegotiations();
  return getPopupState();
}

async function seedFromTab(tabId, config) {
  if (!tabId) {
    return;
  }
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_PAGE" });
  } catch (error) {
    await GrailedStorage.appendActivity({
      type: "error",
      message: "Open a Grailed listing or search page before starting automation.",
      timestamp: new Date().toISOString()
    });
    return;
  }
  if (!response?.ok) {
    return;
  }

  const listings = response.page.type === "search"
    ? response.page.results
    : [response.page.listing];

  const settings = await GrailedStorage.getSettings();
  const blockedSellers = new Set(settings.blockedSellers.map((seller) => seller.toLowerCase()));

  for (const listing of listings) {
    if (!matchesSearchFilters(listing, config)) {
      continue;
    }
    if (listing.sellerName && blockedSellers.has(listing.sellerName.toLowerCase())) {
      continue;
    }
    const record = {
      listingId: listing.listingId,
      url: listing.url,
      title: listing.title,
      askingPrice: listing.price,
      brand: listing.brand,
      size: listing.size,
      sellerName: listing.sellerName || "",
      sellerResponseHours: listing.sellerResponseHours || null,
      rounds: 0,
      lastOffer: null,
      sellerCounter: null,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await GrailedStorage.upsertNegotiation(record);
  }
}

function matchesSearchFilters(listing, config) {
  const brandOk = !config.brand || !listing.brand || (listing.brand || "").toLowerCase().includes(config.brand.toLowerCase());
  const sizeOk = !config.size || !listing.size || (listing.size || "").toLowerCase().includes(config.size.toLowerCase());
  const categoryOk = !config.category || !listing.category || (listing.category || "").toLowerCase().includes(config.category.toLowerCase());
  const priceOk = !config.maxPrice || !listing.price || Number(listing.price) <= Number(config.maxPrice);
  return brandOk && sizeOk && categoryOk && priceOk;
}

async function scheduleQueuedNegotiations() {
  const [runtime, settings] = await Promise.all([
    GrailedStorage.getRuntime(),
    GrailedStorage.getSettings()
  ]);

  if (!runtime.automation.running) {
    return;
  }

  const eligible = Object.values(runtime.negotiations).filter((item) => item.status === "queued" || item.status === "countered");
  for (const negotiation of eligible) {
    const canSend = await withinRateLimits(settings);
    if (!canSend) {
      break;
    }
    const delayMinutes = randomDelayMinutes();
    await chrome.alarms.create(`${OFFER_ALARM_PREFIX}${negotiation.listingId}`, {
      delayInMinutes: delayMinutes
    });
    await GrailedStorage.upsertNegotiation({
      ...negotiation,
      status: "scheduled",
      scheduledFor: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}

function randomDelayMinutes() {
  const seconds = 30 + Math.floor(Math.random() * 61);
  return seconds / 60;
}

async function withinRateLimits(settings) {
  const runtime = await GrailedStorage.getRuntime();
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const sentTimes = runtime.offerHistory
    .filter((entry) => entry.type === "offer_sent")
    .map((entry) => new Date(entry.timestamp).getTime());
  const hourCount = sentTimes.filter((time) => time >= oneHourAgo).length;
  const dayCount = sentTimes.filter((time) => time >= oneDayAgo).length;
  return hourCount < settings.offerLimitHour && dayCount < settings.offerLimitDay;
}

async function executeNegotiation(listingId) {
  const [runtime, settings] = await Promise.all([
    GrailedStorage.getRuntime(),
    GrailedStorage.getSettings()
  ]);
  const negotiation = runtime.negotiations[listingId];
  if (!negotiation || !runtime.automation.running) {
    return;
  }
  if (!(await withinRateLimits(settings))) {
    await GrailedStorage.appendActivity({
      type: "rate_limit",
      message: `Paused ${negotiation.title || listingId} because offer limits were reached.`,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const tab = await chrome.tabs.create({ url: negotiation.url, active: false });
  EXECUTION_TABS.set(tab.id, {
    listingId,
    negotiation,
    config: runtime.automation.config
  });

  await GrailedStorage.upsertNegotiation({
    ...negotiation,
    status: "negotiating",
    executionTabId: tab.id,
    updatedAt: new Date().toISOString()
  });
}

async function handleExecutionResult(payload, sender) {
  const runtime = await GrailedStorage.getRuntime();
  const negotiation = runtime.negotiations[payload.listingId];
  if (!negotiation) {
    return {};
  }

  const executionTabId = sender.tab?.id;
  if (executionTabId && EXECUTION_TABS.has(executionTabId)) {
    EXECUTION_TABS.delete(executionTabId);
    try {
      await chrome.tabs.remove(executionTabId);
    } catch (error) {
      console.warn("Failed to close execution tab", error);
    }
  }

  const updatedNegotiation = {
    ...negotiation,
    sellerCounter: payload.pageData?.counterOffer ?? negotiation.sellerCounter,
    sellerResponseHours: payload.pageData?.sellerResponseHours ?? negotiation.sellerResponseHours,
    askingPrice: payload.pageData?.price ?? negotiation.askingPrice,
    updatedAt: new Date().toISOString()
  };

  if (payload.pageData?.sold) {
    await markNegotiationClosed(updatedNegotiation, "lost", "Listing sold before offer could be sent.");
    return getPopupState();
  }

  if (!payload.ok) {
    await GrailedStorage.upsertNegotiation({
      ...updatedNegotiation,
      status: "queued"
    });
    await GrailedStorage.appendActivity({
      type: "error",
      message: `${updatedNegotiation.title || updatedNegotiation.listingId}: ${payload.error}`,
      timestamp: new Date().toISOString()
    });
    await scheduleQueuedNegotiations();
    return getPopupState();
  }

  if (payload.result === "offer_sent") {
    const timestamp = new Date().toISOString();
    await GrailedStorage.upsertNegotiation({
      ...updatedNegotiation,
      lastOffer: payload.offer,
      rounds: payload.rounds,
      status: "waiting_response"
    });
    await GrailedStorage.appendOfferHistory({
      type: "offer_sent",
      listingId: payload.listingId,
      offer: payload.offer,
      timestamp
    });
    const refreshedRuntime = await GrailedStorage.getRuntime();
    await GrailedStorage.setRuntime({
      stats: {
        ...refreshedRuntime.stats,
        offersSent: refreshedRuntime.stats.offersSent + 1
      }
    });
    await GrailedStorage.appendActivity({
      type: "offer_sent",
      message: `Sent $${payload.offer} on ${updatedNegotiation.title || updatedNegotiation.listingId}.`,
      timestamp
    });
    await notifyIfEnabled("Offer sent", `${updatedNegotiation.title || "Listing"}: $${payload.offer}`);
  }

  if (payload.result === "waiting") {
    await GrailedStorage.upsertNegotiation({
      ...updatedNegotiation,
      status: "waiting_response"
    });
  }

  if (payload.result === "accepted_counter") {
    await markNegotiationClosed(updatedNegotiation, "won", `Accepted seller counter at $${payload.offer}.`);
  }

  if (payload.result === "walk_away") {
    await markNegotiationClosed(updatedNegotiation, "walked", payload.reason || "Walked away after negotiation cap.");
  }

  if (payload.pageData?.counterOffer) {
    const refreshedRuntime = await GrailedStorage.getRuntime();
    await GrailedStorage.setRuntime({
      stats: {
        ...refreshedRuntime.stats,
        countersReceived: refreshedRuntime.stats.countersReceived + 1
      }
    });
    await GrailedStorage.appendActivity({
      type: "counter",
      message: `${updatedNegotiation.title || updatedNegotiation.listingId} countered at $${payload.pageData.counterOffer}.`,
      timestamp: new Date().toISOString()
    });
    await notifyIfEnabled("Counter-offer received", `${updatedNegotiation.title || "Listing"}: $${payload.pageData.counterOffer}`);
  }

  return getPopupState();
}

async function markNegotiationClosed(negotiation, outcome, message) {
  const timestamp = new Date().toISOString();
  const runtime = await GrailedStorage.getRuntime();
  const askingPrice = Number(negotiation.askingPrice) || 0;
  const finalPrice = Number(negotiation.lastOffer || negotiation.sellerCounter || askingPrice) || askingPrice;
  const savingsDelta = Math.max(0, askingPrice - finalPrice);
  const dealLogEntry = {
    listingId: negotiation.listingId,
    title: negotiation.title,
    sellerName: negotiation.sellerName,
    outcome,
    finalPrice,
    askingPrice,
    savings: savingsDelta,
    timestamp
  };

  await GrailedStorage.upsertNegotiation({
    ...negotiation,
    status: outcome
  });
  await GrailedStorage.appendActivity({
    type: outcome,
    message,
    timestamp
  });

  const settings = await GrailedStorage.getSettings();
  await GrailedStorage.setSettings({
    dealLog: [dealLogEntry, ...settings.dealLog].slice(0, 200)
  });

  const refreshedRuntime = await GrailedStorage.getRuntime();
  await GrailedStorage.setRuntime({
    stats: {
      ...refreshedRuntime.stats,
      totalSavings: refreshedRuntime.stats.totalSavings + (outcome === "won" ? savingsDelta : 0),
      dealsWon: refreshedRuntime.stats.dealsWon + (outcome === "won" ? 1 : 0)
    }
  });

  if (outcome === "won") {
    await notifyIfEnabled("Deal closed", message);
  }
}

async function notifyIfEnabled(title, message) {
  const settings = await GrailedStorage.getSettings();
  if (!settings.notificationsEnabled) {
    return;
  }
  await chrome.notifications.create({
    type: "basic",
    iconUrl: "/icons/icon48.png",
    title,
    message
  });
}
