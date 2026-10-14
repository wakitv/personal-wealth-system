# Deployment guide

Allow about 30–45 minutes the first time. You need a Google account, which will own the data, and a GitHub account. Google's console menus change from time to time; if a label below differs slightly, look for the equivalent option.

---

## 0. Try it locally first (optional, 2 minutes)

```bash
node --version            # 18+
npm test                  # unit + integration tests
npm run serve             # http://localhost:5173 → "Explore in sandbox"
```

---

## 1. Create the Google OAuth client (sign-in)

1. Open <https://console.cloud.google.com/>, then **Select project → New project**. Name it, for example, `personal-wealth-os`.
2. Go to **APIs & Services → OAuth consent screen**. In newer consoles this is **Google Auth Platform → Branding / Audience**.
   * User type **External**, publishing status **Testing**.
   * App name: `Personal Wealth OS`. Support email and developer email: yours.
   * Scopes: add nothing. Sign-in only uses `openid`, `email` and `profile`.
   * **Test users: add your own Google email.** While in Testing mode, only test users can sign in.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   * Application type: **Web application**.
   * Authorized JavaScript origins:
     * `https://<your-github-username>.github.io`
     * `http://localhost:5173` (for local testing; remove later if you like)
   * Authorized redirect URIs: **none**.
4. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.

## 2. Create the Apps Script backend

