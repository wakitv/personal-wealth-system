import { html, mount, $, uid, download, formData } from '../utils/dom.js';
import * as F from '../utils/format.js';
import { store } from '../state.js';
import { api, getConnection, clearConnection, wipeSandbox } from '../services/api.js';
import { auth } from '../services/auth.js';
import { dataTable, toast, errorMessage, confirmDialog, loadingBlock } from '../components/ui.js';
import { fxForm } from '../components/forms.js';
import { refreshPrices } from './portfolio.js';
const Core = window.WealthCore;

export function render(root) {
  const s = store.settings;
  const conn = getConnection();
  const hasTx = store.data.transactions.length > 0;
  const snaps = store.snapshots();
  const sel = (name, opts) => html`<select name="${name}">${opts.map(([v, l]) => html`<option value="${v}" ${String(s[name]) === v ? 'selected' : ''}>${l}</option>`)}</select>`;
  const fxLatest = {};
  (store.data.fx || []).forEach((r) => { if (!fxLatest[r.currency] || Date.parse(r.as_of) > Date.parse(fxLatest[r.currency].as_of)) fxLatest[r.currency] = r; });
  const usedCur = [...new Set([...store.data.accounts.map((a) => a.currency), ...store.data.assets.map((a) => a.currency)])].filter((c) => c !== store.base);
  mount(root, html`
    <div class="page-head"><div><h1>Settings</h1><p class="muted">Preferences, rates, snapshots, data integrity, backups and security.</p></div></div>

    <section class="card"><div class="card-head"><h3>Preferences</h3></div>
      <form id="prefs" class="grid-form">
        <label class="field"><span>Base currency</span><input name="base_currency" value="${s.base_currency}" ${hasTx ? 'readonly' : ''} maxlength="5"><small>${hasTx ? 'Locked once transactions exist' : 'All totals are converted to this'}</small></label>
        <label class="field"><span>Time zone</span><input name="timezone" value="${s.timezone}"><small>IANA name, e.g. Asia/Manila</small></label>
        <label class="field"><span>Date format</span>${sel('date_format', [['DD MMM YYYY', 'DD MMM YYYY (14 Oct 2026)']])}</label>
        <label class="field"><span>Theme</span>${sel('theme', [['dark', 'Dark terminal'], ['light', 'Light']])}</label>
        <label class="field"><span>Default chart period</span>${sel('default_period', [['1D', 'Today'], ['7D', '7 days'], ['30D', '30 days'], ['90D', '90 days'], ['YTD', 'Year to date'], ['1Y', '1 year'], ['ALL', 'All time']])}</label>
        <label class="field"><span>Performance method</span>${sel('performance_method', [['TWR', 'Time-weighted return (recommended)'], ['MODIFIED_DIETZ', 'Modified Dietz']])}<small>Both exclude deposits & withdrawals from profit</small></label>
        <label class="field"><span>Default for balance adjustments</span>${sel('reconcile_default', [['FLOW', 'External flow (not profit)'], ['NON_FLOW', 'Gain / loss']])}</label>
        <label class="field"><span>Stale price after (days)</span><input name="stale_price_days" inputmode="numeric" value="${s.stale_price_days}"></label>
        <label class="field"><span>Concentration warning (%)</span><input name="concentration_threshold" inputmode="decimal" value="${s.concentration_threshold}"></label>
        <label class="field"><span>Inflation assumption (%/yr)</span><input name="inflation_rate" inputmode="decimal" value="${s.inflation_rate}"></label>
        <label class="field"><span>Account references</span>${sel('mask_references', [['true', 'Masked (•••• 1234)'], ['false', 'Shown in full']])}</label>
        <label class="field"><span>Daily automatic price refresh</span>${sel('price_auto_refresh', [['false', 'Off — manual prices'], ['true', 'On — CoinGecko before nightly snapshot']])}</label>
        <label class="field wide"><span>CoinGecko IDs for FX currencies (JSON)</span><input name="coingecko_fx_ids" value="${s.coingecko_fx_ids}"><small>Used only by “Refresh prices”. Example: {"USDT":"tether"}</small></label>
        <div class="wide"><button class="btn primary" type="submit">Save preferences</button></div>
      </form></section>

    <section class="grid g2">
      <div class="card"><div class="card-head"><h3>FX rates (${store.base} per 1 unit)</h3><button class="btn sm" data-a="fx">Add rate</button></div>
        ${usedCur.filter((c) => !fxLatest[c] && !store.latestFx(c)).length ? html`<div class="banner warn sm">${F.icon('alert')}<div>No rate recorded for ${usedCur.filter((c) => !fxLatest[c] && !store.latestFx(c)).join(', ')} — balances in these currencies are excluded from totals.</div></div>` : ''}
        <div id="fx-table"></div></div>
      <div class="card"><div class="card-head"><h3>Prices</h3></div>
        <p class="sm muted">Manual prices are entered on each asset. Crypto assets set to CoinGecko can be refreshed by the backend (no API key; read-only market data). Every price keeps its source and timestamp.</p>
        ${api.mode === 'remote' ? html`<button class="btn" id="refresh">${F.icon('refresh')} Refresh CoinGecko prices now</button>` : html`<p class="muted sm">Automatic prices need the Apps Script backend (not available in sandbox).</p>`}
        <h4>Daily snapshots</h4>
        <p class="sm">${snaps.length ? html`${snaps.length} snapshots · ${F.dateStr(snaps[0].snapshot_date)} → ${F.dateStr(snaps[snaps.length - 1].snapshot_date)}` : 'No snapshots yet.'} ${api.mode === 'remote' ? 'The nightly trigger (installDailySnapshotTrigger) takes one automatically.' : 'In sandbox mode, take snapshots manually.'}</p>
        <div class="btn-row"><button class="btn sm" data-a="snap">Take today’s snapshot</button></div>
        <form id="rebuild" class="inline-form"><input type="date" name="from" aria-label="From" value="${snaps[0]?.snapshot_date || ''}"><input type="date" name="to" aria-label="To" value="${F.today()}"><button class="btn sm ghost" type="submit">Rebuild range from ledger</button></form>
        <p class="xs muted">Rebuilding recomputes each day from the ledger and the prices/FX recorded up to that day — the same calculation the nightly job runs.</p>
      </div>
    </section>

    <section class="card"><div class="card-head"><h3>Data reconciliation</h3><button class="btn sm" data-a="integrity">Run integrity check</button></div><div id="integrity"><p class="muted sm">Checks duplicate IDs, broken transfer pairs, orphan reversals, negative balances or quantities, missing FX, and that account totals and category totals both equal net worth.</p></div></section>

    <section class="grid g2">
      <div class="card"><div class="card-head"><h3>Backup & restore</h3></div>
        <p class="sm">Download a complete JSON backup of every worksheet (accounts, assets, ledger, prices, FX, snapshots, goals, settings, audit log). Keep it somewhere private — it contains your financial records.</p>
        <div class="btn-row"><button class="btn" data-a="backup">${F.icon('file')} Download backup</button><label class="btn ghost file-btn">Restore from backup…<input type="file" id="restore" accept="application/json,.json" hidden></label></div>
        <p class="xs muted">Restore only runs into an empty database (a fresh spreadsheet with setupDatabase()), and is refused if the backup fails integrity checks. Google Sheets’ own version history (File → Version history) is a second safety net.</p></div>
      <div class="card"><div class="card-head"><h3>Connection & security</h3></div>
        <dl class="kv sm">
          <dt>Mode</dt><dd>${api.mode === 'sandbox' ? html`${F.badge('Sandbox', 'warn')} data stays in this browser only` : html`${F.badge('Apps Script', 'ok')} Google Sheets backend`}</dd>
          ${api.mode === 'remote' ? html`<dt>API URL</dt><dd class="break">${conn.apiUrl}</dd><dt>Signed in as</dt><dd>${store.data.user?.email || auth.user()?.email || '—'}</dd><dt>Session expires</dt><dd>${auth.user()?.exp ? F.dateTime(auth.user().exp * 1000) : '—'}</dd>` : ''}
          <dt>Server time</dt><dd>${F.dateTime(store.data.serverTime)}</dd><dt>API version</dt><dd>${store.data.apiVersion} · core ${Core.VERSION}</dd>
        </dl>
        <div class="btn-row"><button class="btn sm" data-a="health">Health check</button>${api.mode === 'remote' ? html`<button class="btn sm" data-a="signout">Sign out</button>` : html`<button class="btn sm danger" data-a="wipe">Erase sandbox data</button>`}<button class="btn sm ghost" data-a="disconnect">Change backend…</button></div>
        <p class="xs muted">Access is enforced by the backend on every request (verified Google ID token + email allowlist). This screen cannot grant access by itself. Never store passwords, PINs, seed phrases or private keys in any field.</p></div>
    </section>

    <section class="card"><div class="card-head"><h3>Audit log</h3><button class="btn sm ghost" data-a="audit">Load latest 200</button></div><div id="audit"><p class="muted sm">Every create, post, reversal, edit, setting change, snapshot, export and restore is recorded with time and actor.</p></div></section>`);

  const fxRows = [...(store.data.fx || [])].sort((a, b) => Date.parse(b.as_of) - Date.parse(a.as_of));
  dataTable($('#fx-table'), { rows: fxRows, search: false, pageSize: 8, empty: 'No FX rates recorded. Transaction rates are also used as observations.', columns: [
    { key: 'currency', label: 'Currency' }, { key: 'rate', label: 'Rate', align: 'r', render: (r) => F.qty(r.rate) },
    { key: 'as_of', label: 'As of', sort: (r) => Date.parse(r.as_of), render: (r) => F.dateTime(r.as_of) }, { key: 'source', label: 'Source', render: (r) => html`<span class="muted sm">${r.source}</span>` }] });

  root.onsubmit = async (e) => {
    e.preventDefault();
    if (e.target.id === 'prefs') {
      const d = formData(e.target);
      const values = {};
      Object.keys(d).forEach((k) => { if (String(d[k]) !== String(s[k] ?? '')) values[k] = String(d[k]); });
      if (!Object.keys(values).length) return toast('No changes');
      try { await store.write('saveSettings', { values }, uid('req')); applyTheme(store.setting('theme', 'dark')); toast('Preferences saved'); } catch (err) { toast(errorMessage(err), 'error', 6000); }
    }
    if (e.target.id === 'rebuild') {
      const d = formData(e.target);
      try { const r = await store.write('rebuildSnapshots', { from: d.from, to: d.to }, uid('req')); toast(r.count ? `Rebuilt ${r.count} day(s)` : r.note || 'Nothing to rebuild'); } catch (err) { toast(errorMessage(err), 'error'); }
    }
  };
  root.onchange = async (e) => {
    if (e.target.id !== 'restore' || !e.target.files[0]) return;
    const file = e.target.files[0];
    e.target.value = '';
    let backup;
    try { backup = JSON.parse(await file.text()); } catch { return toast('That file is not valid JSON', 'error'); }
    const ok = await confirmDialog({ title: 'Restore backup', confirmLabel: 'Restore', message: `Restore “${file.name}” (exported ${backup.exported_at ? F.dateTime(backup.exported_at) : 'unknown date'})? This only works into an empty database.` });
    if (!ok) return;
    try { const r = await store.write('restoreBackup', { backup }, uid('req')); toast('Restored: ' + Object.entries(r.restored).map(([k, v]) => k + ' ' + v).join(', ')); } catch (err) { toast(errorMessage(err), 'error', 8000); }
  };
  root.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (e.target.closest('#refresh')) return refreshPrices(e.target.closest('#refresh'));
    if (!a) return;
    try {
      if (a === 'fx') fxForm();
      if (a === 'snap') { await store.write('takeSnapshot', {}, uid('req')); toast('Snapshot saved for ' + F.dateStr(F.today())); }
      if (a === 'integrity') {
        mount($('#integrity'), loadingBlock(2));
        const r = await api.call('integrityCheck');
        mount($('#integrity'), html`<div class="banner ${r.ok ? 'ok' : 'danger'} sm">${F.icon(r.ok ? 'check' : 'alert')}<div><strong>${r.ok ? 'Ledger reconciles' : 'Issues found'}</strong> · ${r.txCount} ledger rows checked</div></div>
          <dl class="kv sm"><dt>Net worth</dt><dd>${F.php(r.identity.netWorth)}</dd><dt>Σ account totals (+ unassigned)</dt><dd>${F.php(r.identity.accountsPlusUnassigned)}</dd><dt>Cash + investments − liabilities</dt><dd>${F.php(r.identity.cashPlusInvestmentMinusLiabilities)}</dd></dl>
          ${r.issues.length ? html`<ul class="issues">${r.issues.map((i) => html`<li class="${i.level}">${F.badge(i.level, i.level === 'error' ? 'bad' : 'warn')} ${i.message}</li>`)}</ul>` : html`<p class="muted sm">No issues.</p>`}`);
      }
      if (a === 'backup') {
        const b = await api.call('exportBackup');
        download(`wealth-os-backup-${F.today()}.json`, JSON.stringify(b, null, 1), 'application/json');
        toast('Backup downloaded — store it privately');
      }
      if (a === 'audit') {
        mount($('#audit'), loadingBlock(3));
        const r = await api.call('getAuditLog', { limit: 200 });
        dataTable($('#audit'), { rows: r.rows, pageSize: 25, columns: [
          { key: 'at', label: 'When', sort: (x) => Date.parse(x.at), render: (x) => F.dateTime(x.at) }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Entity' },
          { key: 'entity_id', label: 'ID', render: (x) => html`<span class="mono xs">${x.entity_id}</span>` }, { key: 'actor', label: 'Actor', render: (x) => html`<span class="sm">${x.actor}</span>` }] });
      }
      if (a === 'health') { const h = await api.health(); toast(`Backend OK · API ${h.apiVersion} · ${F.dateTime(h.time)}`); }
      if (a === 'signout') { auth.signOut(); location.hash = ''; location.reload(); }
      if (a === 'wipe') {
        if (await confirmDialog({ title: 'Erase sandbox data', message: 'Deletes everything stored in this browser’s sandbox. This cannot be undone. Download a backup first if you want to keep it.', confirmLabel: 'Erase' })) { wipeSandbox(); location.reload(); }
      }
      if (a === 'disconnect') {
        if (await confirmDialog({ title: 'Change backend', danger: false, confirmLabel: 'Continue', message: 'You will return to the connection screen. Data in your Google Sheet (or this browser’s sandbox) is not touched.' })) { auth.signOut(); clearConnection(); location.hash = ''; location.reload(); }
      }
    } catch (err) { toast(errorMessage(err), 'error', 6000); }
  };
}

export function applyTheme(t) {
  try { localStorage.setItem('pwos.theme', t); } catch { /* ignore */ }
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
}
