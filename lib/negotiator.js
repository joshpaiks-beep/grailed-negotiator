(function initNegotiator(globalScope) {
  const MIN_RATIO = 0.4;
  const MAX_RATIO = 0.7;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundCurrency(value) {
    return Math.max(1, Math.round(value));
  }

  function sliderToRatio(aggressiveness) {
    const normalized = clamp(Number(aggressiveness) || 0, 0, 100) / 100;
    return MAX_RATIO - (MAX_RATIO - MIN_RATIO) * normalized;
  }

  function getListingAgeDays(listing) {
    if (!listing || !listing.listedAt) {
      return 0;
    }
    const listedAt = new Date(listing.listedAt).getTime();
    if (Number.isNaN(listedAt)) {
      return 0;
    }
    const diffMs = Date.now() - listedAt;
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  function getAgeDiscount(listing) {
    const days = getListingAgeDays(listing);
    if (days >= 120) {
      return 0.09;
    }
    if (days >= 60) {
      return 0.06;
    }
    if (days >= 21) {
      return 0.035;
    }
    if (days >= 7) {
      return 0.02;
    }
    return 0;
  }

  function getResponseAdjustment(hours) {
    if (typeof hours !== "number" || Number.isNaN(hours)) {
      return 0;
    }
    if (hours <= 1) {
      return 0.04;
    }
    if (hours <= 6) {
      return 0.025;
    }
    if (hours <= 24) {
      return 0.01;
    }
    return -0.01;
  }

  function computeOpeningOffer(listing, config) {
    const asking = Number(listing.price) || 0;
    const maxPrice = Number(config.maxPrice) || asking;
    let ratio = sliderToRatio(config.aggressiveness);
    ratio -= getAgeDiscount(listing);
    ratio = clamp(ratio, MIN_RATIO, MAX_RATIO);
    const opening = roundCurrency(asking * ratio);
    return Math.min(opening, maxPrice);
  }

  function computeCounterOffer({ listing, config, negotiation, sellerCounter }) {
    const counter = Number(sellerCounter) || 0;
    const lastOffer = Number(negotiation.lastOffer) || computeOpeningOffer(listing, config);
    const maxPrice = Number(config.maxPrice) || Number(listing.price) || counter;
    let midpoint = roundCurrency((lastOffer + counter) / 2);
    midpoint += roundCurrency((Number(listing.price) || 0) * getResponseAdjustment(listing.sellerResponseHours || negotiation.sellerResponseHours || NaN));
    midpoint = Math.min(midpoint, maxPrice);
    midpoint = Math.max(midpoint, lastOffer);
    return midpoint;
  }

  function decideNextAction({ listing, config, negotiation, sellerCounter }) {
    const maxRounds = 3;
    const rounds = Number(negotiation.rounds) || 0;
    const asking = Number(listing.price) || 0;
    const maxPrice = Number(config.maxPrice) || asking;

    if (listing.sold) {
      return { action: "close", reason: "Listing sold." };
    }

    if (!negotiation.lastOffer) {
      const openingOffer = computeOpeningOffer(listing, config);
      if (openingOffer > maxPrice) {
        return { action: "walk_away", reason: "Opening offer exceeds configured max price." };
      }
      return { action: "send_offer", offer: openingOffer, rounds: 1 };
    }

    if (sellerCounter == null) {
      return { action: "wait", reason: "Waiting for seller response." };
    }

    if (rounds >= maxRounds) {
      return { action: "walk_away", reason: "Reached maximum negotiation rounds." };
    }

    if (Number(sellerCounter) <= maxPrice) {
      return { action: "accept_counter", offer: Number(sellerCounter), rounds: rounds + 1 };
    }

    const nextOffer = computeCounterOffer({ listing, config, negotiation, sellerCounter });
    if (nextOffer >= Number(sellerCounter)) {
      return { action: "walk_away", reason: "Seller counter is above our ceiling." };
    }
    if (nextOffer > maxPrice) {
      return { action: "walk_away", reason: "Counter exceeds configured max price." };
    }
    return { action: "send_offer", offer: nextOffer, rounds: rounds + 1 };
  }

  globalScope.GrailedNegotiator = {
    clamp,
    roundCurrency,
    sliderToRatio,
    getListingAgeDays,
    computeOpeningOffer,
    computeCounterOffer,
    decideNextAction
  };
})(self);
