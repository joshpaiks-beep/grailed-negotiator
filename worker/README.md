# Grailed Negotiator — Cloudflare Worker

AI-powered negotiation engine using GPT-4.1 mini.

## Setup

### 1. Install Wrangler CLI
```bash
npm install -g wrangler
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Set your OpenAI API key as a secret
```bash
cd worker/
wrangler secret put OPENAI_API_KEY
# Paste your OpenAI API key when prompted
```

### 4. Deploy
```bash
wrangler deploy
```

It'll output your worker URL like:
```
https://grailed-negotiator.YOUR_SUBDOMAIN.workers.dev
```

### 5. Update the extension
Go to extension Settings → paste the worker URL → enable AI mode.

## Cost
- Cloudflare Worker: **Free** (100K requests/day)
- GPT-4.1 mini: ~$0.001 per message (~$3/month at heavy usage)

## API

### POST /
```json
{
  "listing": {
    "title": "Rick Owens Ramones",
    "asking_price": 450,
    "condition": "Used - Excellent",
    "listed_days_ago": 23,
    "brand": "Rick Owens"
  },
  "conversation": [
    { "role": "buyer", "amount": 280 },
    { "role": "seller", "counter": 400 }
  ],
  "strategy": {
    "max_price": 320,
    "target_offer": 310,
    "aggressiveness": "savage",
    "round": 2
  }
}
```

### Response
```json
{
  "message": "appreciate the counter but 400 is steep for the heel drag showing, could you do 310 shipped? ready to pay rn",
  "round": 2,
  "target_offer": 310
}
```
