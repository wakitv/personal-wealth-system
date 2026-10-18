import { api } from './services/api.js';
import { configure, setDisplay } from './utils/format.js';
const DISPLAY_KEY = 'pwos.displayCurrency';
const Core = window.WealthCore;

/** Central store: raw records from the backend + derived views (all via WealthCore). */
class Store {
  constructor() {
    this.data = null; this.live = null; this.loading = false; this.error = null; this.loadedAt = 0;
    this.subs = new Set(); this.memo = new Map();
  }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { this.subs.forEach((fn) => fn(this)); }

  async load() {
    this.loading = true; this.error = null; this.emit();
    try {
      const d = await api.call('bootstrap');
      this.set(d);
    } catch (e) { this.error = e; throw e; }
    finally { this.loading = false; this.emit(); }
  }
  set(d) {
    this.data = d;
    this.memo.clear();
    configure({ base: d.settings.base_currency, tz: d.settings.timezone });
    this.applyDisplay();
    this.live = Core.computeState(this.coreData(), { asOf: Date.now() });
    this.loadedAt = Date.now();
  }
  /** Perform a write, then reload so every view reflects the server's ledger. */
  async write(action, payload, requestId) {
    const res = await api.call(action, payload, { requestId });
    await this.load();
    return res;
  }

  /** Preferred display currency for totals (per device). Only the base currency or USD. */
  get displayPref() { let v = null; try { v = localStorage.getItem(DISPLAY_KEY); } catch { /* ignore */ } return v === 'USD' ? 'USD' : this.base; }
  set displayPref(v) { try { localStorage.setItem(DISPLAY_KEY, v); } catch { /* ignore */ } }
  /** USD rate (base per 1 USD) used for display, or null if none recorded. */
  usdRate() { return this.base === 'USD' ? 1 : this.latestFx('USD')?.rate || null; }
  applyDisplay() {
    const want = this.displayPref;
    const rate = want === 'USD' ? this.usdRate() : 1;
    setDisplay(want === this.base || !rate ? null : want, rate);
    return !(want === 'USD' && !rate);
  }
  coreData() { const d = this.data; return { accounts: d.accounts, assets: d.assets, transactions: d.transactions, prices: d.prices, fx: d.fx, settings: d.settings }; }
  get settings() { return this.data?.settings || {}; }
  get base() { return this.settings.base_currency || 'PHP'; }
  get tz() { return this.settings.timezone || 'Asia/Manila'; }
  setting(k, d) { const v = this.settings[k]; return v === undefined || v === '' ? d : v; }
  settingJson(k, d) { try { return JSON.parse(this.settings[k]); } catch { return d; } }

  account(id) { return this.data.accounts.find((a) => a.account_id === id); }
  asset(id) { return this.data.assets.find((a) => a.asset_id === id); }
  activeAccounts() { return this.data.accounts.filter((a) => a.status !== 'ARCHIVED'); }
  activeAssets(cls) { return this.data.assets.filter((a) => a.status !== 'ARCHIVED' && a.status !== 'REMOVED' && (!cls || a.asset_class === cls)); }
  /** Transactions newest first, normalised. */
  txs() {
    if (!this.memo.has('txs')) this.memo.set('txs', this.data.transactions.map(Core.normTx).sort((a, b) => (b.t - a.t) || (b.seq - a.seq)));
    return this.memo.get('txs');
  }
  stateAt(ms) {
    const k = 'st' + ms;
    if (!this.memo.has(k)) this.memo.set(k, Core.computeState(this.coreData(), { asOf: ms }));
    return this.memo.get(k);
  }
  latestFx(cur) {
    const m = Core.buildMarket(this.coreData(), this.base);
    return Core.fxAt(m, cur, Date.now());
  }
  latestPrice(assetId) {
    const m = Core.buildMarket(this.coreData(), this.base);
    const list = m.prices[assetId] || [];
    return list.length ? list[list.length - 1] : null;
  }
  snapshots() {
    if (!this.memo.has('snaps')) this.memo.set('snaps', [...(this.data.snapshots || [])].sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date))));
    return this.memo.get('snaps');
  }
  firstTxMs() {
    const t = this.txs().filter(Core.isEffective);
    return t.length ? t[t.length - 1].t : null;
  }

  // ---------------------------------------------------------------- periods & performance
  periodRange(key, custom) {
    const tz = this.tz, today = Core.localDate(Date.now(), tz), now = Date.now();
    const endOf = (d) => Core.endOfLocalDayMs(d, tz);
    switch (key) {
      case '1D': return { from: endOf(Core.addDays(today, -1)), to: now, label: 'Today' };
      case '7D': return { from: endOf(Core.addDays(today, -7)), to: now, label: '7 days' };
      case '30D': return { from: endOf(Core.addDays(today, -30)), to: now, label: '30 days' };
      case '90D': return { from: endOf(Core.addDays(today, -90)), to: now, label: '90 days' };
      case 'YTD': return { from: endOf((Number(today.slice(0, 4)) - 1) + '-12-31'), to: now, label: 'Year to date' };
      case '1Y': return { from: endOf(Core.addDays(today, -365)), to: now, label: '1 year' };
      case 'CUSTOM': {
        const f = custom?.from || today, t = custom?.to || today;
        return { from: endOf(Core.addDays(f, -1)), to: Math.min(now, endOf(t)), label: Core.formatDateStr(f) + ' – ' + Core.formatDateStr(t) };
      }
      default: return { from: -Infinity, to: now, label: 'All time' };
    }
  }
  /**
   * Flow-adjusted performance for a window. Start and end values are recomputed
   * from the ledger + recorded prices; daily snapshots in between provide the
   * sub-period valuations that time-weighting needs.
   */
  performance(key, custom) {
    const k = 'perf' + key + JSON.stringify(custom || {});
    if (this.memo.has(k)) return this.memo.get(k);
    const { from, to, label } = this.periodRange(key, custom);
    const first = this.firstTxMs();
    let res;
    if (first === null) res = { available: false, note: 'No transactions yet.', label };
    else {
      const startT = from === -Infinity || from < first ? first - 1 : from;
      const startV = startT < first ? 0 : this.stateAt(startT).summary.netWorth;
      const endV = to >= Date.now() - 1000 ? this.live.summary.netWorth : this.stateAt(to).summary.netWorth;
      const mid = Core.snapshotSeries(this.snapshots(), this.tz).filter((p) => p.t > startT && p.t < to - 1);
      const pts = [{ t: startT, value: startV }, ...mid, { t: to, value: endV }];
      res = Core.performance(pts, this.live.events, startT, to, this.setting('performance_method', 'TWR'));
      res.label = label; res.snapshotPoints = mid.length;
      res.partial = from !== -Infinity && from < first;
      if (res.partial) res.note = 'Tracking began ' + Core.formatDate(first, this.tz) + '; measured from then.';
      if (res.available && mid.length === 0 && (to - startT) > 2 * 864e5) res.note = (res.note ? res.note + ' ' : '') + 'No daily snapshots in this window, so the return % is a single-period estimate.';
    }
    this.memo.set(k, res);
    return res;
  }
}

export const store = new Store();
