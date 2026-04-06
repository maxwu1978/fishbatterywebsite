# Reel Mate — Fishing Battery Website

Static marketing website for the **Reel Mate** portable Li-ion battery, designed for DAIWA / SHIMANO electric reel applications.

Live site: <https://www.getreelmate.com/>

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Main landing page |
| `about.html` | Company and product positioning |
| `contact.html` | Inquiry page with support positioning and legacy support-console UI |
| `payment.html` | Stripe checkout entry and order flow |
| `wholesale.html` | Distributor and OEM/ODM inquiry |
| `shipping.html` | Shipping policy and rates |
| `warranty.html` | Warranty terms |
| `returns.html` | Return and refund policy |
| `ja*.html` | Japanese customer-facing pages |
| `404.html` | Error page |

## Localization workflow

Use the fixed bilingual sync process in
[`docs/多语言同步固定流程.md`](docs/多语言同步固定流程.md).

Current default rule:

- conversion-impacting English changes must be reviewed for Japanese sync
- homepage pricing, offer, FAQ, trust, and order-flow updates should normally
  be synchronized between `index.html` and `ja.html`

## Project structure

```
├── *.html, styles.css, favicon.svg   Site pages and styles
├── reel-mate-*.svg                   Brand logos
├── chat-config.js, support-chat.js   Client-side Crisp chat loader (disabled unless configured)
├── 资料/                              Product and scene images
├── product-sheet.pdf                 Downloadable spec sheet
├── robots.txt, sitemap.xml           SEO
├── server/                           Local AI support backend (not deployed to Vercel)
│   ├── support_server.py
│   ├── knowledge-base.json
│   └── support-routing.json
├── api/                              Vercel serverless endpoints
└── docs/                             Planning and strategy docs (not deployed)
```

## Local preview

```bash
cd server
python3 support_server.py
```

Open <http://127.0.0.1:8012>. The local Python server serves the site and exposes
`POST /api/chat` for local AI support testing only.

### MiniMax integration

```bash
export MINIMAX_API_KEY="your_key"
export MINIMAX_BASE_URL="https://api.minimax.io/v1"
export MINIMAX_MODEL="MiniMax-M2.5"
cd server
python3 support_server.py
```

If `MINIMAX_API_KEY` is not set, AI support falls back to knowledge-base keyword
matching. This local AI support stack is not the same as the current production
Vercel deployment.

## Customer support status

Current production status should be understood like this:

- `POST /api/inquiry` is live and can receive support and wholesale forms
- `chat-config.js` is present, but `crispWebsiteId` is empty by default
- without a Crisp Website ID, `support-chat.js` does not load live chat
- the local Python support stack in `server/` is for local testing and is not
  deployed as a production `/api/chat` route on Vercel

In other words:

- production support currently means `form-based inquiry`
- production support does not currently mean `live chat` or `AI chat`

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

## Inquiry notifications

The site also includes a Vercel form endpoint at `api/inquiry.js` for the
support form on the homepage and the wholesale request form.

Optional environment variable:

```bash
INQUIRY_WEBHOOK_URL=https://hooks.example.com/your-channel
```

If `INQUIRY_WEBHOOK_URL` is set, each new inquiry is forwarded as JSON to that
webhook. If it is not set, the inquiry still succeeds and is written to Vercel
runtime logs with the `site_inquiry_received` event name.

This is an important planning boundary:

- if `INQUIRY_WEBHOOK_URL` is missing, inquiries still work
- but they are not proactively pushed to Slack or another team inbox
- do not assume inquiry notifications are live unless the webhook is configured
  and tested

## Inquiry confirmation emails

The inquiry endpoint can also send an automatic confirmation email back to the
customer after a support form is submitted.

Optional environment variables:

```bash
RESEND_API_KEY=re_...
SUPPORT_CONFIRM_FROM_EMAIL="Reel Mate <hello@yourdomain.com>"
SUPPORT_REPLY_TO_EMAIL=support@yourdomain.com
```

Behavior:

- if `RESEND_API_KEY` and `SUPPORT_CONFIRM_FROM_EMAIL` are configured, the site
  sends an English or Japanese confirmation email based on the source form
- if they are not configured, the inquiry still succeeds and Slack notification
  behavior is unchanged
- do not assume customer confirmation emails are live unless the Resend
  variables are configured and tested

## Deployment

The site is deployed on Vercel with `www.getreelmate.com` as the primary domain.
