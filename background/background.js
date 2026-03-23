importScripts("../lib/templates.js", "../lib/storage.js", "../lib/negotiator.js", "../lib/ai-negotiator.js");

const OFFER_ALARM_PREFIX = "offer:";
const EXECUTION_TABS = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  await Promise.all([
    GrailedStorage.getSettings(),
    GrailedStorage.getRuntime()
  ]);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("Message handling failed", error);
      sendResponse({ ok: false, error: error?.message || "Unknown background error." });
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
    await requeueNegotiation(listingId, error?.message || "Failed to execute negotiation alarm.");
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
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
    await requeueNegotiation(context.listingId, "Grailed page was not ready for automation.");
    await closeExecutionTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  EXECUTION_TABS.delete(tabId);
});

async function handleMessage(message, sender) {
  switch (message?.type) {
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
    case "GENERATE_NEGOTIATION_MESSAGE":
      return generateNegotiationMessage(message.payload);
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
  return getPopupState();
}

async function saveSettings(payload) {
  const settings = await GrailedStorage.setSettings(payload || {});
  return { settings };
}

async function startAutomation(config, sender) {
  const sourceTabId = sender.tab?.id || config?.sourceTabId || null;
  const normalizedConfig = normalizeAutomationConfig(config);
  await GrailedStorage.setRuntime({
    automation: {
      running: true,
      config: normalizedConfig,
      startedAt: new Date().toISOString(),
      sourceTabId
    }
  });
  await GrailedStorage.appendActivity({
    type: "system",
    message: "Automation started.",
    timestamp: new Date().toISOString()
  });
  await seedFromTab(sourceTabId, normalizedConfig);
  await scheduleQueuedNegotiations();
  return getPopupState();
}

async function stopAutomation() {
  const runtime = await GrailedStorage.getRuntime();
  const alarmNames = Object.keys(runtime.negotiations).map((listingId) => `${OFFER_ALARM_PREFIX}${listingId}`);
  await Promise.all(alarmNames.map((name) => chrome.alarms.clear(name)));
  await Promise.all(Array.from(EXECUTION_TABS.keys()).map((tabId) => closeExecutionTab(tabId)));
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
    await GrailedStorage.appendActivity({
      type: "error",
      message: "No active tab available to refresh.",
      timestamp: new Date().toISOString()
    });
    return getPopupState();
  }
  const runtime = await GrailedStorage.getRuntime();
  if (!runtime.automation.config) {
    await GrailedStorage.appendActivity({
      type: "error",
      message: "Set up automation in the popup before refreshing.",
      timestamp: new Date().toISOString()
    });
    return getPopupState();
  }
  await seedFromTab(tab.id, runtime.automation.config);
  await scheduleQueuedNegotiations();
  return getPopupState();
}

