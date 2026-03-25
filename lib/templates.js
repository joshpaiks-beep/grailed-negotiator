(function initTemplates(globalScope) {
  // ---------------------------------------------------------------------------
  // Message-first DM templates — casual, human, varied
  // These are for Grailed users (fashion kids). Keep it real.
  // ---------------------------------------------------------------------------

  const OPENING_TEMPLATES = [
    // Conservative (low aggression)
    "hi! would you consider ${{price}} for this? i'm really interested",
    "hey, love this piece — any chance you'd take ${{price}}?",
    "been looking for one of these for a minute, would ${{price}} work?",
    "hey! super into this, would you be open to ${{price}}?",
    "hi, great listing — would ${{price}} be doable for you?",
    // Balanced
    "hey would you take ${{price}} for these?",
    "any flexibility on price? i could do ${{price}}",
    "would ${{price}} work? ready to buy today",
    "could you do ${{price}} on this? been eyeing it",
    "hey, any chance you'd do ${{price}}? i can move quick",
    // Aggressive
    "would you take ${{price}}?",
    "${{price}} work?",
    "can you do ${{price}}?",
    "lmk if ${{price}} works",
    "hey ${{price}}?"
  ];

  const FOLLOWUP_TEMPLATES = [
    "hey just following up — still interested at ${{price}} if you're down",
    "hey! did you see my message? i'd still do ${{price}}",
    "just bumping this — ${{price}} still works for me if you're interested",
    "hey no rush, just wanted to check if ${{price}} would work for you",
    "still interested in this if ${{price}} works on your end!"
  ];

  const COUNTER_TEMPLATES = [
    "appreciate the response! i could meet you at ${{price}} — would that work?",
    "hmm that's a bit high for me, could we do ${{price}}?",
    "thanks for getting back — best i could do is ${{price}}, hope that works",
    "i hear you, what about ${{price}}? trying to make it work",
    "gotcha — ${{price}} is about my max, lmk if that's cool"
  ];

  const ACCEPTANCE_TEMPLATES = [
    "appreciate it! yeah ${{price}} works, i'll send the offer now",
    "sounds good! sending the offer at ${{price}} 🤝",
    "deal! i'll throw in the offer at ${{price}} right now",
    "perfect, ${{price}} works for me — sending offer",
    "bet, ${{price}} it is. offer incoming"
  ];

  // Legacy offer-flow templates (kept for direct-offer mode)
  const OFFER_MESSAGE_TEMPLATES = [
    "hey love this piece, would you take ${{price}}?",
    "been looking for one of these, could you do ${{price}} shipped?",
    "great condition, id do ${{price}} right now if youre down",
    "ready to buy today if ${{price}} works for you",
    "super into this, can we meet at ${{price}}?",
    "would be an instant cop for me at ${{price}}",
    "clean listing, would you consider ${{price}}?",
    "this is exactly what ive been hunting for, any shot at ${{price}}?",
    "serious buyer here, i can do ${{price}} today",
    "love the fit on this one, would ${{price}} work?",
    "if you can do ${{price}}, ill grab it now",
    "keen on this piece, could you work with ${{price}}?",
    "i can move quickly if ${{price}} sounds good",
    "would you be open to ${{price}} for a fast sale?",
    "happy to buy immediately at ${{price}} if that helps",
    "been watching this for a minute, would ${{price}} get it done?",
    "i can make ${{price}} happen today",
    "solid piece, could you meet me at ${{price}}?",
    "would love to close this out at ${{price}}"
  ];

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  /**
   * Get an opening DM message based on aggressiveness level (0-100).
   * Low aggression = conservative/polite, high = terse/direct.
   */
  function renderOpeningMessage(price, aggressiveness) {
    const agg = Number(aggressiveness) || 50;
    let pool;
    if (agg <= 30) {
      // Conservative: pick from first 5
      pool = OPENING_TEMPLATES.slice(0, 5);
    } else if (agg <= 65) {
      // Balanced: pick from middle 5
      pool = OPENING_TEMPLATES.slice(5, 10);
    } else {
      // Aggressive: pick from last 5
      pool = OPENING_TEMPLATES.slice(10, 15);
    }
    return randomItem(pool).replaceAll("{{price}}", String(price));
  }

  function renderFollowupMessage(price) {
    return randomItem(FOLLOWUP_TEMPLATES).replaceAll("{{price}}", String(price));
  }

  function renderCounterMessage(price) {
    return randomItem(COUNTER_TEMPLATES).replaceAll("{{price}}", String(price));
  }

  function renderAcceptanceMessage(price) {
    return randomItem(ACCEPTANCE_TEMPLATES).replaceAll("{{price}}", String(price));
  }

  /** Legacy: render offer-flow message */
  function renderTemplate(price) {
    return randomItem(OFFER_MESSAGE_TEMPLATES).replaceAll("{{price}}", String(price));
  }

  globalScope.GrailedTemplates = {
    OPENING_TEMPLATES,
    FOLLOWUP_TEMPLATES,
    COUNTER_TEMPLATES,
    ACCEPTANCE_TEMPLATES,
    OFFER_MESSAGE_TEMPLATES,
    renderOpeningMessage,
    renderFollowupMessage,
    renderCounterMessage,
    renderAcceptanceMessage,
    renderTemplate
  };
})(self);
