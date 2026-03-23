(function initScraper(globalScope) {
  const SELECTORS = {
    listingContainer: [
      "[data-testid='listing-page']",
      "[data-cy='listing-page']",
      "main"
    ],
    title: [
      "[data-testid='listing-title']",
      "h1"
    ],
    price: [
      "[data-testid='listing-price']",
      "[data-cy='listing-price']",
      "main [class*='Price']"
    ],
    brand: [
      "[data-testid='listing-brand']",
      "a[href*='/designers/']",
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
      "[class*='Description']"
    ],
    sellerName: [
      "[data-testid='seller-name']",
      "a[href*='/users/']",
      "[class*='Seller'] a"
    ],
    sellerResponse: [
      "[data-testid='seller-response-time']",
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
      "[class*='Sold']",
      "button[disabled]"
    ],
    searchCards: [
      "[data-testid='listing-grid'] a[href*='/listings/']",
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
    return node ? normalizeWhitespace(node.textContent || "") : "";
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
      return /sold/i.test(document.body.textContent || "");
    }
    return /sold|purchased/i.test(badge.textContent || "") || badge.disabled;
  }

  function scrapeListingData() {
    const photos = queryAll(SELECTORS.photo)
      .map((img) => img.currentSrc || img.src)
      .filter(Boolean)
      .slice(0, 8);

    return {
      url: location.href,
      listingId: getListingIdFromUrl(),
      title: textFrom(SELECTORS.title),
      price: parsePrice(textFrom(SELECTORS.price)),
      brand: textFrom(SELECTORS.brand),
      size: textFrom(SELECTORS.size),
      category: textFrom(SELECTORS.category),
      condition: textFrom(SELECTORS.condition),
      description: textFrom(SELECTORS.description),
      sellerName: textFrom(SELECTORS.sellerName),
      sellerResponseText: textFrom(SELECTORS.sellerResponse),
      sellerResponseHours: parseSellerResponseHours(textFrom(SELECTORS.sellerResponse)),
      photos,
      listedAt: findListingMeta(),
      sold: isSold(),
      counterOffer: findCounterOfferValue(),
      canMakeOffer: Boolean(findMakeOfferButton())
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
      unique.set(url, {
        url,
        listingId: getListingIdFromUrl(url),
        title: normalizeWhitespace(anchor.textContent || cardRoot.textContent || ""),
        price: parsePrice(cardRoot.textContent || ""),
        brand: normalizeWhitespace(cardRoot.querySelector("a[href*='/designers/']")?.textContent || ""),
        size: normalizeWhitespace(cardRoot.textContent.match(/\b(?:XS|S|M|L|XL|XXL|\d{2})\b/i)?.[0] || "")
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
