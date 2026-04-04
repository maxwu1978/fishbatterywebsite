# Reel Mate — Fishing Battery Website

Static marketing website for the **Reel Mate** portable Li-ion battery, designed for DAIWA / SHIMANO electric reel applications.

Live site: <https://www.getreelmate.com/>

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Main landing page |
| `about.html` | Company and product positioning |
| `contact.html` | Inquiry and AI support |
| `payment.html` | Checkout and order flow |
| `wholesale.html` | Distributor and OEM/ODM inquiry |
| `shipping.html` | Shipping policy and rates |
| `warranty.html` | Warranty terms |
| `returns.html` | Return and refund policy |
| `404.html` | Error page |

## Project structure

```
├── *.html, styles.css, favicon.svg   Site pages and styles
├── reel-mate-*.svg                   Brand logos
├── chat-config.js, support-chat.js   Client-side chat integration
├── 资料/                              Product and scene images
├── product-sheet.pdf                 Downloadable spec sheet
├── robots.txt, sitemap.xml           SEO
├── server/                           AI support backend (not deployed)
│   ├── support_server.py
│   ├── knowledge-base.json
│   └── support-routing.json
└── docs/                             Planning and strategy docs (not deployed)
```

## Local preview

```bash
cd server
python3 support_server.py
```

Open <http://127.0.0.1:8012>. The server serves the site and exposes `POST /api/chat` for AI support.

### MiniMax integration

```bash
export MINIMAX_API_KEY="your_key"
export MINIMAX_BASE_URL="https://api.minimax.io/v1"
export MINIMAX_MODEL="MiniMax-M2.5"
cd server
python3 support_server.py
```

If `MINIMAX_API_KEY` is not set, AI support falls back to knowledge-base keyword matching.

## Payments

The site now includes a Vercel serverless endpoint at `api/create-checkout-session.js`
for live Stripe card checkout.

Required Vercel environment variables:

```bash
STRIPE_SECRET_KEY=sk_live_or_test_key
SITE_URL=https://www.getreelmate.com
```

After adding the variables, redeploy the site and use `payment.html` to launch
Stripe Checkout.

For Stripe webhooks, also add:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
ORDER_RECORDS_TOKEN=internal_random_token
```

Recommended Stripe webhook endpoint:

```bash
https://www.getreelmate.com/api/stripe-webhook
```

Recommended Stripe events:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.payment_failed`

The webhook currently logs paid or failed checkout details to Vercel runtime
logs so orders can be reviewed without adding a database first.

To review recent paid Stripe Checkout sessions without opening Stripe Dashboard,
use the protected internal order-records endpoint and page:

- `orders.html`
- `GET /api/orders`

Both require the internal `ORDER_RECORDS_TOKEN` value via the `x-order-token`
header or the token field on `orders.html`.

## Deployment

The site is deployed on Vercel with `www.getreelmate.com` as the primary domain.
