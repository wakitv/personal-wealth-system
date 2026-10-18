# Personal Wealth OS

A private portfolio tracker and wealth planner. It tracks banks, e-wallets, exchanges, self-custody wallets, cash, crypto, stocks, business stakes, property and other assets in **₱ PHP**, and measures progress toward your **₱5M → ₱15M → ₱100M** goals.

* **Frontend:** static HTML/CSS/JS on GitHub Pages; dark "wealth terminal" UI; desktop and mobile.
* **Backend:** Google Apps Script web app, with Google Sheets as the database.
* **Auth:** Google sign-in. The backend verifies the token and an email allowlist on **every** request.
* **Model:** an auditable, append-only ledger is the single source of truth. Balances and P&L are always derived, never typed in.

> Manual tracking only. The app never moves money, trades, or asks for exchange keys, passwords or seed phrases. Projections are hypothetical illustrations, not financial advice.

## Features

| Area | Highlights |
|---|---|
| Dashboard | Net worth, assets, liabilities, cash, investments, cost basis; unrealized and realized P&L; flows, fees and income; Today / 7D / 30D / YTD / All-time results with flows excluded; period filters including custom; 7 charts; recent activity; quick actions; data-quality warnings |
| Accounts & wallets | Exchange, wallet, bank, e-wallet, cash, brokerage, liability; any currency with recorded FX; masked references; detail page with balance history, monthly activity, holdings and transactions; archive |
| Ledger | Deposits, withdrawals, linked transfers (cross-currency), fees, income, balance reconciliation, buys/sells, add/reduce positions, asset transfers between your own wallets. Each entry can carry a reference no., receipt link and remarks. Search, filter, CSV export; reversal and correction with an audit trail; duplicate-proof submits |
| Portfolio | Remove an asset added by mistake (its transactions are reversed and audited, never deleted) or archive it to keep history. Crypto (network, location, staking income), stocks (exchange, fractional shares, dividends, FX), other assets (business %, property, metals, estimates). Weighted-average cost; price source and age always shown; optional CoinGecko prices |
| History | Reproducible daily snapshots (nightly trigger + rebuild); time-weighted or Modified Dietz returns |
| Reports | 12 reports by month or custom range, each with opening/closing figures, flows, transfers, P&L, fees, income, allocation and a method note. Export to CSV, a multi-sheet Excel workbook, or print/PDF |
| Planning | Editable, prioritised goals with progress, required monthly contribution and projected date; projection calculator (no contributions / conservative / base / optimistic, optional inflation adjustment); allocation planner with drift and concentration risk; emergency-fund tracker |
| Settings | Preferences, FX rates, prices, snapshots, integrity/reconciliation check, JSON backup & restore, audit log, connection & sign-out |

## Setup & run guide

### Part A — Run it on your computer (about 5 minutes)

**1. Install the prerequisites**

| Tool | Version | Check | Get it |
|---|---|---|---|
| Node.js | 18 or newer | `node --version` | <https://nodejs.org> (LTS) |
| Git | any | `git --version` | <https://git-scm.com> |

No `npm install` is needed: the project has no npm dependencies.

**2. Get the code**

```bash
# from the zip: unzip personal-wealth-os.zip, then
cd personal-wealth-os

# or from your GitHub repo
git clone https://github.com/<you>/personal-wealth-os.git
cd personal-wealth-os
```

**3. Run the tests**

```bash
npm test
```

You should see `✓ shared logic is in sync…` followed by `# pass 42` and `# fail 0`.

**4. Start the app**

```bash
npm run serve
```

Open <http://localhost:5173> and click **Explore in sandbox**. Sandbox mode runs the full app in your browser with no Google account needed. It starts empty, and data is saved only in that browser. Use it to try things out, not as your only copy of real data. Press `Ctrl + C` in the terminal to stop the server.

To use a different port: `PORT=8080 npm run serve` (macOS/Linux) or `set PORT=8080 && npm run serve` (Windows cmd).

**5. Try a first workflow in the sandbox**

1. **Add your first account**, e.g. a bank account with a ₱100,000 opening balance.
2. **Dashboard → Add deposit / Add withdrawal / Transfer funds.**
3. **Crypto → Add crypto asset**, then record a purchase and use **Price** to set the current price.
4. **Settings → Take today's snapshot**, then **Run integrity check**.
5. **Planning & Goals → Add ₱5M / ₱15M / ₱100M goals.**

To start over, use **Settings → Erase sandbox data**.

### Part B — Deploy it for real (about 30–45 minutes)

You need a Google account, which will own the data, and a GitHub account. The short version is below; **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** has every click, the live-test table and the launch checklist.

