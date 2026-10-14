# Testing

```bash
npm test                                  # sync check + 42 Node tests (no dependencies)
npm run serve &                           # http://localhost:5173
python3 tests/e2e/smoke.py                # browser E2E, sandbox mode
node tests/e2e/mock-backend.js &          # :5174 (start fresh before each run)
python3 tests/e2e/remote.py               # browser E2E, remote mode + sign-in
```
The E2E scripts need `pip install playwright && python -m playwright install chromium`.

## What is covered

### `tests/calculations.test.js` — financial engine
| Case | Verifies |
|---|---|
| **A** Deposit | ₱100,000 + ₱10,000 deposit → ₱110,000; gain = 0, realized = unrealized = 0 |
| **B** Withdrawal | ₱110,000 − ₱5,000 → ₱105,000; a fee is recorded separately and is not a withdrawal |
| **C** Internal transfer | Combined balance unchanged, net flows unchanged, two linked legs; with a fee, the combined balance drops by exactly the fee |
| **D** Unrealized | 1 BTC bought at ₱3.0M, priced at ₱3.3M → value ₱3.3M, unrealized ₱300k; cash spent not double-counted |
| **E** Partial sale | 10 @ ₱100, sell 4 @ ₱120 → 6 left, cost ₱600, realized gross ₱80 |
| E2 Fees | Capitalised on buy, deducted on sell; gain identity holds |
| **F** Deposits ≠ performance | ₱200k + ₱50k deposit, no market move → gain 0 and return 0% (TWR and Modified Dietz), plus an end-to-end version through snapshots |
| **J** FX | USDT balance valued at the recorded rate; newer rate revalues; historical as-of uses the older rate; foreign entry without an FX rate refused; missing FX excludes the balance |
| Missing / stale prices | Flagged; valued at cost when unpriced; never invented |
| Liabilities | Net worth = assets − liabilities |
| Reconciliation adjustments | Statement-balance entry creates the signed delta; FLOW vs NON_FLOW classification |
| Crypto self-transfer | Not a sale; cost moves with the coins; network fee reduces units |
| Staking income | In-kind units at fair value, counted as income |
| Price precedence | A recorded price beats a trade price at the same timestamp |
| Rounding, dates, planning math, allocation, concentration, CSV formula-injection, masking | — |

### `tests/transactions.test.js` — service / API layer
| Case | Verifies |
|---|---|
| **G** Duplicate submission | Same `requestId` twice → one row, `replayed: true`; reuse for another action refused; writes without a `requestId` refused |
| **H** Reconciliation | Multi-currency scenario (PHP→USDT transfer, BTC buy, move to cold wallet, business stake with valuation): integrity check passes, Σ accounts = net worth = cash + investments − liabilities, transfers not counted as deposits |
| **I** Authentication | Missing, forged, wrong-audience, expired and non-allow-listed tokens are rejected on every protected action, including export, restore and settings; health exposes no records; `__proto__` / `constructor` actions rejected; nothing written |
| Claims | Audience, issuer, expiry, verified email, allowlist, missing config |
| Invalid amounts | 0, negative, non-numeric, empty, huge, bad dates, future dates, unknown types/accounts, wrong currency |
| Insufficient funds / quantity | Including **backdated** withdrawals that would overdraw history |
| Reversals | Audited; idempotent refusal; reversal of a reversal refused; reversing a spent deposit refused; transfer legs reversed together; no rows deleted |
| Edits | Reverse + replacement; realized P&L recalculated; stale version → `CONFLICT`; an edit that breaks a later sale refused |
| Funded buy | Linked deposit + buy |
| Simultaneous requests | Serialised under the lock: the second of two racing overdrafts fails; lock unavailable → `BUSY`, nothing written |
| Optimistic concurrency, archive, secret-looking notes | — |
| Snapshots | Rebuild from ledger; reproducible; no duplicates; future date refused |
| Settings, goals, backup → restore, price refresh | — |

### `tests/appsscript.test.js` — the real `backend/*.gs` files
Loaded into a Node VM, in reverse order to prove that file load order does not matter, against an emulation of SpreadsheetApp, Lock, Cache, UrlFetch, Properties, Drive, Script, Utilities and Content services. Verifies:
* `setupDatabase` (idempotent) and `selfTest`
* the GET health check
* `doPost` auth failures and malformed JSON
* that user text such as `=HYPERLINK(…)` or `+63…` is **never evaluated as a formula** and round-trips exactly
* idempotent replay, token cache by hash, and the foreign-audience pre-filter (no network call)
* lock/unlock pairing, idempotent trigger install, the nightly job writing snapshots, and audit actor
* fail-closed when misconfigured

### `tests/e2e/smoke.py` — real browser, sandbox mode
Walks the whole UI and fails on any JS error or wrong figure:
* accounts, deposit (A), withdrawal (B) with the insufficient-funds guard, transfer (C)
* a USDT account at FX 58 (J), a BTC buy marked to ₱3.3M (D), a stock partial sale (E)
* snapshot, integrity check, reversal, starter goals
* every page on desktop, every report type, and 9 pages on a 390 px phone with **no horizontal overflow**, plus the mobile nav drawer

### `tests/e2e/remote.py` — real browser, remote mode
The real frontend talking to the real service over HTTP, with Google sign-in replaced by a test double. Verifies:
* connect-screen validation and health check
* sign-in, then authenticated read and write
* an expired session returns to sign-in without showing data
* a non-allow-listed Google account is refused

## What could not be run here

These need live Google or GitHub infrastructure. Run them with the checklist in [DEPLOYMENT.md §4](DEPLOYMENT.md#4-test-the-live-deployment):
* the real Apps Script runtime, including `LockService` under true parallel load and real Sheets formula/apostrophe behaviour. `selfTest()` checks the apostrophe round trip on your actual sheet.
* real Google Identity Services sign-in and Google's `tokeninfo` verification
* the GitHub Pages deployment and its HTTPS origin
* live CoinGecko responses
