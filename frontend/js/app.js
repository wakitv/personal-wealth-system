import { html, mount, $, $$ } from './utils/dom.js';
import * as F from './utils/format.js';
import { CONFIG } from './config.js';
import { api, getConnection, saveConnection } from './services/api.js';
import { auth } from './services/auth.js';
import { store } from './state.js';
import { loadingBlock, errorState, toast, errorMessage, closeModal } from './components/ui.js';
import { quick } from './components/forms.js';
import * as Dashboard from './pages/dashboard.js';
import * as Accounts from './pages/accounts.js';
import * as Transactions from './pages/transactions.js';
import * as Portfolio from './pages/portfolio.js';
import * as Reports from './pages/reports.js';
import * as Planning from './pages/planning.js';
import * as Settings from './pages/settings.js';

const NAV = [
  ['dashboard', 'Dashboard', 'grid'], ['accounts', 'Accounts / Wallets', 'wallet'], ['transactions', 'Transactions', 'list'],
  ['portfolio', 'My Portfolio', 'pie'], ['crypto', 'Crypto', 'coin', true], ['stocks', 'Stocks', 'trend', true], ['other', 'Other Assets', 'box', true],
  ['reports', 'Reports', 'file'], ['planning', 'Planning & Goals', 'target'], ['settings', 'Settings', 'cog']
];
const ROUTES = {
  dashboard: [Dashboard], accounts: [Accounts], transactions: [Transactions], portfolio: [Portfolio, 'portfolio'], crypto: [Portfolio, 'crypto'],
  stocks: [Portfolio, 'stocks'], other: [Portfolio, 'other'], assets: [Portfolio, 'asset'], reports: [Reports], planning: [Planning], settings: [Settings]
};

// ------------------------------------------------------------------ boot
// Refuse to run inside a frame (GitHub Pages cannot send frame-ancestors / X-Frame-Options headers).
if (window.top !== window.self) { document.documentElement.innerHTML = ''; throw new Error('Framing is not allowed'); }

(function theme() {
  let t = 'dark';
  try { t = localStorage.getItem('pwos.theme') || 'dark'; } catch { /* ignore */ }
  document.documentElement.dataset.theme = t;
  try { if (localStorage.getItem('pwos.privacy') === '1') document.body.classList.add('privacy'); } catch { /* ignore */ }
})();

const app = $('#app');

async function boot() {
  const conn = getConnection();
  if (!conn.mode) return connectScreen();
  api.init(conn);
  if (conn.mode === 'sandbox') return start();
  if (!conn.apiUrl || !conn.clientId) return connectScreen('Enter both the API URL and the Google OAuth client ID.');
  mount(app, html`<div class="center-screen">${loadingBlock(2)}</div>`);
  try { await auth.init(conn.clientId); }
  catch (e) { return signInScreen(e.message); }
  api.onAuthError(() => { auth.signOut(); signInScreen('Your session has expired. Please sign in again.'); });
  if (auth.current()) return start();
  signInScreen();
}

