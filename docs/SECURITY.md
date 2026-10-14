# Security model

A login screen is not security. In this app, **the backend decides** on every request. The frontend is public code and holds no secrets.

## What protects your data

| Layer | Control |
|---|---|
| Storage | A Google Sheet in your own Drive, shared with **no one** (`selfTest()` fails if sharing is not *Restricted*). Only the Apps Script project, running as you, reads or writes it. |
| Transport | HTTPS only (GitHub Pages and `script.google.com`). |
| Authentication | Google Identity Services issues a signed ID token. On each call the backend verifies it with Google (`oauth2.googleapis.com/tokeninfo`) and then requires all of the following: `aud` equals your `GOOGLE_CLIENT_ID`, `iss` is `accounts.google.com`, the token is unexpired, the email is verified, and the email is in `ALLOWED_EMAILS`. |
| Authorization | Single owner: every action except `health` requires an allow-listed identity. There is no anonymous read path, GET serves only the health check, and `health` returns no records. |
| Misconfiguration | If `GOOGLE_CLIENT_ID` or `ALLOWED_EMAILS` is missing, all requests fail with `MISCONFIGURED`. The backend fails closed. |
| Input validation | Server-side type, range, enum and format checks on every field. Settings are whitelisted. Future-dated entries are refused. Notes that look like passwords or seed phrases are refused. Sheet values are never interpreted as formulas. |
| Integrity | Ledger replay validation (no negative balances or quantities, ever). Reversals instead of deletes. Full audit log. Script lock on writes. Optimistic concurrency on edits. |
| Duplicates / replays of a write | A mandatory `requestId` makes each submission idempotent. |
| Browser | Content-Security-Policy: scripts only from this site and Google sign-in. All user text is HTML-escaped before rendering. Framing is refused. `Referrer-Policy: no-referrer`. Account references are masked by default. A "hide amounts" privacy toggle is available. |
| Exports | CSV/XLSX cells starting with `= + - @` are neutralised (formula injection). |
| Secrets | None in the repo. Script Properties hold configuration. The OAuth client ID and Web App URL are public identifiers, not secrets. |

## What the app never asks for or stores

Bank passwords, PINs, OTPs, exchange logins, exchange API keys (especially withdrawal-enabled keys), wallet seed phrases and private keys. Exchange balances are entered manually or priced from public market data.

## Required access settings

| Setting | Value |
|---|---|
| Spreadsheet sharing | **Restricted**: only you |
| Apps Script project sharing | Only you. Anyone with edit access to the script can read the data it can reach |
| Web app → Execute as | **Me** |
| Web app → Who has access | **Anyone**. This is required so the browser can call it without a Google cookie; the token check is what enforces access |
| OAuth consent screen | External, **Testing** status, with your Google account as a test user. Only test users can complete sign-in, which is an extra gate. Requested scopes are only `openid email profile` |
| OAuth client → Authorized JavaScript origins | `https://<you>.github.io` (and `http://localhost:5173` for local testing). No redirect URIs |
| Script Properties | `GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS` (your email), `SPREADSHEET_ID` (set by `setupDatabase`) |
| Your Google account | **2-Step Verification on**. It is the real perimeter of this system |

## Remaining limitations (read before launch)

1. **The endpoint is publicly reachable.** Anyone can send requests to the `/exec` URL. Without a valid token for your email they get `UNAUTHENTICATED` / `FORBIDDEN`. Apps Script has no rate limiting beyond Google's quotas, so a flood of junk requests could consume your daily quotas: UrlFetch is about 20k calls/day on consumer accounts. Tokens with a foreign audience are rejected before any network call, and valid tokens are cached by hash.
2. **Bearer tokens can be replayed until they expire.** A stolen ID token, for example via malware on your device or an XSS bug, works for up to about an hour. It is bound to your client ID, so other apps cannot use it. The `requestId` mechanism prevents duplicate *writes*, not reuse of a stolen token.
3. **Token in `sessionStorage`.** It is cleared when the tab closes. Any successful script injection could read it. CSP and escaping reduce, but cannot eliminate, that risk.
4. **Google-account compromise is total compromise.** Whoever controls your Google account controls the sheet. Use 2FA and review third-party access regularly.
5. **Data is not encrypted beyond Google's at-rest encryption.** Account references are masked only in the UI; they are stored as entered. Store only last digits or nicknames.
6. **CSP is delivered by a `<meta>` tag.** GitHub Pages cannot set response headers, so `frame-ancestors` is unavailable; a JavaScript frame check is used instead.
7. **Third-party code:** Chart.js and SheetJS are vendored at fixed versions, and Google Identity Services loads from Google. CoinGecko is called only server-side, sending only coin IDs.
8. **Sandbox mode** keeps data unencrypted in the browser's `localStorage`. Use it to try the app, not for your only copy of real data.
9. **Single user.** There are no roles. Adding emails to `ALLOWED_EMAILS` gives those people full read/write access.
10. **Not a regulated system.** No bank-grade audit, no SOC 2, no backups beyond what you configure: Google Sheets version history plus the JSON backup. Projections are illustrations, not financial advice.

If you need multi-user roles, rate limiting, IP allowlists or stronger session handling, put the same `service.js` behind Cloud Run with Identity-Aware Proxy, or behind a small server that issues short-lived HttpOnly session cookies.
