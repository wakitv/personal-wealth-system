# Architecture

```
 Phone / laptop browser                      Google (your account)
┌───────────────────────────────┐          ┌──────────────────────────────────────┐
│ GitHub Pages (static, public) │  HTTPS   │ Apps Script web app  (Execute as: Me) │
│  index.html + js/ (ES modules)│ ───────▶ │  Code.gs   doPost / doGet(health)     │
│  ├ shared/core.js   ◀─same─┐  │  POST    │  Auth.gs   verify Google ID token     │
│  ├ shared/service.js ◀same─┼──┼──────────┼─ Service.gs  actions, validation,     │
│  ├ pages/ components/      │  │ text/plain│            idempotency, audit        │
│  └ services/api.js auth.js │  │  JSON     │  Core.gs   ledger engine (same file) │
│                            │  │          │  SheetStore.gs ──▶ private Google Sheet│
│ Google Identity Services ──┘  │          │  Snapshots.gs  nightly trigger        │
│ (sign-in → ID token)          │          └──────────────────────────────────────┘
└───────────────────────────────┘
```

## Why this shape

| Requirement | Decision |
|---|---|
| Free hosting, reachable from anywhere | Static frontend on GitHub Pages |
| Google Sheets as the database | Apps Script web app owns the sheet; the sheet is never shared or published |
| No secrets in public code | Frontend holds only the API URL and OAuth client ID, both public by design |
| Server-side auth on every call | Google ID token verified by Google's `tokeninfo`, then audience, issuer, expiry, verified email and an allowlist are checked |
| Frontend and backend calculations must agree | `shared/core.js` and `shared/service.js` are the only implementation; `npm run build` copies them to `backend/*.gs` and `frontend/js/shared/`, and `npm test` fails if the copies drift |
| Apps Script cannot answer CORS preflights | Requests are `POST` with `Content-Type: text/plain`, which is a "simple" CORS request |

Apps Script meets the security requirements for a single-owner app. The trade-offs are covered in [SECURITY.md](SECURITY.md). If you ever need multiple users, fine-grained roles, rate limiting or sub-second latency, move the same `service.js` behind Cloud Run with Firestore or Postgres. The service layer is storage-agnostic: it only needs a `store` with `read` / `append` / `update`.

## Source of truth: the ledger

Balances, holdings, cost basis and P&L are **never stored as editable numbers**. They are always derived by replaying the `Transactions` worksheet in time order (`WealthCore.computeState`). This removes the classic "the balance cell says X but the transactions say Y" problem.

| Situation | How it is recorded |
|---|---|
| Starting balance of an account | `OPENING_BALANCE` row (an external inflow; not profit) |
| Assets you already own | `ADD_POSITION` with cost basis, plus an optional market price so the inflow is valued at market |
| Statement differs from the app ("Update balance") | `RECONCILE` row with the signed difference, classified as external flow (`FLOW`) or gain/loss (`NON_FLOW`) |
| Wrong entry | Reverse it: the row is marked `REVERSED`, a `REVERSAL` row references it, and every linked leg is reversed together |
| Correction ("Edit") | Atomic reverse + replacement; the new row's `replaces` column points at the original |
| Anything | An `AuditLog` row with before/after JSON, actor and request ID |

Rows are never deleted. Every write is validated by replaying the whole candidate ledger. A withdrawal, sale, transfer, reversal or edit is refused if any account would go below zero, or any position below zero units, at any point in history. This includes backdated entries.

## Transaction semantics

Amounts are positive and the type sets the sign. The only exception is `RECONCILE`, whose amount is signed. Native amounts are in the account currency, and `fx_rate` stores the base-currency (PHP) value of one unit at transaction time.

| Type | Cash effect (account ccy) | Position effect | Performance treatment |
|---|---|---|---|
| OPENING_BALANCE | + gross | – | external inflow |
| DEPOSIT | + gross − fee | – | external inflow (gross); fee is a cost |
| WITHDRAWAL | − gross − fee | – | external outflow (gross); fee is a cost |
| FEE | − gross | – | cost |
| INCOME | + gross − fee (cash) | in-kind: + qty at fair value | income |
| TRANSFER_OUT / TRANSFER_IN | − (gross+fee) / + received | – | **not a flow**; fee is a cost |
| BUY | − (qty·price + fee) | + qty, cost += qty·price + fee | none (cash → asset) |
| SELL | + (qty·price − fee) | − qty at average cost | realised P&L = proceeds − fee − avg cost |
| ADD_POSITION | – | + qty, cost += cost basis | external inflow at market value (or cost if no price) |
| REDUCE_POSITION | – | − qty at average cost | `WITHDRAWN`: external outflow · `LOSS`: realised loss |
| ASSET_TRANSFER_OUT / IN | – | moves qty and its cost basis; network fee reduces units received | **not a sale, not a flow** |
| RECONCILE | ± gross | – | `FLOW`: external flow · `NON_FLOW`: gain/loss |