function shell() {
  mount(app, html`
    ${api.mode === 'sandbox' ? html`<div class="sandbox-bar" role="note">${F.icon('alert')} Sandbox mode — data is stored only in this browser and is not backed up. <a href="#/settings">Connect your Google Sheets backend</a> for real use.</div>` : ''}
    <div class="layout">
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        <div class="brand"><span class="logo" aria-hidden="true">◆</span><div><strong>Wealth OS</strong><span class="muted xs">Personal terminal</span></div></div>
        <nav><ul>${NAV.map(([k, l, i, sub]) => html`<li><a href="#/${k}" data-nav="${k}" class="${sub ? 'sub' : ''}">${F.icon(i)}<span>${l}</span></a></li>`)}</ul></nav>
        <div class="side-foot muted xs" id="side-foot"></div>
      </aside>
      <div class="scrim" id="scrim" hidden></div>
      <div class="main-col">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menu" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${F.icon('menu')}</button>
          <div class="topbar-title" id="top-title"></div>
          <div class="topbar-actions">
            <div class="nw-pill" id="nw-pill" title="Net worth"></div>
            <button class="icon-btn" id="privacy" aria-label="Hide or show amounts" title="Hide amounts">${F.icon('eye')}</button>
            <button class="icon-btn" id="reload" aria-label="Reload data" title="Reload">${F.icon('refresh')}</button>
            <div class="add-wrap"><button class="btn primary sm" id="add-btn" aria-haspopup="menu" aria-expanded="false">${F.icon('plus')}<span class="hide-sm">New</span></button>
              <div class="menu" id="add-menu" role="menu" hidden>
                ${[['deposit', 'Deposit'], ['withdrawal', 'Withdrawal'], ['transfer', 'Transfer'], ['buy', 'Purchase'], ['sell', 'Sale'], ['income', 'Income'], ['fee', 'Fee'], ['balance', 'Update balance'], ['addAsset', 'Asset'], ['account', 'Account']].map(([k, l]) => html`<button role="menuitem" data-q="${k}">${l}</button>`)}
              </div></div>
          </div>
        </header>
        <main id="main" tabindex="-1"></main>
      </div>
    </div>`);
  $('#menu').onclick = () => toggleNav();
  $('#scrim').onclick = () => toggleNav(false);
  $('#privacy').onclick = () => { const on = document.body.classList.toggle('privacy'); try { localStorage.setItem('pwos.privacy', on ? '1' : '0'); } catch { /* ignore */ } };
  $('#reload').onclick = () => reload(true);
  const menu = $('#add-menu'), btn = $('#add-btn');
  btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) $('button', menu).focus(); };
  menu.onclick = (e) => { const q = e.target.closest('[data-q]')?.dataset.q; if (q) { menu.hidden = true; quick[q](); } };
  menu.onkeydown = (e) => {
    const items = $$('button', menu), i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { menu.hidden = true; btn.focus(); }
  };
  document.addEventListener('click', () => { menu.hidden = true; });
}
function toggleNav(open) {
  const sb = $('#sidebar'), on = open ?? !sb.classList.contains('open');
  sb.classList.toggle('open', on); $('#scrim').hidden = !on; $('#menu').setAttribute('aria-expanded', String(on));
}

