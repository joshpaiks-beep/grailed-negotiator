/**
 * AI Negotiation Module
 * Calls the Cloudflare Worker to generate human-like negotiation messages.
 * Falls back to templates if the worker is unavailable.
 */
(function initAINegotiator(globalScope) {

  const DEFAULT_WORKER_URL = 'https://grailed-negotiator.YOUR_SUBDOMAIN.workers.dev';

  /**
   * Get the worker URL from storage or use default
   */
  async function getWorkerUrl() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['workerUrl'], (result) => {
          resolve(result.workerUrl || DEFAULT_WORKER_URL);
        });
      } else {
        resolve(DEFAULT_WORKER_URL);
      }
    });
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

    // Reconstruct conversation from negotiation history
    if (negotiation.history && Array.isArray(negotiation.history)) {
      negotiation.history.forEach((entry) => {
        conversation.push(entry);
      });
    } else {
      // If no history array, build from what we know
      if (negotiation.lastOffer) {
        conversation.push({ role: 'buyer', amount: negotiation.lastOffer });
      }
      if (sellerCounter) {
        conversation.push({ role: 'seller', counter: sellerCounter });
      }
    }

    return {
      listing: {
        title: listing.title || 'Unknown item',
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
      const payload = buildPayload(listing, config, negotiation, sellerCounter, targetOffer);

      const response = await fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': config.clientId || 'extension',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn('[AI Negotiator] Worker returned', response.status);
        return null;
      }

      const result = await response.json();

      if (result.message) {
        return { message: result.message, source: 'ai' };
      }

      return null;
    } catch (err) {
      console.warn('[AI Negotiator] Worker unreachable, falling back to templates:', err.message);
      return null;
    }
  }

  /**
   * Get a negotiation message — tries AI first, falls back to templates
   */
  async function getMessage(listing, config, negotiation, sellerCounter, targetOffer) {
    // Check if AI mode is enabled
    const aiEnabled = await new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['aiMode'], (result) => {
          resolve(result.aiMode !== false); // default to true
        });
      } else {
        resolve(true);
      }
    });

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

    return { message: templateMessage, source: 'template' };
  }

  globalScope.GrailedAI = {
    generateAIMessage,
    getMessage,
    buildPayload,
    aggressivenessLabel,
  };

})(self);
