/**
 * Grailed Auto-Negotiator — Cloudflare Worker
 * AI-powered negotiation engine using GPT-4.1 mini
 * 
 * Receives listing context + conversation history from the Chrome extension,
 * generates human-sounding negotiation messages.
 */

const SYSTEM_PROMPT = `You are a savvy buyer on Grailed (a fashion resale marketplace). You negotiate prices on clothing and accessories.

Your personality:
- You sound like a real person, not a bot. Casual, friendly, streetwear-literate.
- You use lowercase, minimal punctuation, occasional slang
- You never say "I would like to offer" or anything robotic
- You compliment the item genuinely but always push for a lower price
- You use tactics like: ready to pay now, pointing out flaws, comparing to recent sales, urgency
- You keep messages SHORT (1-3 sentences max)
- You NEVER use emojis excessively (max 1 per message, sometimes none)
- You vary your style — don't start every message the same way

Negotiation rules:
- NEVER offer above the user's max price
- NEVER reveal you're an AI or automated
- NEVER be rude or aggressive — firm but friendly
- If the seller won't budge after 3 rounds, gracefully walk away
- Use "shipped" strategically — offering "shipped" feels like you're paying more
- If listing is old (14+ days), mention you've been watching it
- If condition has flaws, gently reference them to justify lower price
- If seller responds fast, they're motivated — stay firm on your price

Output ONLY the message to send. No quotes, no explanation, no metadata.`;

function buildUserPrompt(data) {
  const { listing, conversation, strategy } = data;
  
  let prompt = `Generate a negotiation message for this Grailed listing.\n\n`;
  prompt += `LISTING:\n`;
  prompt += `- Item: ${listing.title}\n`;
  prompt += `- Asking price: $${listing.asking_price}\n`;
  prompt += `- Condition: ${listing.condition || 'Not specified'}\n`;
  prompt += `- Listed: ${listing.listed_days_ago || 'Unknown'} days ago\n`;
  prompt += `- Brand: ${listing.brand || 'Unknown'}\n`;
  prompt += `- Seller: ${listing.seller_rating || 'Unknown'} rating, ${listing.seller_transactions || 'Unknown'} transactions\n`;
  
  if (listing.description) {
    prompt += `- Description snippet: ${listing.description.slice(0, 200)}\n`;
  }

  prompt += `\nSTRATEGY:\n`;
  prompt += `- My max price: $${strategy.max_price}\n`;
  prompt += `- Aggressiveness: ${strategy.aggressiveness} (scale: chill/moderate/aggressive/savage)\n`;
  prompt += `- Negotiation round: ${strategy.round}\n`;
  prompt += `- Target offer this round: $${strategy.target_offer}\n`;

  if (conversation && conversation.length > 0) {
    prompt += `\nCONVERSATION SO FAR:\n`;
    conversation.forEach((msg, i) => {
      if (msg.role === 'buyer') {
        prompt += `  Me: offered $${msg.amount}${msg.message ? ` — "${msg.message}"` : ''}\n`;
      } else {
        prompt += `  Seller: ${msg.counter ? `countered $${msg.counter}` : ''}${msg.message ? ` — "${msg.message}"` : ''}\n`;
      }
    });
    prompt += `\nGenerate my next response. I want to offer $${strategy.target_offer}.`;
  } else {
    prompt += `\nThis is my OPENING offer. I want to offer $${strategy.target_offer}. Make it sound natural — like I just found the listing and I'm interested.`;
  }

  return prompt;
}

async function generateMessage(data, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(data) },
      ],
      max_tokens: 150,
      temperature: 0.9,  // high creativity for varied messages
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${error}`);
  }

  const result = await response.json();
  return result.choices[0].message.content.trim();
}

// Rate limiting — simple in-memory (resets on worker restart, fine for MVP)
const rateLimits = new Map();

function checkRateLimit(clientId) {
  const now = Date.now();
  const window = 60 * 1000; // 1 minute
  const maxRequests = 10;
  
  if (!rateLimits.has(clientId)) {
    rateLimits.set(clientId, []);
  }
  
  const timestamps = rateLimits.get(clientId).filter(t => now - t < window);
  
  if (timestamps.length >= maxRequests) {
    return false;
  }
  
  timestamps.push(now);
  rateLimits.set(clientId, timestamps);
  return true;
}

function validateRequest(data) {
  if (!data.listing || !data.strategy) {
    return 'Missing required fields: listing, strategy';
  }
  if (!data.listing.title || !data.listing.asking_price) {
    return 'Missing listing title or asking_price';
  }
  if (!data.strategy.max_price || !data.strategy.target_offer) {
    return 'Missing strategy max_price or target_offer';
  }
  if (data.strategy.target_offer > data.strategy.max_price) {
    return 'target_offer cannot exceed max_price';
  }
  return null;
}

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Client-Id',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      // Rate limit by client ID or IP
      const clientId = request.headers.get('X-Client-Id') || request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!checkRateLimit(clientId)) {
        return new Response(JSON.stringify({ error: 'Rate limited. Slow down.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await request.json();

      // Validate
      const validationError = validateRequest(data);
      if (validationError) {
        return new Response(JSON.stringify({ error: validationError }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check for API key
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'API key not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate negotiation message
      const message = await generateMessage(data, apiKey);

      return new Response(JSON.stringify({ 
        message,
        round: data.strategy.round,
        target_offer: data.strategy.target_offer,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