let started = false;
async function start() {
  shell();
  if (!started) {
    started = true;
    store.subscribe(() => { if (!store.loading && store.data) renderRoute(); updateChrome(); });
    window.addEventListener('hashchange', () => { closeModal(); toggleNav(false); renderRoute(true); });
  }
  await reload();
  // Refresh live valuations periodically (prices only change when recorded, but "today" rolls over).
  if (!window.__pwosTimer) window.__pwosTimer = setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.modal-wrap')) reload(); }, 10 * 60 * 1000);
}
async function reload(manual) {
  const main = $('#main');
  if (!store.data) mount(main, html`<div class="page">${loadingBlock(5)}</div>`);
  try {
    await store.load();
    Settings.applyTheme(store.setting('theme', 'dark'));
    if (manual) toast('Data reloaded');
  } catch (e) {
    if (e.code === 'UNAUTHENTICATED' || e.code === 'FORBIDDEN') return signInScreen(errorMessage(e));
    if (!store.data) { mount(main, html`<div class="page">${errorState(e)}</div>`); main.onclick = (ev) => { if (ev.target.closest('[data-action="reload"]')) reload(); }; }
    else toast(errorMessage(e), 'error');
  }
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: ROUTES[parts[0]] ? parts[0] : 'dashboard', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}
let lastRoute = '';
function renderRoute(scrollTop) {
  if (!store.data) return;
  const { name, id } = parseHash();
  const [mod, variant] = ROUTES[name];
  const main = $('#main');
  const key = name + '/' + (id || '');
  const y = window.scrollY;
  main.onclick = null; main.onchange = null; main.oninput = null; main.onsubmit = null;
  const page = document.createElement('div');
  page.className = 'page'; page.id = 'page-' + name;
  main.replaceChildren(page);
  try { mod.render(page, { id }, variant || name); }
  catch (e) { console.error(e); mount(page, errorState(e, false)); }
  $$('[data-nav]').forEach((a) => { const on = a.dataset.nav === (name === 'assets' ? assetNav(id) : name); a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const label = (NAV.find((n) => n[0] === name) || [, 'Asset'])[1];
  $('#top-title').textContent = label;
  document.title = label + ' · ' + CONFIG.APP_NAME;
  if (scrollTop || key !== lastRoute) { window.scrollTo(0, 0); if (scrollTop) main.focus({ preventScroll: true }); } else window.scrollTo(0, y);
  lastRoute = key;
}
function assetNav(id) { const a = store.asset(id); return a ? { CRYPTO: 'crypto', STOCK: 'stocks', OTHER: 'other' }[a.asset_class] : 'portfolio'; }
function updateChrome() {
  if (!store.data) return;
  const pill = $('#nw-pill');
  if (pill) pill.innerHTML = String(html`<span class="muted xs">Net worth</span> <strong class="amt">${F.php(store.live.summary.netWorth, { compact: true })}</strong>`);
  const foot = $('#side-foot');
  if (foot) foot.innerHTML = String(html`${api.mode === 'sandbox' ? 'Sandbox' : store.data.user?.email || ''}<br>Updated ${F.dateTime(store.loadedAt)}`);
}

// ------------------------------------------------------------------ connect & sign-in screens
function connectScreen(msg = '') {
  const c = getConnection();
  mount(app, html`<div class="center-screen"><div class="card auth-card">
    <div class="brand big"><span class="logo">◆</span><div><strong>Personal Wealth OS</strong><span class="muted sm">Private portfolio tracker & wealth planner</span></div></div>
    ${msg ? html`<div class="banner warn sm">${msg}</div>` : ''}
    <h2>Connect your private backend</h2>
    <p class="sm muted">Enter the URL of your Google Apps Script deployment and your Google OAuth Web client ID (see docs/DEPLOYMENT.md). Neither is a secret; access is enforced by the backend.</p>
    <form id="connect" class="stack">
      <label class="field"><span>Apps Script web app URL</span><input name="apiUrl" required data-label="API URL" placeholder="https://script.google.com/macros/s/…/exec" value="${c.apiUrl || ''}"></label>
      <label class="field"><span>Google OAuth client ID</span><input name="clientId" required data-label="Client ID" placeholder="…apps.googleusercontent.com" value="${c.clientId || ''}"></label>
      <div class="form-error" hidden></div>
      <button class="btn primary" type="submit">Test & connect</button>
    </form>
    <div class="divider"><span>or</span></div>
    <button class="btn ghost wide" id="sandbox">Explore in sandbox (this browser only, starts empty)</button>
    <p class="xs muted">The sandbox runs the same ledger engine locally so you can try every feature before deploying. Don’t keep your only copy of real data there.</p>
  </div></div>`);
  $('#sandbox').onclick = () => { saveConnection({ mode: 'sandbox' }); location.reload(); };
  $('#connect').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, err = $('.form-error', f), btn = $('button[type=submit]', f);
    const apiUrl = f.apiUrl.value.trim(), clientId = f.clientId.value.trim();
    err.hidden = true;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(apiUrl)) { err.hidden = false; err.textContent = 'The URL should look like https://script.google.com/macros/s/…/exec'; return; }
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) { err.hidden = false; err.textContent = 'The client ID should end with .apps.googleusercontent.com'; return; }
    btn.disabled = true; btn.classList.add('loading');
    try {
      api.init({ mode: 'remote', apiUrl });
      const h = await api.health();
      if (h.status !== 'ok') throw new Error('Unexpected health response');
      saveConnection({ mode: 'remote', apiUrl, clientId });
      location.reload();
    } catch (ex) { err.hidden = false; err.textContent = 'Could not reach the backend: ' + errorMessage(ex); }
    finally { btn.disabled = false; btn.classList.remove('loading'); }
  };
}

function signInScreen(msg = '') {
  mount(app, html`<div class="center-screen"><div class="card auth-card">
    <div class="brand big"><span class="logo">◆</span><div><strong>Personal Wealth OS</strong><span class="muted sm">Sign in to continue</span></div></div>
    ${msg ? html`<div class="banner warn sm" role="alert">${msg}</div>` : ''}
    <p class="sm muted">Sign in with the Google account listed in your backend’s ALLOWED_EMAILS. Your Google ID token is verified by the server on every request.</p>
    <div id="gsi-btn" class="gsi"></div>
    <button class="btn ghost sm" id="change">Use a different backend</button>
  </div></div>`);
  $('#change').onclick = () => connectScreen();
  if (window.google?.accounts?.id) auth.renderButton($('#gsi-btn'));
  else mount($('#gsi-btn'), html`<p class="muted sm">Google sign-in is loading… If it never appears, check your connection or content blockers.</p>`);
  const off = auth.onSignIn(() => { off(); start(); });
}

boot().catch((e) => { console.error(e); mount(app, html`<div class="center-screen">${errorState(e, false)}</div>`); });
