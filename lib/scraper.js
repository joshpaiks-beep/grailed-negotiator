(function initScraper(globalScope) {
  const SELECTORS = {
    title: [
      "[data-testid='listing-title']",
      "meta[property='og:title']",
      "h1"
    ],
    price: [
      "[data-testid='listing-price']",
      "[data-cy='listing-price']",
      "meta[property='product:price:amount']",
      "[aria-label*='price' i]",
      "main [class*='Price']"
    ],
    brand: [
      "[data-testid='listing-brand']",
      "a[href*='/designers/']",
      "a[href*='/shop/']",
      "[class*='Designer'] a"
    ],
    size: [
      "[data-testid='listing-size']",
      "[class*='Size']",
      "button[aria-label*='size']"
    ],
    category: [
      "[data-testid='breadcrumb'] a",
      "nav a[href*='/shop/']"
    ],
    condition: [
      "[data-testid='listing-condition']",
      "[class*='Condition']"
    ],
    description: [
      "[data-testid='listing-description']",
      "meta[property='og:description']",
      "[class*='Description']"
    ],
    sellerName: [
      "[data-testid='seller-name']",
      "a[href*='/users/']",
      "[class*='Seller'] a"
    ],
    sellerResponse: [
      "[data-testid='seller-response-time']",
      "[aria-label*='response' i]",
      "[class*='Response']"
    ],
    photo: [
      "[data-testid='listing-photo'] img",
      "img[src*='grailed']"
    ],
    makeOfferButton: [
      "button[data-testid='make-offer-button']",
      "button[aria-label*='Offer']",
      "button"
    ],
    offerInput: [
      "input[inputmode='numeric']",
      "input[name*='offer']",
      "input[placeholder*='$']"
    ],
    messageInput: [
      "textarea",
      "input[name*='message']"
    ],
    submitOfferButton: [
      "button[data-testid='submit-offer-button']",
      "button[type='submit']"
    ],
    acceptCounterButton: [
      "button[data-testid='accept-counter-button']",
      "button[aria-label*='Accept']",
      "button"
    ],
    counterOffer: [
      "[data-testid='counter-offer-price']",
      "[class*='CounterOffer']",
      "[class*='OfferThread']"
    ],
    soldBadge: [
      "[data-testid='sold-badge']",
      "[aria-label*='sold' i]",
      "[class*='Sold']",
      "button[disabled]"
    ],
    searchCards: [
      "[data-testid='listing-grid'] a[href*='/listings/']",
      "main a[href*='/listings/']",
      "a[href*='/listings/']"
    ]
  };

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const nodes = Array.from(root.querySelectorAll(selector));
      if (selector === "button") {
        const matchedButton = nodes.find((node) => /make offer/i.test(node.textContent || ""));
        if (matchedButton) {
          return matchedButton;
        }
        continue;
      }
      if (nodes.length) {
        return nodes[0];
      }
    }
    return null;
  }

  function queryAll(selectors, root = document) {
    for (const selector of selectors) {
      const nodes = Array.from(root.querySelectorAll(selector));
      if (nodes.length) {
        return nodes;
      }
    }
    return [];
  }

  function textFrom(selectors, root = document) {
    const node = queryFirst(selectors, root);
    if (!node) {
      return "";
    }
    if (node.tagName === "META") {
      return normalizeWhitespace(node.getAttribute("content") || "");
    }
    return normalizeWhitespace(node.textContent || "");
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parsePrice(value) {
    const normalized = normalizeWhitespace(value);
    const match = normalized.match(/\$?([\d,]+(?:\.\d{1,2})?)/);
    return match ? Number(match[1].replaceAll(",", "")) : null;
  }

  function parseSellerResponseHours(text) {
    const normalized = normalizeWhitespace(text).toLowerCase();
    if (!normalized) {
      return null;
    }
    const numberMatch = normalized.match(/(\d+(?:\.\d+)?)/);
    const amount = numberMatch ? Number(numberMatch[1]) : 1;
    if (/minute/.test(normalized)) {
      return amount / 60;
    }
    if (/day/.test(normalized)) {
      return amount * 24;
    }
    if (/week/.test(normalized)) {
      return amount * 24 * 7;
    }
    if (/hour/.test(normalized)) {
      return amount;
    }
    return null;
  }

  function parseListingAge(text) {
    const normalized = normalizeWhitespace(text).toLowerCase();
    const numberMatch = normalized.match(/(\d+(?:\.\d+)?)/);
    if (!numberMatch) {
      return null;
    }
    const amount = Number(numberMatch[1]);
    const now = new Date();
    if (/minute/.test(normalized)) {
      now.setMinutes(now.getMinutes() - amount);
    } else if (/hour/.test(normalized)) {
      now.setHours(now.getHours() - amount);
    } else if (/day/.test(normalized)) {
      now.setDate(now.getDate() - amount);
    } else if (/week/.test(normalized)) {
      now.setDate(now.getDate() - amount * 7);
    } else if (/month/.test(normalized)) {
      now.setMonth(now.getMonth() - amount);
    } else {
      return null;
    }
    return now.toISOString();
  }

  function getListingIdFromUrl(url = location.href) {
    const match = url.match(/\/listings\/(\d+)/);
    return match ? match[1] : null;
  }

  function readStructuredListing() {
    const scripts = Array.from(document.querySelectorAll("script[type='application/ld+json']"));
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items.flatMap(flattenJsonLd)) {
          if (item?.["@type"] === "Product" || item?.offers?.price) {
            return item;
          }
        }
      } catch (error) {
        console.warn("Unable to parse listing JSON-LD", error);
      }
    }
    return null;
  }

  function flattenJsonLd(item) {
    if (!item || typeof item !== "object") {
      return [];
    }
    if (Array.isArray(item["@graph"])) {
      return item["@graph"];
    }
    return [item];
  }

  function findListingMeta() {
    const candidates = Array.from(document.querySelectorAll("time, span, div"));
    const ageNode = candidates.find((node) => /listed|posted/i.test(node.textContent || ""));
    return ageNode ? parseListingAge(ageNode.textContent || "") : null;
  }

  function findCounterOfferValue() {
    const candidates = queryAll(SELECTORS.counterOffer);
    for (const candidate of candidates) {
      const price = parsePrice(candidate.textContent || "");
      if (price) {
        return price;
      }
    }
    return null;
  }

  function isSold() {
    const badge = queryFirst(SELECTORS.soldBadge);
    if (!badge) {
      // Check for a dedicated sold overlay or banner, not the entire page text
      const soldOverlay = document.querySelector('[class*="SoldOverlay"], [class*="sold-overlay"], [class*="SoldBanner"], [data-testid="sold-tag"]');
      if (soldOverlay) return true;
      // If the PURCHASE button exists, it's definitely not sold
      const purchaseBtn = document.querySelector('button[class*="purchase" i], a[class*="purchase" i], [data-testid="purchase-button"]');
      if (purchaseBtn) return false;
      return false;
    }
    return /sold|purchased/i.test(badge.textContent || "") || badge.disabled;
  }

  function scrapeListingData() {
    const structured = readStructuredListing();
    const photos = queryAll(SELECTORS.photo)
      .map((img) => img.currentSrc || img.src)
      .filter(Boolean)
      .slice(0, 8);
    const priceText = textFrom(SELECTORS.price);
    const breadcrumbCategory = queryAll(SELECTORS.category)
      .map((node) => normalizeWhitespace(node.textContent || ""))
      .filter(Boolean)
      .join(" / ");
    const makeOfferButton = findMakeOfferButton();

    return {
      url: location.href,
      listingId: getListingIdFromUrl(),
      title: structured?.name || textFrom(SELECTORS.title),
      price: parsePrice(priceText) || Number(structured?.offers?.price) || null,
      brand: structured?.brand?.name || textFrom(SELECTORS.brand),
      size: textFrom(SELECTORS.size),
      category: breadcrumbCategory,
      condition: textFrom(SELECTORS.condition),
      description: structured?.description || textFrom(SELECTORS.description),
      sellerName: structured?.offers?.seller?.name || textFrom(SELECTORS.sellerName),
      sellerResponseText: textFrom(SELECTORS.sellerResponse),
      sellerResponseHours: parseSellerResponseHours(textFrom(SELECTORS.sellerResponse)),
      photos,
      listedAt: findListingMeta(),
      sold: isSold(),
      counterOffer: findCounterOfferValue(),
      canMakeOffer: Boolean(makeOfferButton && !makeOfferButton.disabled)
    };
  }

  function scrapeSearchResults() {
    const cards = queryAll(SELECTORS.searchCards);
    const unique = new Map();
    for (const anchor of cards) {
      const url = anchor.href || anchor.closest("a")?.href;
      if (!url || unique.has(url)) {
        continue;
      }
      const cardRoot = anchor.closest("article, li, div") || anchor;
      const text = normalizeWhitespace(cardRoot.textContent || "");
      const cardCategory = Array.from(cardRoot.querySelectorAll("a"))
        .map((node) => normalizeWhitespace(node.textContent || ""))
        .filter(Boolean)
        .slice(0, 4)
        .join(" / ");
      unique.set(url, {
        url,
        listingId: getListingIdFromUrl(url),
        title: normalizeWhitespace(anchor.getAttribute("aria-label") || anchor.textContent || text),
        price: parsePrice(text),
        brand: normalizeWhitespace(cardRoot.querySelector("a[href*='/designers/']")?.textContent || ""),
        size: normalizeWhitespace(text.match(/\b(?:xxs|xs|s|m|l|xl|xxl|xxxl|\d{2,3})\b/i)?.[0] || ""),
        category: cardCategory
      });
    }
    return Array.from(unique.values()).filter((listing) => listing.listingId);
  }

  function findMakeOfferButton() {
    const candidates = queryAll(SELECTORS.makeOfferButton);
    return candidates.find((button) => /make offer|send offer|offer/i.test(button.textContent || button.getAttribute("aria-label") || "")) || null;
  }

  function findOfferInput() {
    return queryFirst(SELECTORS.offerInput);
  }

  function findMessageInput() {
    return queryFirst(SELECTORS.messageInput);
  }

  function findSubmitOfferButton() {
    const candidates = queryAll(SELECTORS.submitOfferButton);
    return candidates.find((button) => /submit|send offer|make offer|send/i.test(button.textContent || "")) || candidates[0] || null;
  }

  function findAcceptCounterButton() {
    const candidates = queryAll(SELECTORS.acceptCounterButton);
    return candidates.find((button) => /accept|buy now|checkout/i.test(button.textContent || button.getAttribute("aria-label") || "")) || null;
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function submitOffer({ offer, message }) {
    const makeOfferButton = findMakeOfferButton();
    if (!makeOfferButton) {
      return { ok: false, error: "Make Offer button not found." };
    }

    makeOfferButton.click();
    await wait(600);

    const offerInput = findOfferInput();
    if (!offerInput) {
      return { ok: false, error: "Offer input not found." };
    }

    offerInput.focus();
    offerInput.value = String(offer);
    dispatchInputEvents(offerInput);

    const messageInput = findMessageInput();
    if (messageInput && message) {
      messageInput.focus();
      messageInput.value = message;
      dispatchInputEvents(messageInput);
    }

    await wait(200);
    const submitButton = findSubmitOfferButton();
    if (!submitButton) {
      return { ok: false, error: "Offer submit button not found." };
    }
    if (submitButton.disabled) {
      return { ok: false, error: "Offer submit button is disabled." };
    }

    submitButton.click();
    return { ok: true };
  }

  async function acceptCounter() {
    const acceptButton = findAcceptCounterButton();
    if (!acceptButton) {
      return { ok: false, error: "Accept counter button not found." };
    }
    acceptButton.click();
    return { ok: true };
  }

  function wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  globalScope.GrailedScraper = {
    SELECTORS,
    parsePrice,
    parseSellerResponseHours,
    getListingIdFromUrl,
    scrapeListingData,
    scrapeSearchResults,
    findMakeOfferButton,
    findOfferInput,
    findMessageInput,
    findSubmitOfferButton,
    findAcceptCounterButton,
    acceptCounter,
    submitOffer
  };
})(self);
