/**
 * AI Negotiation Module
 * Calls the Cloudflare Worker to generate human-like negotiation messages.
 * Falls back to templates if the worker is unavailable.
 */
(function initAINegotiator(globalScope) {
  const DEFAULT_WORKER_URL = "";
  const REQUEST_TIMEOUT_MS = 8000;

  async function getStoredSettings() {
    if (globalScope.GrailedStorage?.getSettings) {
      return globalScope.GrailedStorage.getSettings();
    }
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const result = await chrome.storage.local.get(["settings", "workerUrl", "aiMode"]);
      return {
        ...(result.settings || {}),
        workerUrl: result.settings?.workerUrl || result.workerUrl || DEFAULT_WORKER_URL,
        aiMode: result.settings?.aiMode ?? result.aiMode ?? true
      };
    }
    return {
      workerUrl: DEFAULT_WORKER_URL,
      aiMode: true
    };
  }

  async function getWorkerUrl() {
    const settings = await getStoredSettings();
    const workerUrl = String(settings.workerUrl || "").trim();
    return /^https?:\/\//i.test(workerUrl) ? workerUrl : DEFAULT_WORKER_URL;
  }

  /**
   * Map aggressiveness slider (0-100) to label
   */
  function aggressivenessLabel(value) {
    const v = Number(value) || 50;
    if (v <= 25) return 'chill';
    if (v <= 50) return 'moderate';
    if (v <= 75) return 'aggressive';
    return 'savage';
  }

  /**
   * Build the request payload for the Cloudflare Worker
   */
  function buildPayload(listing, config, negotiation, sellerCounter, targetOffer) {
    const conversation = [];
    const history = Array.isArray(negotiation?.history) ? negotiation.history : [];

    for (const entry of history) {
      if (!entry || !entry.role) {
        continue;
      }
      conversation.push({
        role: entry.role,
        amount: Number(entry.amount) || undefined,
        counter: Number(entry.counter) || undefined,
        message: entry.message ? String(entry.message).slice(0, 280) : undefined
      });
    }

    if (!conversation.length) {
      if (negotiation?.lastOffer) {
        conversation.push({ role: "buyer", amount: Number(negotiation.lastOffer) });
      }
      if (sellerCounter) {
        conversation.push({ role: "seller", counter: Number(sellerCounter) });
      }
    }

    return {
      listing: {
        title: listing.title || "Unknown item",
        asking_price: Number(listing.price) || 0,
        condition: listing.condition || null,
        listed_days_ago: listing.listedAt
          ? Math.floor((Date.now() - new Date(listing.listedAt).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        brand: listing.brand || null,
        seller_rating: listing.sellerRating || null,
        seller_transactions: listing.sellerTransactions || null,
        description: listing.description || null,
      },
      conversation,
      strategy: {
        max_price: Number(config.maxPrice) || Number(listing.price),
        target_offer: targetOffer,
        aggressiveness: aggressivenessLabel(config.aggressiveness),
        round: (Number(negotiation.rounds) || 0) + 1,
      },
    };
  }

  /**
   * Call the Cloudflare Worker for an AI-generated message
   * Returns { message, source: 'ai' } on success
   * Returns null on failure (caller should fall back to templates)
   */
  async function generateAIMessage(listing, config, negotiation, sellerCounter, targetOffer) {
    try {
      const workerUrl = await getWorkerUrl();
      if (!workerUrl || /YOUR_SUBDOMAIN/i.test(workerUrl)) {
        return null;
      }
      const payload = buildPayload(listing, config, negotiation, sellerCounter, targetOffer);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": config.clientId || "extension",
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        console.warn("[AI Negotiator] Worker returned", response.status);
        return null;
      }

      const result = await response.json();
      const message = sanitizeMessage(result?.message);

      if (message) {
        return { message, source: "ai" };
      }

      return null;
    } catch (err) {
      console.warn("[AI Negotiator] Worker unreachable, falling back to templates:", err?.message || err);
      return null;
    }
  }

  /**
   * Get a negotiation message — tries AI first, falls back to templates
   */
  async function getMessage(listing, config, negotiation, sellerCounter, targetOffer) {
    const settings = await getStoredSettings();
    const aiEnabled = settings.aiMode !== false;

    if (aiEnabled) {
      const aiResult = await generateAIMessage(listing, config, negotiation, sellerCounter, targetOffer);
      if (aiResult) {
        return aiResult;
      }
    }

    // Fallback to templates
    const templateMessage = globalScope.GrailedTemplates
      ? globalScope.GrailedTemplates.renderTemplate(targetOffer)
      : `would you take $${targetOffer}?`;

    return { message: templateMessage, source: "template" };
  }

  function sanitizeMessage(value) {
    const normalized = String(value || "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) {
      return "";
    }
    return normalized.slice(0, 280);
  }

  globalScope.GrailedAI = {
    generateAIMessage,
    getMessage,
    buildPayload,
    aggressivenessLabel,
  };

})(self);
