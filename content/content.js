(function initContentScript() {
  if (!window.GrailedScraper) {
    return;
  }

  const OVERLAY_ID = "grailed-negotiator-overlay";
  let latestPageSnapshot = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error("Content script error", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  });

  observePageChanges();
  refreshOverlay();

  async function handleMessage(message) {
    switch (message.type) {
      case "SCRAPE_PAGE":
        return {
          ok: true,
          page: scrapeCurrentPage()
        };
      case "EXECUTE_NEGOTIATION_STEP":
        return executeNegotiationStep(message.negotiation, message.config);
      default:
        return { ok: true };
    }
  }

  function scrapeCurrentPage() {
    const onListingPage = /\/listings\/\d+/.test(location.pathname);
    if (onListingPage) {
      const listing = GrailedScraper.scrapeListingData();
      latestPageSnapshot = listing;
      return { type: "listing", listing };
    }
    const results = GrailedScraper.scrapeSearchResults();
    latestPageSnapshot = { results };
    return { type: "search", results };
  }

  async function executeNegotiationStep(negotiation, config) {
    const pageData = GrailedScraper.scrapeListingData();
    latestPageSnapshot = pageData;
    if (!pageData.listingId || !pageData.price) {
      await sendExecutionResult({
        ok: false,
        listingId: pageData.listingId || negotiation.listingId,
        pageData,
        error: "Could not read the current Grailed listing details."
      });
      return { ok: false, error: "Listing data missing." };
    }

    const decision = GrailedNegotiator.decideNextAction({
      listing: pageData,
      config,
      negotiation,
      sellerCounter: pageData.counterOffer
    });

    if (decision.action === "close") {
      await sendExecutionResult({
        ok: true,
        result: "walk_away",
        listingId: pageData.listingId || negotiation.listingId,
        pageData,
        reason: decision.reason
      });
      return { ok: true };
    }

    if (decision.action === "wait") {
      await sendExecutionResult({
        ok: true,
        result: "waiting",
        listingId: pageData.listingId || negotiation.listingId,
        pageData,
        reason: decision.reason
      });
      return { ok: true };
    }

    if (decision.action === "walk_away") {
      await sendExecutionResult({
        ok: true,
        result: "walk_away",
        listingId: pageData.listingId || negotiation.listingId,
        pageData,
        reason: decision.reason
      });
      return { ok: true };
    }

    let messageResult = null;
    if (decision.action === "send_offer") {
      const messageResponse = await chrome.runtime.sendMessage({
        type: "GENERATE_NEGOTIATION_MESSAGE",
        payload: {
          listing: pageData,
          config,
          negotiation,
          sellerCounter: pageData.counterOffer,
          targetOffer: decision.offer
        }
      });
      if (!messageResponse?.ok || !messageResponse.messageResult?.message) {
        await sendExecutionResult({
          ok: false,
          listingId: pageData.listingId || negotiation.listingId,
          pageData,
          error: messageResponse?.error || "Could not generate a negotiation message."
        });
        return { ok: false, error: messageResponse?.error || "Message generation failed." };
      }
      messageResult = messageResponse.messageResult;
    }

    const submitResult = decision.action === "accept_counter"
      ? await GrailedScraper.acceptCounter()
      : await GrailedScraper.submitOffer({
          offer: decision.offer,
          message: messageResult.message
        });

    if (!submitResult.ok) {
      await sendExecutionResult({
        ok: false,
        listingId: pageData.listingId || negotiation.listingId,
        pageData,
        error: submitResult.error
      });
      return { ok: false, error: submitResult.error };
    }

    await sendExecutionResult({
      ok: true,
      result: decision.action === "accept_counter" ? "accepted_counter" : "offer_sent",
      listingId: pageData.listingId || negotiation.listingId,
      pageData,
      offer: decision.offer,
      rounds: decision.rounds,
      message: messageResult?.message || "",
      messageSource: messageResult?.source || "template"
    });

    return { ok: true };
  }

  async function sendExecutionResult(payload) {
    return chrome.runtime.sendMessage({
      type: "CONTENT_EXECUTION_RESULT",
      payload
    });
  }

  function observePageChanges() {
    const observer = new MutationObserver(() => {
      window.clearTimeout(observePageChanges.refreshTimer);
      observePageChanges.refreshTimer = window.setTimeout(() => {
        refreshOverlay();
      }, 250);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("popstate", refreshOverlay);
    window.addEventListener("load", refreshOverlay);
  }

  function refreshOverlay() {
    const overlay = ensureOverlay();
    const current = scrapeCurrentPage();
    if (current.type === "listing") {
      overlay.textContent = current.listing.sold
        ? "Grailed Negotiator: sold listing"
        : `Grailed Negotiator: ${current.listing.canMakeOffer ? "offerable" : "view-only"} listing`;
      overlay.dataset.visible = "true";
      return;
    }
    overlay.textContent = `Grailed Negotiator: ${current.results.length} listings detected`;
    overlay.dataset.visible = current.results.length ? "true" : "false";
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.className = "grailed-negotiator-overlay";
      document.documentElement.appendChild(overlay);
    }
    return overlay;
  }
})();
