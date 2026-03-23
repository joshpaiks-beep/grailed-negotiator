/**
 * Grailed Auto-Negotiator — Cloudflare Worker
 * AI-powered negotiation engine using GPT-4.1 mini
 */

const MODEL = "gpt-4.1-mini";
const MAX_DESCRIPTION_LENGTH = 400;
const MAX_CONVERSATION_ITEMS = 8;
const MAX_MESSAGE_LENGTH = 280;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Client-Id",
};

const SYSTEM_PROMPT = `You are a savvy buyer on Grailed (a fashion resale marketplace). You negotiate prices on clothing and accessories.

Your personality:
- You sound like a real person, not a bot. Casual, friendly, streetwear-literate.
- You use lowercase, minimal punctuation, occasional slang.
- You never say "I would like to offer" or anything robotic.
- You compliment the item genuinely but always push for a lower price.
- You use tactics like: ready to pay now, pointing out flaws, comparing to recent sales, urgency.
- You keep messages short: 1-3 sentences max.
- You never use more than one emoji.
- You vary your style.

Negotiation rules:
- Never offer above the user's max price.
- Never reveal you're an AI or automated.
- Never be rude or aggressive.
- If the seller won't budge after 3 rounds, gracefully walk away.
- Use "shipped" strategically.
- If listing is old (14+ days), mention you've been watching it.
- If condition has flaws, gently reference them to justify a lower price.
- If seller responds fast, stay firm.

Output only the message to send. No quotes, explanation, JSON, or metadata.`;

const rateLimits = new Map();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function normalizeString(value, maxLength = 120) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePayload(data) {
  const listing = data?.listing || {};
  const strategy = data?.strategy || {};
  const conversation = Array.isArray(data?.conversation) ? data.conversation : [];

  return {
    listing: {
      title: normalizeString(listing.title, 140),
      asking_price: normalizeNumber(listing.asking_price),
      condition: normalizeString(listing.condition, 80) || null,
      listed_days_ago: normalizeNumber(listing.listed_days_ago),
      brand: normalizeString(listing.brand, 80) || null,
      seller_rating: normalizeNumber(listing.seller_rating),
      seller_transactions: normalizeNumber(listing.seller_transactions),
      description: normalizeString(listing.description, MAX_DESCRIPTION_LENGTH) || null,
    },
    strategy: {
      max_price: normalizeNumber(strategy.max_price),
      target_offer: normalizeNumber(strategy.target_offer),
      aggressiveness: normalizeString(strategy.aggressiveness, 20) || "moderate",
      round: normalizeNumber(strategy.round) || 1,
    },
    conversation: conversation
      .slice(-MAX_CONVERSATION_ITEMS)
      .map((entry) => ({
        role: entry?.role === "seller" ? "seller" : "buyer",
        amount: normalizeNumber(entry?.amount),
        counter: normalizeNumber(entry?.counter),
        message: normalizeString(entry?.message, 180) || null
      }))
  };
}

function validateRequest(data) {
  if (!data.listing.title) {
    return "Missing listing.title";
  }
  if (!data.listing.asking_price || data.listing.asking_price <= 0) {
    return "Missing or invalid listing.asking_price";
  }
  if (!data.strategy.max_price || data.strategy.max_price <= 0) {
    return "Missing or invalid strategy.max_price";
  }
  if (!data.strategy.target_offer || data.strategy.target_offer <= 0) {
    return "Missing or invalid strategy.target_offer";
  }
  if (data.strategy.target_offer > data.strategy.max_price) {
    return "strategy.target_offer cannot exceed strategy.max_price";
  }
  if (data.strategy.round < 1 || data.strategy.round > 10) {
    return "strategy.round must be between 1 and 10";
  }
  return null;
}

function buildUserPrompt(data) {
  const { listing, conversation, strategy } = data;

  let prompt = "Generate a negotiation message for this Grailed listing.\n\n";
  prompt += "LISTING:\n";
  prompt += `- Item: ${listing.title}\n`;
  prompt += `- Asking price: $${listing.asking_price}\n`;
  prompt += `- Condition: ${listing.condition || "Not specified"}\n`;
  prompt += `- Listed: ${listing.listed_days_ago ?? "Unknown"} days ago\n`;
  prompt += `- Brand: ${listing.brand || "Unknown"}\n`;
  prompt += `- Seller: ${listing.seller_rating ?? "Unknown"} rating, ${listing.seller_transactions ?? "Unknown"} transactions\n`;

  if (listing.description) {
    prompt += `- Description snippet: ${listing.description}\n`;
  }

  prompt += "\nSTRATEGY:\n";
  prompt += `- My max price: $${strategy.max_price}\n`;
  prompt += `- Aggressiveness: ${strategy.aggressiveness}\n`;
  prompt += `- Negotiation round: ${strategy.round}\n`;
  prompt += `- Target offer this round: $${strategy.target_offer}\n`;

  if (conversation.length) {
    prompt += "\nCONVERSATION SO FAR:\n";
    conversation.forEach((msg) => {
      if (msg.role === "buyer") {
        prompt += `- Me: offered $${msg.amount || strategy.target_offer}${msg.message ? ` — ${msg.message}` : ""}\n`;
      } else {
        prompt += `- Seller: ${msg.counter ? `countered $${msg.counter}` : "responded"}${msg.message ? ` — ${msg.message}` : ""}\n`;
      }
    });
    prompt += `\nGenerate my next response. I want to offer $${strategy.target_offer}.`;
  } else {
    prompt += `\nThis is my opening offer. I want to offer $${strategy.target_offer}.`;
  }

  return prompt;
}

function checkRateLimit(clientId) {
  const now = Date.now();
  const timestamps = (rateLimits.get(clientId) || []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimits.set(clientId, timestamps);
    return false;
  }
  timestamps.push(now);
  rateLimits.set(clientId, timestamps);
  return true;
}

async function generateMessage(data, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(data) },
      ],
      max_tokens: 120,
      temperature: 0.9,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  const message = normalizeString(content, MAX_MESSAGE_LENGTH);
  if (!message) {
    throw new Error("OpenAI API returned an empty message.");
  }
  return message;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const clientId = request.headers.get("X-Client-Id") || request.headers.get("CF-Connecting-IP") || "unknown";
    if (!checkRateLimit(clientId)) {
      return jsonResponse({ error: "Rate limited. Slow down." }, 429);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: "OPENAI_API_KEY is not configured." }, 500);
    }

    let requestData;
    try {
      requestData = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const data = normalizePayload(requestData);
    const validationError = validateRequest(data);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }

    try {
      const message = await generateMessage(data, env.OPENAI_API_KEY);
      return jsonResponse({
        message,
        round: data.strategy.round,
        target_offer: data.strategy.target_offer,
      });
    } catch (error) {
      console.error("Worker request failed", error);
      return jsonResponse({
        error: error?.message || "Failed to generate negotiation message."
      }, 500);
    }
  },
};
