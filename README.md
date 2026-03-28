# Reel Mate — Fishing Battery Website

Static marketing website for the **Reel Mate** portable Li-ion battery, designed for DAIWA / SHIMANO electric reel applications.

Live site: <https://maxwu1978.github.io/fishbatterywebsite/>

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

## Deployment

Push to `main` triggers GitHub Actions → GitHub Pages. The workflow excludes `server/`, `docs/`, and `README.md` from the deployed site.
