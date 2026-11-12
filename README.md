# ReimburseAI — start here

ReimburseAI automates expense reimbursements. A founder uploads a receipt, a chain of AI agents reads and checks it (OCR, AI extraction,
verification, duplicates, policy, budget and bank match, risk score), low-risk claims are paid automatically through PayPal, and finance
staff only review the exceptions.

**Fastest way to see it:** watch the four videos in `demo-videos/videos/` (about 6 minutes in total).

## What's in this folder

| Folder | What it is |
| --- | --- |
| `reimburse-ai/` | The web app (Next.js). This is the project you install and run. |
| `demo-videos/videos/` | Four recorded demos (MP4, 1080p): founder, fraud checks, reviewer, admin |
| `demo-videos/record-demos.mjs` | Optional script that re-records the four videos |
| `docs/` | Agentic flow design (`.md`), flow diagram (`.png`) and interactive diagram (`.html`, open in a browser) |
| `test-receipts/` | Two real receipt photos from the internet for testing (see *Credits*) |

Not included on purpose: API keys (`.env`), `node_modules/`, build output (`.next/`) and the local database (`.data/`).
They are created on your machine by the steps below.

---

## 1. Install Node.js

Install **Node.js 22 or newer** from <https://nodejs.org> (the LTS version is fine). Check it in a terminal:

```
node -v
```

You also need internet access for `npm install` and for the first image upload (the OCR engine downloads its English model once, about 10 MB).

## 2. Install the app

Open a terminal **in this folder** and run:

```
cd reimburse-ai
npm install
```

## 3. Add your keys (optional)

The app runs **without any keys**: receipts are read with OCR and rules, and PayPal payouts are simulated.
To switch on the AI (recommended), create a `.env` file from the template:

| Windows (PowerShell) | macOS / Linux |
| --- | --- |
| `copy .env.example .env` | `cp .env.example .env` |

Open `reimburse-ai/.env` in an editor and fill **one** of these:

- **Azure OpenAI:** `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` and `AZURE_OPENAI_MODEL` (for example `gpt-4o`)
- **OpenAI:** `OPENAI_API_KEY` (model defaults to `gpt-4o-mini`)

Optional:

- `DEMO_PASSWORD=` your own password for all demo accounts. It only applies on the **first** start (see *Start over* to change it later).
- PayPal sandbox: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `AGENT_DRY_RUN=false` for real sandbox payouts.

Every setting is explained in `reimburse-ai/.env.example`. Never share or commit your `.env` file.

## 4. Start the app

Still inside `reimburse-ai`:

```
npm run dev
```

Open <http://localhost:3000>. The first visit creates the database and the demo accounts (this takes a few seconds).

## 5. Sign in

All demo accounts share **one password**:

- If you set `DEMO_PASSWORD` in `.env`, use that.
- Otherwise open the file `reimburse-ai/.data/demo-credentials.txt` (it is created when you first open the sign-in page).

| Account | Role | Organization |
| --- | --- | --- |
| `founder@acme.test` | Startup founder (submits claims) | Northstar Ventures |
| `founder@lumen.test` | Startup founder (submits claims) | Northstar Ventures |
| `reviewer@northstar.test` | Finance reviewer | Northstar Ventures |
| `admin@northstar.test` | Admin | Northstar Ventures |
| `researcher@helix.test` | Researcher (submits claims) | Helix Health Labs |
| `admin@helix.test` | Admin | Helix Health Labs |

## 6. Try it (about 5 minutes)

1. Sign in as **founder@acme.test** → *Submit a claim*. Upload receipts from `reimburse-ai/samples/` one by one and watch the agents work live:
   - `01-city-cabs-taxi.png`, `02-cloudstack-invoice.pdf`, `05-staples-order.txt` → approved and paid automatically
   - `03-le-petit-bistro.png` (over the meals limit, contains wine) and `04-grand-harbor-hotel.pdf` (large amount) → sent to a reviewer
   - `06-brightline-invoice-edited.pdf` (edited in Photoshop) and `07-city-cabs-taxi-photo.png` (duplicate) → rejected
   - `test-receipts/dinner-san-francisco-2006-lowres.jpg` → a real, blurry restaurant photo read by the AI
2. Sign out, sign in as **reviewer@northstar.test** → *Review queue*. Double-click a cell to correct a value, tick a row, add a note,
   *Approve & pay*. The hotel cannot be approved by a reviewer (above $1,000).
3. Sign in as **admin@northstar.test** → open the hotel claim and approve it. Try *Policy & payees* to change the rules.
4. Sign in as **admin@helix.test** → a separate organization with its own rules and no access to Northstar's claims.

The full demo script and the technical details are in `reimburse-ai/README.md`.

---

## Start over

Stop the app (`Ctrl+C` in the terminal), delete the folder `reimburse-ai/.data`, and run `npm run dev` again.
You get an empty database and freshly seeded demo accounts (with a new password unless `DEMO_PASSWORD` is set).

## Production mode (optional)

```
npm run build
npm start
```

In production mode the sign-in cookie is marked *secure*: open it at <http://localhost:3000> in Chrome, Edge or Firefox, or serve it over
HTTPS. Opening it over plain HTTP via a network IP address (for example `http://192.168.1.20:3000`) will not keep you signed in.

## Re-record the demo videos (optional)

Needs Microsoft Edge or Google Chrome installed. From this folder:

```
cd reimburse-ai
npm run build
cd ../demo-videos
npm install
npm run record
```

It starts a separate copy of the app on port 3100 with a fresh database (your own data is not touched), records the four videos into
`demo-videos/videos/` (replacing the old ones) and stops. It takes about 7 minutes and uses the keys in `reimburse-ai/.env`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm install` fails | Check `node -v` is 22 or newer, then delete `node_modules` and run `npm install` again |
| `npm install` prints `allow-scripts` warnings about `tesseract.js` | Safe to ignore: newer npm versions skip that package's optional post-install donation message, which the app does not need |
| Port 3000 is already in use | `npm run dev -- -p 3001`, then open <http://localhost:3001> |
| "Invalid email or password" | Use the password from `.data/demo-credentials.txt`. If you changed `DEMO_PASSWORD` after the first start, do *Start over*. |
| Claim page shows "AI calls: None (rules only)" | Check the keys in `.env` and `AGENT_LLM_ENABLED=true`, then restart `npm run dev` |
| First photo upload is slow | The OCR model is downloaded once (needs internet); later uploads are fast |
| Payouts say "simulated" | Expected without PayPal credentials, or when `AGENT_DRY_RUN=true` |

## Known limitations (MVP)

- The bank/card feed used for reconciliation is demo data created on first start; there is no import screen yet.
- Policy limits do not convert currencies (a ₹525 bill is compared with a $75 limit as if it were $525).
- The database is embedded (PGlite in `.data/`), so it is meant for one machine; use hosted Postgres for production.

## Credits

- `test-receipts/dinner-san-francisco-2006-lowres.jpg` — photo by Peter Merholz, licensed CC BY-SA 2.0, via Wikimedia Commons
  (<https://commons.wikimedia.org/wiki/File:Receipt_California_restaurant_2006.jpg>). It also appears in demo video 2. Keep this credit
  when you show or share it.
- `test-receipts/restaurant-bill-india-phone-photo.jpg` — by Sakurakat, CC0 (public domain), via Wikimedia Commons
  (<https://commons.wikimedia.org/wiki/File:Bill_Vishwanand_2026-01-28.jpg>).
- All other sample receipts in `reimburse-ai/samples/` are fictional and generated for this project.