async function generateNegotiationMessage(payload) {
  const { listing, config, negotiation, sellerCounter, targetOffer } = payload || {};
  const messageResult = await GrailedAI.getMessage(
    listing || {},
    config || {},
    negotiation || {},
    sellerCounter ?? null,
    Number(targetOffer) || 0
  );
  return { messageResult };
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
  if (!response?.ok || !response.page) {
    await GrailedStorage.appendActivity({
      type: "error",
      message: response?.error || "Could not read the active Grailed page.",
      timestamp: new Date().toISOString()
    });
    return;
  }

  const listings = response.page.type === "search"
    ? response.page.results
    : [response.page.listing];

  const settings = await GrailedStorage.getSettings();
  const blockedSellers = new Set(settings.blockedSellers.map((seller) => seller.toLowerCase()));
  let discoveredCount = 0;

  for (const listing of listings) {
    if (!listing?.listingId || !listing?.url || !listing?.price) {
      continue;
    }
    if (!matchesSearchFilters(listing, config)) {
      continue;
    }
    if (listing.sellerName && blockedSellers.has(listing.sellerName.toLowerCase())) {
      continue;
    }

    const runtime = await GrailedStorage.getRuntime();
    const existing = runtime.negotiations[listing.listingId] || {};
    const record = {
      listingId: listing.listingId,
      url: listing.url,
      title: listing.title,
      askingPrice: listing.price,
      brand: listing.brand,
      size: listing.size,
      category: listing.category || "",
      sellerName: listing.sellerName || existing.sellerName || "",
      sellerResponseHours: listing.sellerResponseHours ?? existing.sellerResponseHours ?? null,
      rounds: existing.rounds || 0,
      lastOffer: existing.lastOffer || null,
      sellerCounter: listing.counterOffer ?? existing.sellerCounter ?? null,
      history: Array.isArray(existing.history) ? existing.history : [],
      status: existing.status && existing.status !== "lost" && existing.status !== "won" && existing.status !== "walked"
        ? existing.status
        : "queued",
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await GrailedStorage.upsertNegotiation(record);
    discoveredCount += 1;
  }

  await GrailedStorage.appendActivity({
    type: "system",
    message: discoveredCount
      ? `Found ${discoveredCount} matching listing${discoveredCount === 1 ? "" : "s"} on the current page.`
      : "No matching Grailed listings were found on the current page.",
    timestamp: new Date().toISOString()
  });
}

function normalizeAutomationConfig(config) {
  return {
    brand: String(config?.brand || "").trim(),
    size: String(config?.size || "").trim(),
    category: String(config?.category || "").trim(),
    maxPrice: Number(config?.maxPrice) > 0 ? Number(config.maxPrice) : null,
    aggressiveness: Math.min(100, Math.max(0, Number(config?.aggressiveness) || 45)),
    sourceTabId: config?.sourceTabId || null
  };
}

function matchesSearchFilters(listing, config) {
  const brandOk = !config.brand || Boolean(listing.brand && listing.brand.toLowerCase().includes(config.brand.toLowerCase()));
  const sizeOk = !config.size || Boolean(listing.size && listing.size.toLowerCase().includes(config.size.toLowerCase()));
  const categoryOk = !config.category || Boolean(listing.category && listing.category.toLowerCase().includes(config.category.toLowerCase()));
  const priceOk = !config.maxPrice || (Number(listing.price) > 0 && Number(listing.price) <= Number(config.maxPrice));
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

  const eligible = Object.values(runtime.negotiations)
    .filter((item) => item?.listingId)
    .filter((item) => item.status === "queued" || item.status === "countered");

  for (const negotiation of eligible) {
    const existingAlarm = await chrome.alarms.get(`${OFFER_ALARM_PREFIX}${negotiation.listingId}`);
    if (existingAlarm) {
      continue;
    }
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
    .map((entry) => new Date(entry.timestamp).getTime())
    .filter((time) => Number.isFinite(time));
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
  if (!negotiation.url) {
    await requeueNegotiation(listingId, "Cannot negotiate without a valid listing URL.");
    return;
  }
  if (!(await withinRateLimits(settings))) {
    await requeueNegotiation(listingId, `Paused ${negotiation.title || listingId} because offer limits were reached.`);
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
  const negotiation = runtime.negotiations[payload?.listingId];
  if (!negotiation) {
    return {};
  }

  const executionTabId = sender.tab?.id;
  if (executionTabId && EXECUTION_TABS.has(executionTabId)) {
    await closeExecutionTab(executionTabId);
  }

  const previousCounter = Number(negotiation.sellerCounter) || null;
  const nextCounter = payload.pageData?.counterOffer ?? negotiation.sellerCounter;
  const updatedNegotiation = {
    ...negotiation,
    sellerCounter: nextCounter,
    sellerResponseHours: payload.pageData?.sellerResponseHours ?? negotiation.sellerResponseHours,
    askingPrice: payload.pageData?.price ?? negotiation.askingPrice,
    title: payload.pageData?.title || negotiation.title,
    updatedAt: new Date().toISOString()
  };

  if (payload.pageData?.sold) {
    await markNegotiationClosed(updatedNegotiation, "lost", "Listing sold before an offer could be completed.");
    return getPopupState();
  }

  if (!payload.ok) {
    await requeueNegotiation(updatedNegotiation.listingId, `${updatedNegotiation.title || updatedNegotiation.listingId}: ${payload.error || "Offer execution failed."}`, updatedNegotiation);
    return getPopupState();
  }

  if (payload.result === "offer_sent") {
    const timestamp = new Date().toISOString();
    const history = [
      ...(Array.isArray(updatedNegotiation.history) ? updatedNegotiation.history : []),
      {
        role: "buyer",
        amount: payload.offer,
        message: payload.message,
        timestamp
      }
    ].slice(-10);
    await GrailedStorage.upsertNegotiation({
      ...updatedNegotiation,
      lastOffer: payload.offer,
      rounds: payload.rounds,
      lastMessage: payload.message || "",
      lastMessageSource: payload.messageSource || "template",
      history,
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
      message: `Sent $${payload.offer} on ${updatedNegotiation.title || updatedNegotiation.listingId} using ${payload.messageSource || "template"} messaging.`,
      timestamp
    });
    await notifyIfEnabled("Offer sent", `${updatedNegotiation.title || "Listing"}: $${payload.offer}`);
  }

  if (payload.result === "waiting") {
    await GrailedStorage.upsertNegotiation({
      ...updatedNegotiation,
      status: payload.pageData?.counterOffer ? "countered" : "waiting_response"
    });
  }

  if (payload.result === "accepted_counter") {
    const history = [
      ...(Array.isArray(updatedNegotiation.history) ? updatedNegotiation.history : []),
      {
        role: "seller",
        counter: Number(updatedNegotiation.sellerCounter) || payload.offer || null,
        timestamp: new Date().toISOString()
      }
    ].slice(-10);
    await markNegotiationClosed({
      ...updatedNegotiation,
      sellerCounter: payload.offer || updatedNegotiation.sellerCounter,
      history
    }, "won", `Accepted seller counter at $${payload.offer}.`);
  }

  if (payload.result === "walk_away") {
    await markNegotiationClosed(updatedNegotiation, "walked", payload.reason || "Walked away after reaching the negotiation cap.");
  }

  if (
    nextCounter &&
    nextCounter !== previousCounter &&
    payload.result !== "accepted_counter" &&
    payload.result !== "walk_away"
  ) {
    const timestamp = new Date().toISOString();
    const history = [
      ...(Array.isArray(updatedNegotiation.history) ? updatedNegotiation.history : []),
      {
        role: "seller",
        counter: Number(nextCounter),
        timestamp
      }
    ].slice(-10);
    await GrailedStorage.upsertNegotiation({
      ...updatedNegotiation,
      history,
      status: payload.result === "offer_sent" ? "waiting_response" : "countered"
    });
    const refreshedRuntime = await GrailedStorage.getRuntime();
    await GrailedStorage.setRuntime({
      stats: {
        ...refreshedRuntime.stats,
        countersReceived: refreshedRuntime.stats.countersReceived + 1
      }
    });
    await GrailedStorage.appendActivity({
      type: "counter",
      message: `${updatedNegotiation.title || updatedNegotiation.listingId} countered at $${nextCounter}.`,
      timestamp
    });
    await notifyIfEnabled("Counter-offer received", `${updatedNegotiation.title || "Listing"}: $${nextCounter}`);
  }

  await scheduleQueuedNegotiations();
  return getPopupState();
}

async function requeueNegotiation(listingId, message, baseRecord) {
  const runtime = await GrailedStorage.getRuntime();
  const negotiation = baseRecord || runtime.negotiations[listingId];
  if (!negotiation) {
    return;
  }
  await chrome.alarms.clear(`${OFFER_ALARM_PREFIX}${listingId}`);
  await GrailedStorage.upsertNegotiation({
    ...negotiation,
    status: "queued",
    scheduledFor: null,
    executionTabId: null,
    updatedAt: new Date().toISOString()
  });
  if (message) {
    await GrailedStorage.appendActivity({
      type: "error",
      message,
      timestamp: new Date().toISOString()
    });
  }
}

async function markNegotiationClosed(negotiation, outcome, message) {
  const timestamp = new Date().toISOString();
  const askingPrice = Number(negotiation.askingPrice) || 0;
  const finalPrice = Number(negotiation.sellerCounter || negotiation.lastOffer || askingPrice) || askingPrice;
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

  await chrome.alarms.clear(`${OFFER_ALARM_PREFIX}${negotiation.listingId}`);
  await GrailedStorage.upsertNegotiation({
    ...negotiation,
    status: outcome,
    scheduledFor: null,
    executionTabId: null,
    updatedAt: timestamp
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

async function closeExecutionTab(tabId) {
  EXECUTION_TABS.delete(tabId);
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    console.warn("Failed to close execution tab", error);
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