**Cost basis** uses weighted-average cost, tracked per (account, asset). Buy fees are capitalised. A partial sale removes `qty / held` of the cost. A transfer between your own accounts carries the proportional cost with the units.

## Definitions (dashboard & reports)

* **Cash & equivalents**: positive cash balances of all accounts, converted at the latest recorded FX rate.
* **Investment value**: market value of all positions (crypto + stocks + other assets).
* **Total assets**: cash + investment value. A wallet's cash and the coins held in it are counted once each, never twice.
* **Liabilities**: negative balances, which only `LIABILITY` accounts may hold.
* **Net worth**: total assets − liabilities. The integrity check verifies that it equals the sum of account totals, and that it equals cash + investments − liabilities.
* **Unrealized P&L**: market value − remaining cost basis.
* **Realized P&L**: sale proceeds − sale fees − average cost of the units sold. `LOSS` reductions also count here.
* **Net external flows**: opening balances + deposits + positions added − withdrawals − positions removed ± `FLOW` adjustments. Internal transfers are excluded.
* **Investment result for a period**: closing net worth − opening net worth − net external flows. **Deposits are never profit.**

## Performance method

* **Time-weighted return (default).** Valuations come from the period start, every daily snapshot inside the period, and the period end (live). Sub-period returns are chain-linked:
  `rᵢ = (Vᵢ − Fᵢ) / Vᵢ₋₁ − 1`, where `Fᵢ` is the net external flow in the sub-period, assumed to occur at the end of the day.
* **Modified Dietz (optional).** `gain / (V₀ + Σ wₖFₖ)`, where `wₖ` is the fraction of the period remaining after each flow.
* Start and end values are recomputed from the ledger and the prices recorded up to those instants, so they are reproducible.
* With few snapshots, TWR degrades to a single-period estimate, and the UI says so. A sub-period that starts with zero capital contributes no return.

## Valuation rules (no invented numbers)

1. **Price** is the latest recorded `PriceHistory` row at or before the valuation time, or the last trade price, whichever is later. On a timestamp tie, the recorded price wins. The source and age of the price are always displayed.
2. **No price at all:** the position is valued **at cost**, flagged "No price — valued at cost", and counted in data quality.
3. **FX** is the latest recorded `FXRates` row, or the rate stored on a transaction, at or before the valuation time. If there is **no FX rate**, the balance is **excluded** from totals and flagged. It is never added unconverted.
4. **Stale prices**, older than *Stale price after (days)*, are flagged. Manual valuations of other assets are labelled as estimates.

## Snapshots

`DailySnapshots` holds one row per day: net worth, assets, liabilities, cash, crypto, stock and other values, cost basis, unrealized P&L, cumulative realised P&L, income, fees, the day's net flow, cumulative flows, the FX rates used, data-quality counts, and the oldest price timestamp.

* A snapshot for day *D* is `buildSnapshot(ledger, prices, fx, endOfDay(D))`. Rebuilding it gives the same numbers.
* The nightly trigger (`dailySnapshotJob`, about 23:50 Asia/Manila) first fills any gap since the last snapshot, then writes today's.
* Charts start at the first stored snapshot. History before that is not invented.

## Concurrency, idempotency, replay

* Every write runs under `LockService.getScriptLock()`. Concurrent submissions are therefore serialised, and validation always sees the latest ledger.
* Every write must carry a `requestId`, which the browser creates when a form opens. The server stores the result in the `Requests` worksheet. A repeated `requestId` returns the stored result (`replayed: true`) without writing again.
* Updates to accounts, assets, goals and transactions accept `expected_updated_at`. A stale edit is rejected with `CONFLICT`.

## Frontend structure

```
frontend/
  index.html            CSP, icon sprite, script order (core → service → chart → app)
  css/styles.css        dark terminal theme (+ light), responsive, print styles
  js/app.js             boot, connect / sign-in screens, shell, hash router
  js/state.js           store: bootstrap data + derived state via WealthCore
  js/config.js          public config (API URL, OAuth client ID)
  js/services/          api.js (remote + sandbox transports), auth.js (GIS), analytics.js
  js/components/        ui.js (modal, table, toast, charts), forms.js (all entry forms)
  js/pages/             dashboard, accounts, transactions, portfolio (crypto/stocks/other/asset), reports, planning, settings
  js/shared/            generated copies of shared/core.js and shared/service.js
  vendor/               Chart.js 4.4.4 (MIT), SheetJS CE 0.18.5 (Apache-2.0)
```

**Sandbox mode** runs the real `service.js` in the browser against an in-memory store saved to `localStorage`. You can try every feature without Google, and the E2E tests use it. It is labelled everywhere it appears, starts empty, and is not intended for your only copy of real data.
