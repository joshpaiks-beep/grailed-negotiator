(function initScraper(globalScope) {
  // ---------------------------------------------------------------------------
  // Utility helpers (unchanged API)
  // ---------------------------------------------------------------------------

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
    if (!normalized) return null;
    const numberMatch = normalized.match(/(\d+(?:\.\d+)?)/);
    const amount = numberMatch ? Number(numberMatch[1]) : 1;
    if (/minute/.test(normalized)) return amount / 60;
    if (/day/.test(normalized)) return amount * 24;
    if (/week/.test(normalized)) return amount * 24 * 7;
    if (/hour/.test(normalized)) return amount;
    return null;
  }

  function parseListingAge(text) {
    try {
      const normalized = normalizeWhitespace(text).toLowerCase();
      const numberMatch = normalized.match(/(\d+(?:\.\d+)?)/);
      if (!numberMatch) return null;
      const amount = Number(numberMatch[1]);
      if (!Number.isFinite(amount) || amount < 0) return null;
      const now = new Date();
      if (/minute/.test(normalized)) now.setMinutes(now.getMinutes() - amount);
      else if (/hour/.test(normalized)) now.setHours(now.getHours() - amount);
      else if (/day/.test(normalized)) now.setDate(now.getDate() - amount);
      else if (/week/.test(normalized)) now.setDate(now.getDate() - amount * 7);
      else if (/month/.test(normalized)) now.setMonth(now.getMonth() - amount);
      else if (/year/.test(normalized)) now.setFullYear(now.getFullYear() - amount);
      else return null;
      return now.toISOString();
    } catch (_err) {
      return null;
    }
  }

  function getListingIdFromUrl(url) {
    const href = url || (typeof location !== "undefined" ? location.href : "");
    const match = href.match(/\/listings\/(\d+)/);
    return match ? match[1] : null;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---------------------------------------------------------------------------
  // JSON-LD structured data (unchanged)
  // ---------------------------------------------------------------------------

  function flattenJsonLd(item) {
    if (!item || typeof item !== "object") return [];
    if (Array.isArray(item["@graph"])) return item["@graph"];
    return [item];
  }

  function readStructuredListing() {
    const scripts = Array.from(document.querySelectorAll("script[type='application/ld+json']"));
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items.flatMap(flattenJsonLd)) {
          if (item?.["@type"] === "Product" || item?.offers?.price) return item;
        }
      } catch (_e) { /* skip */ }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // DOM helpers — work with Grailed's ACTUAL structure (no data-testid!)
  // ---------------------------------------------------------------------------

  /** Walk the DOM collecting all text nodes under `root`. */
  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const texts = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t) texts.push({ text: t, node });
    }
    return texts;
  }

  /**
   * Find the main content / sidebar area that holds the listing details.
   * Grailed puts listing info in a section to the right of the image gallery.
   * We look for the area that contains the Offer or Make an offer button.
   */
  function findListingDetailsArea() {
    // The "Offer" or "Make an offer" button lives inside the details panel
    const offerBtn = findMakeOfferButton();
    if (offerBtn) {
      // Walk up to a reasonable container (section, aside, or a high-level div)
      let el = offerBtn.parentElement;
      let depth = 0;
      while (el && depth < 12) {
        const tag = el.tagName.toLowerCase();
        if (tag === "section" || tag === "aside") return el;
        // If this div is wide enough to be a panel, use it
        if (tag === "div" && el.children.length > 3) return el;
        el = el.parentElement;
        depth++;
      }
    }
    // Fallback: main element
    return document.querySelector("main") || document.body;
  }

  // ---------------------------------------------------------------------------
  // Brand — from designer links (href contains /designers/)
  // ---------------------------------------------------------------------------

  function scrapeBrand() {
    const designerLink = document.querySelector("a[href*='/designers/']");
    if (designerLink) return normalizeWhitespace(designerLink.textContent);

    // Meta fallback
    const og = document.querySelector("meta[property='og:title']");
    if (og) {
      const content = og.getAttribute("content") || "";
      // og:title is usually "Brand - Title" or similar
      const dash = content.indexOf(" - ");
      if (dash > 0) return normalizeWhitespace(content.substring(0, dash));
    }
    return "";
  }

  // ---------------------------------------------------------------------------
  // Title — paragraph right after the brand link's container paragraph
  // ---------------------------------------------------------------------------

  function scrapeTitle() {
    const designerLink = document.querySelector("a[href*='/designers/']");
    if (designerLink) {
      // The brand link lives inside a <p>. The next <p> sibling is the title.
      let brandParagraph = designerLink.closest("p, div, span");
      if (brandParagraph) {
        let sibling = brandParagraph.nextElementSibling;
        // Walk siblings to find a paragraph-like element with substantial text
        let attempts = 0;
        while (sibling && attempts < 5) {
          const txt = normalizeWhitespace(sibling.textContent);
          // Skip empty or very short elements, or elements that are just the brand again
          if (txt.length > 5 && !sibling.querySelector("a[href*='/designers/']")) {
            return txt;
          }
          sibling = sibling.nextElementSibling;
          attempts++;
        }
      }
    }

    // Fallback: og:title meta
    const og = document.querySelector("meta[property='og:title']");
    if (og) return normalizeWhitespace(og.getAttribute("content") || "");

    // Fallback: h1
    const h1 = document.querySelector("h1");
    if (h1) return normalizeWhitespace(h1.textContent);

    return "";
  }

  // ---------------------------------------------------------------------------
  // Size & Condition — paragraph with bullet separator (•)
  // ---------------------------------------------------------------------------

  function scrapeSizeAndCondition() {
    const area = findListingDetailsArea();
    const paragraphs = area.querySelectorAll("p, div, span");
    for (const p of paragraphs) {
      const text = normalizeWhitespace(p.textContent);
      // Look for the bullet separator pattern: "Men's US 32 / EU 48•Gently Used•Located in Europe"
      if (text.includes("•") || text.includes("·")) {
        return text;
      }
    }
    return "";
  }

  function scrapeSize() {
    const combined = scrapeSizeAndCondition();
    if (combined) {
      // Size is usually the first segment before the bullet
      const parts = combined.split(/[•·]/);
      return normalizeWhitespace(parts[0] || "");
    }
    return "";
  }

  function scrapeCondition() {
    const combined = scrapeSizeAndCondition();
    if (combined) {
      const parts = combined.split(/[•·]/);
      // Condition is typically the second segment (e.g., "Gently Used")
      if (parts.length >= 2) return normalizeWhitespace(parts[1] || "");
    }
    return "";
  }

  // ---------------------------------------------------------------------------
  // Price — raw text with $ patterns near Offer/Message buttons
  // ---------------------------------------------------------------------------

  function scrapePrice() {
    // Try meta tag first (most reliable)
    const metaPrice = document.querySelector("meta[property='product:price:amount']");
    if (metaPrice) {
      const val = parsePrice(metaPrice.getAttribute("content") || "");
      if (val) return val;
    }

    // Look for price text nodes in the listing details area
    const area = findListingDetailsArea();
    const textNodes = collectTextNodes(area);

    for (const { text } of textNodes) {
      // Match current price pattern: "$290" possibly followed by "$500 42% off"
      const priceMatch = text.match(/\$[\d,]+(?:\.\d{1,2})?/);
      if (priceMatch) {
        const val = parsePrice(priceMatch[0]);
        if (val && val > 0) return val;
      }
    }

    // JSON-LD fallback
    const structured = readStructuredListing();
    if (structured?.offers?.price) return Number(structured.offers.price);

    return null;
  }

  function scrapeOriginalPrice() {
    const area = findListingDetailsArea();
    const textNodes = collectTextNodes(area);

    for (const { text } of textNodes) {
      // Look for pattern like "$290 $500 42% off" — second price is original
      const prices = text.match(/\$[\d,]+(?:\.\d{1,2})?/g);
      if (prices && prices.length >= 2) {
        return parsePrice(prices[1]);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Favorites count — button with just a number (the favorites/heart button)
  // ---------------------------------------------------------------------------

  function scrapeFavorites() {
    const area = findListingDetailsArea();
    const buttons = area.querySelectorAll("button");
    for (const btn of buttons) {
      const text = normalizeWhitespace(btn.textContent);
      // Pure number button = favorites count
      if (/^\d+$/.test(text)) {
        return Number(text);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Description — "Seller Description" section
  // ---------------------------------------------------------------------------

  function scrapeDescription() {
    const area = findListingDetailsArea();
    const allElements = area.querySelectorAll("p, div, span, h2, h3, h4");
    let foundHeader = false;
    const descParts = [];

    for (const el of allElements) {
      const text = normalizeWhitespace(el.textContent);
      if (/^seller description$/i.test(text)) {
        foundHeader = true;
        continue;
      }
      if (foundHeader) {
        // Stop at next section header or certain keywords
        if (/^(color|measurements|size|category|shipping)/i.test(text)) break;
        // Skip if it's a child of something we already captured
        if (text.length > 2) descParts.push(text);
        // Only grab a few paragraphs
        if (descParts.length >= 5) break;
      }
    }

    if (descParts.length) return descParts.join(" ");

    // Fallback: og:description or JSON-LD
    const og = document.querySelector("meta[property='og:description']");
    if (og) return normalizeWhitespace(og.getAttribute("content") || "");

    const structured = readStructuredListing();
    if (structured?.description) return structured.description;

    return "";
  }

  // ---------------------------------------------------------------------------
  // Seller name — link to user profile (not /designers/, not /listings/)
  // ---------------------------------------------------------------------------

  function scrapeSellerName() {
    const area = findListingDetailsArea();
    const links = area.querySelectorAll("a[href]");
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      // User profile links: /<username> — not /designers/, /listings/, /categories/, etc.
      if (
        href.startsWith("/") &&
        !href.startsWith("/designers/") &&
        !href.startsWith("/listings/") &&
        !href.startsWith("/categories/") &&
        !href.startsWith("/departments/") &&
        !href.startsWith("/shop/") &&
        !href.startsWith("/about") &&
        !href.startsWith("/help") &&
        !href.startsWith("/sell") &&
        !href.startsWith("/my") &&
        !href.startsWith("/drycleanonly") &&
        !href.startsWith("/internal") &&
        !href.startsWith("/login") &&
        !href.startsWith("/signup") &&
        href.split("/").filter(Boolean).length === 1
      ) {
        const name = normalizeWhitespace(link.textContent);
        if (name && name.length > 0 && name.length < 50) return name;
      }
    }

    // Fallback: JSON-LD
    const structured = readStructuredListing();
    if (structured?.offers?.seller?.name) return structured.offers.seller.name;

    return "";
  }

  // ---------------------------------------------------------------------------
  // Seller response time — look for "responds" text near seller info
  // ---------------------------------------------------------------------------

  function scrapeSellerResponseText() {
    const area = findListingDetailsArea();
    const allElements = area.querySelectorAll("p, span, div");
    for (const el of allElements) {
      const text = normalizeWhitespace(el.textContent).toLowerCase();
      if (/respond/i.test(text) && /hour|minute|day|week/i.test(text)) {
        return normalizeWhitespace(el.textContent);
      }
    }
    return "";
  }

  // ---------------------------------------------------------------------------
  // Listed date — "Posted X ago" near "Listing ID XXXXX"
  // ---------------------------------------------------------------------------

  function scrapeListedAt() {
    const allElements = document.querySelectorAll("p, span, div, time");
    for (const el of allElements) {
      const text = normalizeWhitespace(el.textContent);
      if (/posted\s+\d+/i.test(text)) {
        return parseListingAge(text);
      }
      if (/listed\s+\d+/i.test(text)) {
        return parseListingAge(text);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Photos
  // ---------------------------------------------------------------------------

  function scrapePhotos() {
    // Grailed listing images — look for img tags with grailed CDN URLs
    const imgs = Array.from(document.querySelectorAll("img[src*='grailed'], img[src*='process.fs']"));
    const urls = imgs
      .map((img) => img.currentSrc || img.src)
      .filter((src) => src && !src.includes("avatar") && !src.includes("logo"))
      .slice(0, 8);
    return [...new Set(urls)];
  }

  // ---------------------------------------------------------------------------
  // Sold detection — check for "This listing sold" text in main content
  // ---------------------------------------------------------------------------

  function isSold() {
    // Look for "Sold Price" label — most reliable indicator
    const main = document.querySelector("main") || document.body;
    const allElements = main.querySelectorAll("p, span");
    for (const el of allElements) {
      const text = normalizeWhitespace(el.textContent).trim();
      if (/^sold price$/i.test(text)) return true;
    }

    // Check for the sold banner — but only on small/leaf elements to avoid
    // matching parent divs whose textContent includes unrelated "sold" text
    for (const el of allElements) {
      const text = normalizeWhitespace(el.textContent).trim();
      if (text.length < 80 && /this listing sold/i.test(text)) return true;
    }

    // If there's an "Offer" button (not "Make an offer"), it's active
    const buttons = main.querySelectorAll("button");
    for (const btn of buttons) {
      const btnText = normalizeWhitespace(btn.textContent).trim();
      if (/^offer$/i.test(btnText)) return false;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Counter offer detection
  // ---------------------------------------------------------------------------

  function findCounterOfferValue() {
    // Look for counter offer indicators in modals or offer thread areas
    const candidates = document.querySelectorAll("[class*='Offer'], [class*='offer'], [class*='Counter'], [class*='counter']");
    for (const el of candidates) {
      const text = normalizeWhitespace(el.textContent);
      if (/counter/i.test(text)) {
        const price = parsePrice(text);
        if (price) return price;
      }
    }

    // Also scan for text patterns like "Seller countered with $XXX"
    const allText = document.querySelectorAll("p, span, div");
    for (const el of allText) {
      const text = normalizeWhitespace(el.textContent);
      if (/counter/i.test(text) && /\$\d/.test(text)) {
        const price = parsePrice(text);
        if (price) return price;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Category — from breadcrumbs or nav links
  // ---------------------------------------------------------------------------

  function scrapeCategory() {
    // Breadcrumb links
    const navLinks = document.querySelectorAll("nav a[href*='/categories/'], nav a[href*='/departments/'], nav a[href*='/shop/']");
    if (navLinks.length) {
      return Array.from(navLinks)
        .map((a) => normalizeWhitespace(a.textContent))
        .filter(Boolean)
        .join(" / ");
    }
    return "";
  }

  // ---------------------------------------------------------------------------
  // Button finders — match Grailed's actual button text
  // ---------------------------------------------------------------------------

  /**
   * Find the Offer button.
   * Active listings: button text is exactly "Offer"
   * Sold listings: button text is "Make an offer" (to sell to buyer)
   */
  function findMakeOfferButton() {
    const buttons = Array.from(document.querySelectorAll("button"));

    // First priority: exact "Offer" button (active listings)
    const offerBtn = buttons.find((btn) => {
      const text = normalizeWhitespace(btn.textContent);
      return /^offer$/i.test(text);
    });
    if (offerBtn) return offerBtn;

    // Second: "Make an offer" button (sold listings or alternate)
    const makeOfferBtn = buttons.find((btn) => {
      const text = normalizeWhitespace(btn.textContent);
      return /make an offer/i.test(text);
    });
    if (makeOfferBtn) return makeOfferBtn;

    // Third: any button with "offer" in aria-label
    const ariaBtn = buttons.find((btn) => {
      const label = btn.getAttribute("aria-label") || "";
      return /offer/i.test(label);
    });
    if (ariaBtn) return ariaBtn;

    return null;
  }

  function findOfferInput() {
    // Numeric input for entering offer amount
    return (
      document.querySelector("input[inputmode='numeric']") ||
      document.querySelector("input[name*='offer']") ||
      document.querySelector("input[placeholder*='$']") ||
      document.querySelector("input[type='number']")
    );
  }

  function findMessageInput() {
    return (
      document.querySelector("textarea") ||
      document.querySelector("input[name*='message']")
    );
  }

  function findSubmitOfferButton() {
    const buttons = Array.from(document.querySelectorAll("button[type='submit'], button"));
    return (
      buttons.find((btn) => /^submit$/i.test(normalizeWhitespace(btn.textContent))) ||
      buttons.find((btn) => /send offer/i.test(normalizeWhitespace(btn.textContent))) ||
      buttons.find((btn) => /make offer/i.test(normalizeWhitespace(btn.textContent))) ||
      buttons.find((btn) => /^send$/i.test(normalizeWhitespace(btn.textContent))) ||
      null
    );
  }

  function findAcceptCounterButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    return (
      buttons.find((btn) => /^accept$/i.test(normalizeWhitespace(btn.textContent))) ||
      buttons.find((btn) => /buy now/i.test(normalizeWhitespace(btn.textContent))) ||
      buttons.find((btn) => /checkout/i.test(normalizeWhitespace(btn.textContent))) ||
      buttons.find((btn) => {
        const label = btn.getAttribute("aria-label") || "";
        return /accept/i.test(label);
      }) ||
      null
    );
  }

  // ---------------------------------------------------------------------------
  // Main scrape functions
  // ---------------------------------------------------------------------------

  function scrapeListingData() {
    const structured = readStructuredListing();
    const responseText = scrapeSellerResponseText();

    return {
      url: location.href,
      listingId: getListingIdFromUrl(),
      title: scrapeTitle() || structured?.name || "",
      price: scrapePrice(),
      originalPrice: scrapeOriginalPrice(),
      brand: scrapeBrand() || structured?.brand?.name || "",
      size: scrapeSize(),
      category: scrapeCategory(),
      condition: scrapeCondition(),
      description: scrapeDescription(),
      sellerName: scrapeSellerName(),
      sellerResponseText: responseText,
      sellerResponseHours: parseSellerResponseHours(responseText),
      photos: scrapePhotos(),
      listedAt: scrapeListedAt(),
      sold: isSold(),
      favorites: scrapeFavorites(),
      counterOffer: findCounterOfferValue(),
      canMakeOffer: Boolean(findMakeOfferButton() && !findMakeOfferButton().disabled)
    };
  }

  function scrapeSearchResults() {
    // Search result cards: links with href /listings/ID-slug
    const allLinks = Array.from(document.querySelectorAll("a[href*='/listings/']"));
    const unique = new Map();

    for (const anchor of allLinks) {
      const href = anchor.href || "";
      if (!href || unique.has(href)) continue;

      const listingId = getListingIdFromUrl(href);
      if (!listingId) continue;

      // Find the card container
      const cardRoot = anchor.closest("article, li, div[class]") || anchor;
      const cardText = normalizeWhitespace(cardRoot.textContent || "");

      // Extract brand from designer link within the card
      const designerLink = cardRoot.querySelector("a[href*='/designers/']");
      const brand = designerLink ? normalizeWhitespace(designerLink.textContent) : "";

      // Extract price — first $ amount in the card text
      const price = parsePrice(cardText);

      // Title from the link text or aria-label
      const title = normalizeWhitespace(
        anchor.getAttribute("aria-label") || anchor.textContent || ""
      );

      // Size — look for common size patterns
      const sizeMatch = cardText.match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|OS|\d{2,3})\b/i);
      const size = sizeMatch ? sizeMatch[0] : "";

      unique.set(href, {
        url: href,
        listingId,
        title,
        price,
        brand,
        size,
        category: ""
      });
    }

    return Array.from(unique.values()).filter((listing) => listing.listingId);
  }

  // ---------------------------------------------------------------------------
  // Offer submission flow
  // ---------------------------------------------------------------------------

  async function submitOffer({ offer, message }) {
    console.log("[GrailedScraper] submitOffer called:", { offer, message });

    const makeOfferButton = findMakeOfferButton();
    if (!makeOfferButton) {
      console.log("[GrailedScraper] Offer button not found in DOM");
      return { ok: false, error: "Offer button not found." };
    }

    console.log("[GrailedScraper] Clicking Offer button:", makeOfferButton.textContent);
    makeOfferButton.click();

    // Wait for modal to appear — try up to 3 seconds
    let offerInput = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await wait(300);
      offerInput = findOfferInput();
      if (offerInput) break;
      console.log("[GrailedScraper] Waiting for offer input modal... attempt", attempt + 1);
    }

    if (!offerInput) {
      console.log("[GrailedScraper] Offer input not found after waiting");
      return { ok: false, error: "Offer input not found after clicking Offer button. Modal may not have opened." };
    }

    console.log("[GrailedScraper] Found offer input, setting value to:", offer);
    offerInput.focus();

    // Clear existing value first
    offerInput.value = "";
    dispatchInputEvents(offerInput);
    await wait(100);

    // Type the offer amount character by character for React compatibility
    const offerStr = String(offer);
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(offerInput, offerStr);
    } else {
      offerInput.value = offerStr;
    }
    offerInput.dispatchEvent(new Event("input", { bubbles: true }));
    offerInput.dispatchEvent(new Event("change", { bubbles: true }));
    // Also fire React-compatible keydown/keyup
    offerInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    offerInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

    await wait(200);

    // Optionally fill in message textarea
    const messageInput = findMessageInput();
    if (messageInput && message) {
      console.log("[GrailedScraper] Found message textarea, setting message");
      messageInput.focus();
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;
      if (nativeTextareaSetter) {
        nativeTextareaSetter.call(messageInput, message);
      } else {
        messageInput.value = message;
      }
      messageInput.dispatchEvent(new Event("input", { bubbles: true }));
      messageInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    await wait(300);

    const submitButton = findSubmitOfferButton();
    if (!submitButton) {
      console.log("[GrailedScraper] Submit button not found in modal");
      return { ok: false, error: "Offer submit button not found in modal." };
    }
    if (submitButton.disabled) {
      console.log("[GrailedScraper] Submit button is disabled — offer amount may be invalid");
      return { ok: false, error: "Offer submit button is disabled. The offer amount may be outside allowed range." };
    }

    console.log("[GrailedScraper] Clicking submit button:", submitButton.textContent);
    submitButton.click();

    // Wait a moment and verify submission
    await wait(500);
    console.log("[GrailedScraper] Offer submitted successfully");
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

  // ---------------------------------------------------------------------------
  // Public API — same interface as before
  // ---------------------------------------------------------------------------

  globalScope.GrailedScraper = {
    // Helpers (exposed for content.js and tests)
    parsePrice,
    parseSellerResponseHours,
    getListingIdFromUrl,

    // Main scrape functions
    scrapeListingData,
    scrapeSearchResults,

    // Button finders
    findMakeOfferButton,
    findOfferInput,
    findMessageInput,
    findSubmitOfferButton,
    findAcceptCounterButton,

    // Actions
    acceptCounter,
    submitOffer
  };
})(self);
