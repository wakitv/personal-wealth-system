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
| Portfolio | Crypto (network, location, staking income), stocks (exchange, fractional shares, dividends, FX), other assets (business %, property, metals, estimates). Weighted-average cost; price source and age always shown; optional CoinGecko prices |
| History | Reproducible daily snapshots (nightly trigger + rebuild); time-weighted or Modified Dietz returns |
| Reports | 12 reports by month or custom range, each with opening/closing figures, flows, transfers, P&L, fees, income, allocation and a method note. Export to CSV, a multi-sheet Excel workbook, or print/PDF |
| Planning | Editable, prioritised goals with progress, required monthly contribution and projected date; projection calculator (no contributions / conservative / base / optimistic, optional inflation adjustment); allocation planner with drift and concentration risk; emergency-fund tracker |
| Settings | Preferences, FX rates, prices, snapshots, integrity/reconciliation check, JSON backup & restore, audit log, connection & sign-out |

## Quick start

```bash
npm test          # all tests (Node 18+, no npm dependencies)
npm run serve     # http://localhost:5173 → "Explore in sandbox"
```

Then deploy it for real by following **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

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