1. **Google sign-in client.** In [Google Cloud Console](https://console.cloud.google.com/), create a project.
   * Set up the OAuth consent screen: *External*, *Testing*, with **your email as a test user**.
   * Create an **OAuth client ID** of type *Web application*.
   * Add `https://<you>.github.io` and `http://localhost:5173` as **Authorized JavaScript origins**.
   * Copy the client ID.
2. **Apps Script backend.** Create a project at [script.google.com](https://script.google.com/).
   * Copy in every file from `backend/`, including `appsscript.json` (turn on *Show appsscript.json* in Project Settings). Or use clasp: `cd backend && clasp create --type standalone && clasp push`.
   * In **Project Settings → Script properties**, add `GOOGLE_CLIENT_ID` (from step 1) and `ALLOWED_EMAILS` (your Gmail).
3. **Create the database.** Run `setupDatabase`, which creates a private Google Sheet with all worksheets. Then run `selfTest`, which must print *All checks passed*.
4. **Deploy the web app.** Choose **Deploy → New deployment → Web app**, with **Execute as: Me** and **Who has access: Anyone**.
   * Copy the `/exec` URL.
   * Opening `<URL>?action=health` should show `"status":"ok"`.
5. **Daily snapshots.** Run `installDailySnapshotTrigger` once.
6. **Publish the frontend.** Push this repo to GitHub, then go to **Settings → Pages → Source: GitHub Actions**. The included workflow tests the code and publishes `frontend/` to `https://<you>.github.io/personal-wealth-os/`.
7. **Connect.** Open your site, enter the `/exec` URL and the client ID, then click **Test & connect** and sign in with your allow-listed Google account. Alternatively, put both values in `frontend/js/config.js` before pushing; neither is a secret.

Before trusting it with real data, go through the **launch checklist** in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-launch-checklist) and read the limitations in [docs/SECURITY.md](docs/SECURITY.md).

### Part C — Day-to-day development

| Task | Command |
|---|---|
| Run the app locally | `npm run serve` |
| Run unit + integration tests | `npm test` |
| After editing `shared/core.js` or `shared/service.js` | `npm run build` (copies them into `backend/` and `frontend/js/shared/`), then `npm test` |
| Check the copies are in sync | `npm run check` |
| Update the live backend | Paste or `clasp push` the changed `.gs` files, then **Deploy → Manage deployments → Edit → New version** (the URL stays the same) |
| Update the live frontend | `git push` to `main`; GitHub Actions tests and redeploys |

**Optional browser tests** need Python 3 and Playwright: `pip install playwright && python -m playwright install chromium`.

```bash
npm run serve                         # terminal 1
python3 tests/e2e/smoke.py            # terminal 2: full UI walk-through in sandbox mode

node tests/e2e/mock-backend.js        # terminal 3 (restart before each run)
python3 tests/e2e/remote.py           # terminal 2: sign-in + backend over HTTP
```

### Troubleshooting

| Problem | Fix |
|---|---|
| `npm test` says a file is out of date | You edited `shared/` without rebuilding: run `npm run build`. |
| Port 5173 already in use | `PORT=5180 npm run serve` |
| "Could not reach the backend" on Connect | The URL must end in `/exec`. Redeploy as *Anyone* access, and check `<URL>?action=health` in a browser. |
| Google button never appears / sign-in fails | Your site's exact origin must be in the OAuth client's *Authorized JavaScript origins*, and your email must be a test user. Ad blockers can block `accounts.google.com`. |
| "This Google account is not authorised" | Add the email to the `ALLOWED_EMAILS` script property (comma-separated). |
| `MISCONFIGURED` error | `GOOGLE_CLIENT_ID` or `ALLOWED_EMAILS` script property is missing. |
| A USDT/USD balance isn't in the totals | Record an FX rate in **Settings → FX rates**. Balances without a rate are excluded on purpose. |
| Charts show "History starts at the first daily snapshot" | Expected on day one. Install the daily trigger, or use **Settings → Take today's snapshot / Rebuild range**. |
| Backend change not live | Apps Script serves the deployed *version*: create a **New version** under Manage deployments. |
| The site shows this README instead of the app | Pages is publishing the whole repo. Set **Settings → Pages → Source: GitHub Actions** (recommended), or keep the branch setting: the top-level `index.html` redirects to `frontend/`. |

## Repository layout

```
shared/            ← the ONLY implementation of the financial logic
  core.js            ledger engine, valuation, performance, planning, CSV
  service.js         API actions, validation, auth claims, idempotency, audit
backend/           Google Apps Script project
  Code.gs            doPost/doGet entry points
  Config.gs          Script Properties
  Auth.gs            Google ID-token verification
  SheetStore.gs      Sheets storage adapter (formula-safe)
  Setup.gs           setupDatabase(), selfTest()
  Snapshots.gs       nightly snapshot trigger
  Core.gs, Service.gs  generated from shared/ by `npm run build`
  appsscript.json
frontend/          GitHub Pages site (publish this folder)
  index.html, css/, js/{app,state,config}.js, js/{pages,components,services,utils}/, js/shared/ (generated), vendor/
tests/             calculations, transactions, Apps Script integration, e2e/
scripts/           build.js (sync shared code), serve.js (local server)
docs/              ARCHITECTURE, SCHEMA, SECURITY, DEPLOYMENT, TESTING
.github/workflows/pages.yml   test + deploy frontend/ to GitHub Pages
```

Edit `shared/*.js`, then run `npm run build`. `npm test` fails if the backend or frontend copies drift from the source.

## Documentation

* [Architecture & calculation definitions](docs/ARCHITECTURE.md)
* [Google Sheets schema](docs/SCHEMA.md): every worksheet and column
* [Security model & limitations](docs/SECURITY.md): read before launch
* [Deployment, live testing & launch checklist](docs/DEPLOYMENT.md)
* [Testing](docs/TESTING.md): what is covered and what needs live infrastructure

## Licences

MIT for this project. Vendored libraries: Chart.js 4.4.4 (MIT) and SheetJS Community Edition 0.18.5 (Apache-2.0). Their licence files are in `frontend/vendor/`.
