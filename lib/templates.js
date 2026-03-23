(function initTemplates(globalScope) {
  const MESSAGE_TEMPLATES = [
    "hey love this piece, would you take ${{price}}?",
    "been looking for one of these, could you do ${{price}} shipped?",
    "great condition, id do ${{price}} right now if youre down",
    "ready to buy today if ${{price}} works for you",
    "super into this, can we meet at ${{price}}?",
    "would be an instant cop for me at ${{price}}",
    "im ready to check out if you can do ${{price}}",
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

  function renderTemplate(price) {
    return randomItem(MESSAGE_TEMPLATES).replaceAll("{{price}}", String(price));
  }

  globalScope.GrailedTemplates = {
    MESSAGE_TEMPLATES,
    renderTemplate
  };
})(self);