### Option A — copy & paste (no tools)
1. Open <https://script.google.com/> and create a **New project**. Rename it `Personal Wealth OS API`.
2. Click the gear icon (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.
3. In the editor, create one script file per file in `backend/` and paste in its contents: `Code`, `Config`, `Auth`, `SheetStore`, `Core`, `Service`, `Setup`, `Snapshots`. Replace `appsscript.json` with `backend/appsscript.json`.
   * `Core.gs` and `Service.gs` are generated from `shared/`. Run `npm run build` first if you changed anything.

### Option B — clasp (command line)
```bash
npm install -g @google/clasp
clasp login
cd backend
clasp create --type standalone --title "Personal Wealth OS API"   # writes .clasp.json
clasp push
```

### Configure Script Properties
In **Project Settings → Script properties**, add:

| Property | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the client ID from step 1 |
| `ALLOWED_EMAILS` | your Google email (comma-separate if you add more) |
| `SPREADSHEET_ID` | *(leave empty — `setupDatabase` creates a private sheet and fills this in; or paste the ID of an empty sheet you created)* |

### Initialise the database
1. In the editor toolbar choose **`setupDatabase`**, then click **Run**. Approve the permission prompt. You may see "Google hasn't verified this app": choose **Advanced → Go to … (unsafe)**. This is expected, because it is your own script.
2. Open the execution log. It prints the new spreadsheet URL. Open it and confirm the 10 worksheets exist: Settings, Accounts, Assets, Transactions, PriceHistory, FXRates, DailySnapshots, Goals, AuditLog, Requests.
3. In that spreadsheet, check that **Share** shows *Restricted*.
4. Run **`selfTest`**. It must print `All checks passed.`

### Deploy the web app
1. Choose **Deploy → New deployment → Select type: Web app**.
   * Description: `v1`
   * **Execute as: Me**
   * **Who has access: Anyone**
2. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
3. Check it works: open `<URL>?action=health` in a browser. You should see `{"ok":true,"data":{"status":"ok",…}}` and no financial data.

### Enable daily snapshots
Run **`installDailySnapshotTrigger`** once. Confirm it appears under **Triggers**, the clock icon on the left: `dailySnapshotJob`, time-driven, daily. Run `dailySnapshotJob` manually once to confirm it works.

> **Updating the backend later:** paste the new code, then **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. The URL stays the same.

## 3. Publish the frontend on GitHub Pages

```bash
git init personal-wealth-os && cd personal-wealth-os     # or use this folder
git add . && git commit -m "Personal Wealth OS v1"
git branch -M main
git remote add origin https://github.com/<you>/personal-wealth-os.git
git push -u origin main
```

1. On GitHub, open **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. The included workflow `.github/workflows/pages.yml` runs the tests and publishes the `frontend/` folder on every push to `main`.
3. Your site will be at `https://<you>.github.io/personal-wealth-os/`.
4. A public repository is fine: the frontend contains no secrets. GitHub Pages on a private repository requires a paid GitHub plan.

**Configuration:** either
* edit `frontend/js/config.js` and set `API_URL` and `GOOGLE_CLIENT_ID`, then commit; or
* leave them empty and enter both values on the app's **Connect your private backend** screen. They are stored in that browser.

## 4. Test the live deployment

| # | Check | Expected |
|---|---|---|
| 1 | Open the site → Connect → enter URL + client ID | "Test & connect" succeeds (health check) |
| 2 | Sign in with your allow-listed Google account | Dashboard loads ("Welcome…") |
| 3 | Sign in with a **different** Google account (private window) | "This Google account is not authorised…"; no data shown |
| 4 | `curl -s -L -H 'Content-Type: text/plain' -d '{"action":"bootstrap"}' '<URL>'` | `{"ok":false,"error":{"code":"UNAUTHENTICATED",…}}` |
| 5 | Same with `"idToken":"x.y.z"` | `UNAUTHENTICATED` |
| 6 | Add an account with an opening balance; check the Accounts sheet and the Transactions sheet | One account row, one `OPENING_BALANCE` row |
| 7 | Double-click **Record** on a deposit | Exactly one `DEPOSIT` row |
| 8 | Withdraw more than the balance | "Insufficient funds…" |
| 9 | Transfer between two accounts | Two linked rows with the same `link_id`; net worth unchanged |
| 10 | Settings → Run integrity check | "Ledger reconciles" |
| 11 | Settings → Take today's snapshot; next morning check DailySnapshots | A row per day |
| 12 | Settings → Download backup | A JSON file with all worksheets |
| 13 | Phone: open the site, sign in, record a deposit | Works on mobile layout |

## 5. Backup & restore

* **Automatic:** Google Sheets keeps version history (**File → Version history**).
* **Manual:** **Settings → Download backup** saves a full JSON backup. Store it privately, because it contains all your records.
* **Restore:**
  1. Create a fresh spreadsheet: clear `SPREADSHEET_ID`, then run `setupDatabase` again, or point `SPREADSHEET_ID` at a new empty sheet and run `setupDatabase`.
  2. Redeploy if you changed properties.
  3. In the app, choose **Settings → Restore from backup** and pick the JSON file. The restore refuses to run into a non-empty database, and refuses a backup that fails the integrity checks.
* **CSV/XLSX exports** from Reports open in Excel and Google Sheets.

## 6. Launch checklist

- [ ] `npm test` passes locally; the GitHub Actions run is green
- [ ] OAuth consent screen is in **Testing**, with only your email as a test user
- [ ] OAuth client's JavaScript origins list only your Pages origin (+ localhost if needed)
- [ ] Script properties set; `selfTest()` prints *All checks passed*
- [ ] Spreadsheet and script are **not shared** with anyone
- [ ] Web app: Execute as **Me**, access **Anyone**; `?action=health` returns no data
- [ ] Unauthenticated `curl` returns `UNAUTHENTICATED`; another Google account gets `FORBIDDEN`
- [ ] 2-Step Verification enabled on your Google account
- [ ] Daily snapshot trigger installed
- [ ] FX rates recorded for every non-PHP currency you hold (e.g. USDT)
- [ ] First backup downloaded and stored privately
- [ ] You have read the limitations in [SECURITY.md](SECURITY.md)

## Optional: automatic crypto prices

For each crypto asset, set **Price source: CoinGecko** and its **CoinGecko ID** (e.g. `bitcoin`, `ethereum`). Set the asset's price currency to `PHP`. Use **Crypto → Refresh prices**, or enable **Settings → Daily automatic price refresh** so the nightly job fetches prices before taking the snapshot.

USDT/USDC → PHP FX rates can come from the same call, via the `coingecko_fx_ids` setting. CoinGecko's free public API has rate limits; the app falls back to your manual prices and labels their age.
