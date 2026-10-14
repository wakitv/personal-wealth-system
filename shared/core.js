/**
 * Personal Wealth OS — shared financial core.
 *
 * ONE implementation of every financial calculation, used unchanged by:
 *   - the browser frontend   (loaded as a classic <script>, global `WealthCore`)
 *   - the Apps Script backend (copied to backend/Core.gs by `npm run build`)
 *   - the Node test suite     (module.exports)
 *
 * Design rules
 *   1. The transaction ledger is the only source of truth. Balances, holdings,
 *      cost basis and P&L are always *derived* by replaying the ledger.
 *   2. Amounts on a ledger row are positive; the transaction type decides the
 *      sign. The one exception is RECONCILE, whose gross_amount is signed.
 *   3. Native amounts are in the account's currency. `fx_rate` converts one unit
 *      of that currency into the base currency (PHP) at transaction time.
 *   4. Nothing is valued without a recorded price or FX rate. Gaps are reported
 *      as data-quality issues, never filled with invented numbers.
 *
 * No `import`/`export`, no DOM, no Apps Script APIs: plain ES5-compatible JS.
 */
var WealthCore = (function () {
  'use strict';

  var VERSION = '1.0.0';
  var BASE_DEFAULT = 'PHP';
  var TZ_DEFAULT = 'Asia/Manila';
  var QTY_DP = 8;
  var EPS = 1e-9;

  // ---------------------------------------------------------------- enums
  var ACCOUNT_TYPES = ['EXCHANGE', 'WALLET', 'BANK', 'EWALLET', 'CASH', 'BROKERAGE', 'LIABILITY', 'OTHER'];
  var ACCOUNT_TYPE_LABELS = {
    EXCHANGE: 'Crypto exchange', WALLET: 'Self-custody wallet', BANK: 'Bank account',
    EWALLET: 'E-wallet', CASH: 'Cash', BROKERAGE: 'Brokerage', LIABILITY: 'Loan / credit (liability)', OTHER: 'Other'
  };
  var ASSET_CLASSES = ['CRYPTO', 'STOCK', 'OTHER'];
  var OTHER_CATEGORIES = ['BUSINESS', 'PROPERTY', 'METALS', 'EQUIPMENT', 'PRIVATE', 'CUSTOM'];
  var CASH_TX_TYPES = ['OPENING_BALANCE', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'INCOME', 'RECONCILE'];
  var ASSET_TX_TYPES = ['BUY', 'SELL', 'ADD_POSITION', 'REDUCE_POSITION'];
  var TX_TYPES = CASH_TX_TYPES.concat(ASSET_TX_TYPES, ['TRANSFER_OUT', 'TRANSFER_IN', 'ASSET_TRANSFER_OUT', 'ASSET_TRANSFER_IN', 'REVERSAL']);
  var TX_LABELS = {
    OPENING_BALANCE: 'Opening balance', DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal', FEE: 'Fee',
    INCOME: 'Income', RECONCILE: 'Balance adjustment', BUY: 'Buy', SELL: 'Sell',
    ADD_POSITION: 'Add position', REDUCE_POSITION: 'Reduce position', TRANSFER_OUT: 'Transfer out',
    TRANSFER_IN: 'Transfer in', ASSET_TRANSFER_OUT: 'Asset transfer out', ASSET_TRANSFER_IN: 'Asset transfer in',
    REVERSAL: 'Reversal'
  };
  var ALLOCATION_BUCKETS = ['CASH', 'CRYPTO', 'STOCK', 'BUSINESS', 'PROPERTY', 'OTHER'];

  var CURRENCY_DECIMALS = { PHP: 2, USD: 2, EUR: 2, GBP: 2, SGD: 2, AUD: 2, CAD: 2, HKD: 2, JPY: 0, KRW: 0, USDT: 6, USDC: 6, BTC: 8, ETH: 8 };

  // ---------------------------------------------------------------- numbers
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = Number(String(v).replace(/[, ]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function round(x, dp) {
    if (!isFinite(x)) return 0;
    var f = Math.pow(10, dp);
    var r = Math.round(Number((x * f).toPrecision(15))) / f;
    return r === 0 ? 0 : r; // normalise -0
  }
  function decimals(cur) {
    var d = CURRENCY_DECIMALS[String(cur || '').toUpperCase()];
    return d === undefined ? 2 : d;
  }
  function money(x, cur) { return round(x, decimals(cur)); }
  function base2(x) { return round(x, 2); }
  function qty(x) { return round(x, QTY_DP); }

  // ---------------------------------------------------------------- dates / time zones
  var fmtCache = {};
  function partsInTz(ms, tz) {
    var key = tz || TZ_DEFAULT;
    try {
      var f = fmtCache[key] || (fmtCache[key] = new Intl.DateTimeFormat('en-US', {
        timeZone: key, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }));
      var p = {};
      f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
    } catch (e) {
      var t = new Date(ms + 8 * 3600e3); // Asia/Manila has no DST: fixed +08:00 fallback
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
    }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toMs(v) {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    var t = Date.parse(v);
    return isNaN(t) ? NaN : t;
  }
  /** YYYY-MM-DD of an instant in the given time zone. */
  function localDate(v, tz) {
    var p = partsInTz(toMs(v), tz);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }
  function tzOffsetMs(utcMs, tz) {
    var p = partsInTz(utcMs, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000;
  }
  /** UTC ms for a local wall-clock time in tz. */
  function localToUtcMs(dateStr, timeStr, tz) {
    var d = String(dateStr).split('-').map(Number);
    var t = String(timeStr || '00:00:00').split(':').map(Number);
    var guess = Date.UTC(d[0], d[1] - 1, d[2], t[0] || 0, t[1] || 0, t[2] || 0);
    var off = tzOffsetMs(guess, tz);
    var res = guess - off;
    var off2 = tzOffsetMs(res, tz); // second pass for DST edges
    return off2 === off ? res : guess - off2;
  }
  function endOfLocalDayMs(dateStr, tz) { return localToUtcMs(dateStr, '23:59:59', tz) + 999; }
  function startOfLocalDayMs(dateStr, tz) { return localToUtcMs(dateStr, '00:00:00', tz); }
  function addDays(dateStr, n) {
    var d = String(dateStr).split('-').map(Number);
    var t = new Date(Date.UTC(d[0], d[1] - 1, d[2] + n));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }
  function daysBetween(a, b) {
    var x = a.split('-').map(Number), y = b.split('-').map(Number);
    return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 864e5);
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** DD MMM YYYY */
  function formatDate(v, tz) {
    var ms = toMs(v);
    if (isNaN(ms)) return '';
    var p = partsInTz(ms, tz);
    return pad(p.d) + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
  }
  function formatDateTime(v, tz) {
    var ms = toMs(v);
    if (isNaN(ms)) return '';
    var p = partsInTz(ms, tz);
    return pad(p.d) + ' ' + MONTHS[p.m - 1] + ' ' + p.y + ' ' + pad(p.h) + ':' + pad(p.mi);
  }
  function formatDateStr(dateStr) {
    var d = String(dateStr).split('-').map(Number);
    if (d.length < 3 || !d[0]) return String(dateStr || '');
    return pad(d[2]) + ' ' + MONTHS[d[1] - 1] + ' ' + d[0];
  }
  function monthKey(dateStr) { return String(dateStr).slice(0, 7); }

  // ---------------------------------------------------------------- normalisation
  function normTx(r, i) {
    return {
      tx_id: String(r.tx_id || ''), request_id: String(r.request_id || ''), type: String(r.type || ''),
      occurred_at: String(r.occurred_at || ''), t: toMs(r.occurred_at),
      account_id: String(r.account_id || ''), counter_account_id: String(r.counter_account_id || ''),
      asset_id: String(r.asset_id || ''), quantity: num(r.quantity), unit_price: num(r.unit_price),
      gross_amount: num(r.gross_amount), fee: num(r.fee), net_amount: num(r.net_amount),
      currency: String(r.currency || ''), fx_rate: num(r.fx_rate) || 0, base_amount: num(r.base_amount),
      link_id: String(r.link_id || ''), category: String(r.category || ''), reference_no: String(r.reference_no || ''),
      attachment: String(r.attachment || ''), remarks: String(r.remarks || ''), status: String(r.status || 'POSTED'),
      reversal_of: String(r.reversal_of || ''), reversed_by: String(r.reversed_by || ''), replaces: String(r.replaces || ''),
      created_at: String(r.created_at || ''), updated_at: String(r.updated_at || ''), created_by: String(r.created_by || ''),
      seq: r.seq !== undefined && r.seq !== '' ? num(r.seq) : i
    };
  }
  function isEffective(tx) { return tx.status !== 'REVERSED' && tx.type !== 'REVERSAL'; }
  function sortTx(list) {
    return list.slice().sort(function (a, b) { return (a.t - b.t) || (a.seq - b.seq); });
  }
  function settingsMap(rows) {
    if (!rows) return {};
    if (!Array.isArray(rows)) return rows;
    var m = {};
    rows.forEach(function (r) { m[r.key] = r.value; });
    return m;
  }
  function baseCurrency(data) {
    var s = settingsMap(data && data.settings);
    return String(s.base_currency || BASE_DEFAULT).toUpperCase();
  }
  function settingNum(data, key, dflt) {
    var s = settingsMap(data && data.settings);
    var v = s[key];
    return v === undefined || v === '' ? dflt : num(v);
  }
  function settingJson(data, key, dflt) {
    var s = settingsMap(data && data.settings);
    var v = s[key];
    if (v === undefined || v === '') return dflt;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (e) { return dflt; }
  }

  // ---------------------------------------------------------------- price & FX lookup
  /** Build lookup tables of price and FX observations (recorded + implied by trades/transactions). */
  function buildMarket(data, base) {
    var prices = {}; // asset_id -> [{t, price, currency, source, is_estimate}]
    var fx = {};     // currency -> [{t, rate, source}]
    function push(map, k, o) { (map[k] = map[k] || []).push(o); }
    (data.prices || []).forEach(function (p) {
      var t = toMs(p.as_of);
      if (!p.asset_id || isNaN(t) || !(num(p.price) > 0)) return;
      push(prices, p.asset_id, { t: t, price: num(p.price), currency: String(p.currency || base).toUpperCase(), source: p.source || 'MANUAL', is_estimate: p.is_estimate === true || p.is_estimate === 'TRUE' || p.is_estimate === 'true' });
    });
    (data.fx || []).forEach(function (r) {
      var t = toMs(r.as_of);
      if (!r.currency || isNaN(t) || !(num(r.rate) > 0)) return;
      push(fx, String(r.currency).toUpperCase(), { t: t, rate: num(r.rate), source: r.source || 'MANUAL' });
    });
    (data.transactions || []).forEach(function (raw, i) {
      var tx = normTx(raw, i);
      if (!isEffective(tx) || isNaN(tx.t)) return;
      var cur = tx.currency.toUpperCase();
      var fxMeaningful = tx.type.indexOf('ASSET_TRANSFER') !== 0;
      if (fxMeaningful && cur && cur !== base && tx.fx_rate > 0) push(fx, cur, { t: tx.t, rate: tx.fx_rate, source: 'TRANSACTION' });
      if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.unit_price > 0 && tx.asset_id) {
        push(prices, tx.asset_id, { t: tx.t, price: tx.unit_price, currency: cur || base, source: 'LAST_TRADE', is_estimate: false });
      }
    });
    // At equal timestamps an explicitly recorded price/rate wins over one implied by a trade.
    function rank(o) { return o.source === 'LAST_TRADE' || o.source === 'TRANSACTION' ? 0 : 1; }
    function cmp(a, b) { return (a.t - b.t) || (rank(a) - rank(b)); }
    Object.keys(prices).forEach(function (k) { prices[k].sort(cmp); });
    Object.keys(fx).forEach(function (k) { fx[k].sort(cmp); });
    return { prices: prices, fx: fx, base: base };
  }
  function latestAt(list, asOf) {
    if (!list) return null;
    var best = null;
    for (var i = 0; i < list.length; i++) { if (list[i].t <= asOf) best = list[i]; else break; }
    return best;
  }
  function fxAt(market, currency, asOf) {
    var cur = String(currency || '').toUpperCase();
    if (!cur || cur === market.base) return { rate: 1, t: asOf, source: 'BASE' };
    return latestAt(market.fx[cur], asOf);
  }

  // ---------------------------------------------------------------- ledger engine
  /**
   * Replay the ledger up to `asOf` and value everything.
   * @param data { accounts, assets, transactions, prices, fx, settings }
   * @param opts { asOf: ms|ISO (default now), tz, staleDays }
   */
  function computeState(data, opts) {
    opts = opts || {};
    var base = baseCurrency(data);
    var tz = opts.tz || settingsMap(data.settings).timezone || TZ_DEFAULT;
    var asOf = opts.asOf === undefined ? Date.now() : toMs(opts.asOf);
    var staleDays = opts.staleDays !== undefined ? opts.staleDays : settingNum(data, 'stale_price_days', 3);

    var accounts = {};
    (data.accounts || []).forEach(function (a) { accounts[a.account_id] = a; });
    var assets = {};
    (data.assets || []).forEach(function (a) { assets[a.asset_id] = a; });

    var txs = sortTx((data.transactions || []).map(normTx).filter(function (t) { return isEffective(t) && !isNaN(t.t) && t.t <= asOf; }));

    var cash = {};      // account_id -> native balance
    var holdings = {};  // account_id|asset_id -> {qty, costNative, costBase}
    var realizedByAsset = {}, incomeByAsset = {}, feesByAsset = {};
    var events = [];    // per-transaction base-currency effects
    var violations = [];
    var pendingMoves = {}; // link_id -> {qty, costNative, costBase}
    var totals = { flows: 0, deposits: 0, withdrawals: 0, opening: 0, positionsIn: 0, positionsOut: 0, reconcileFlow: 0, realized: 0, realizedGross: 0, income: 0, fees: 0, transfers: 0 };

    function H(acc, asset) {
      var k = acc + '|' + asset;
      return holdings[k] || (holdings[k] = { account_id: acc, asset_id: asset, qty: 0, costNative: 0, costBase: 0 });
    }
    function addCash(acc, amt, cur) { cash[acc] = money((cash[acc] || 0) + amt, cur); }
    function isLiability(accId) { var a = accounts[accId]; return a && a.type === 'LIABILITY'; }
    function removeAtAvg(h, q) {
      var frac = h.qty > EPS ? Math.min(1, q / h.qty) : 0;
      var cN = h.costNative * frac, cB = h.costBase * frac;
      h.qty = qty(h.qty - q); h.costNative -= cN; h.costBase -= cB;
      if (Math.abs(h.qty) < EPS) { h.qty = 0; h.costNative = 0; h.costBase = 0; }
      return { costNative: cN, costBase: cB };
    }
    function bump(map, k, v) { if (k) map[k] = (map[k] || 0) + v; }

    txs.forEach(function (tx) {
      var fx = tx.fx_rate > 0 ? tx.fx_rate : (tx.currency.toUpperCase() === base ? 1 : 0);
      var g = tx.gross_amount, f = tx.fee, q = tx.quantity, p = tx.unit_price, cur = tx.currency;
      var ev = { tx_id: tx.tx_id, t: tx.t, type: tx.type, account_id: tx.account_id, asset_id: tx.asset_id, flow: 0, income: 0, fee: 0, realized: 0, realizedGross: 0, transfer: 0, missingFx: fx === 0 };
      var h, rem;
      switch (tx.type) {
        case 'OPENING_BALANCE':
          addCash(tx.account_id, g, cur); ev.flow = g * fx; totals.opening += ev.flow; break;
        case 'DEPOSIT':
          addCash(tx.account_id, g - f, cur); ev.flow = g * fx; ev.fee = f * fx; totals.deposits += ev.flow; break;
        case 'WITHDRAWAL':
          addCash(tx.account_id, -(g + f), cur); ev.flow = -g * fx; ev.fee = f * fx; totals.withdrawals += g * fx; break;
        case 'FEE':
          addCash(tx.account_id, -g, cur); ev.fee = g * fx; bump(feesByAsset, tx.asset_id, ev.fee); break;
        case 'INCOME':
          if (tx.asset_id && q > 0) { // in-kind (e.g. staking reward): adds units at fair value
            h = H(tx.account_id, tx.asset_id); h.qty = qty(h.qty + q); h.costNative += g; h.costBase += g * fx;
          } else { addCash(tx.account_id, g - f, cur); ev.fee = f * fx; }
          ev.income = g * fx; bump(incomeByAsset, tx.asset_id, ev.income); break;
        case 'RECONCILE':
          addCash(tx.account_id, g, cur);
          if (tx.category !== 'NON_FLOW') { ev.flow = g * fx; totals.reconcileFlow += ev.flow; }
          break;
        case 'TRANSFER_OUT':
          addCash(tx.account_id, -(g + f), cur); ev.fee = f * fx; ev.transfer = g * fx; totals.transfers += g * fx; break;
        case 'TRANSFER_IN':
          addCash(tx.account_id, g, cur); break;
        case 'BUY':
          var cost = q * p + f;
          addCash(tx.account_id, -cost, cur);
          h = H(tx.account_id, tx.asset_id); h.qty = qty(h.qty + q); h.costNative += cost; h.costBase += cost * fx;
          ev.fee = f * fx; bump(feesByAsset, tx.asset_id, ev.fee); break;
        case 'SELL':
          h = H(tx.account_id, tx.asset_id);
          if (q > h.qty + EPS) violations.push({ tx_id: tx.tx_id, kind: 'QUANTITY', account_id: tx.account_id, asset_id: tx.asset_id, at: tx.occurred_at, available: h.qty, required: q });
          rem = removeAtAvg(h, q);
          var proceeds = q * p - f;
          addCash(tx.account_id, proceeds, cur);
          ev.realized = proceeds * fx - rem.costBase; ev.realizedGross = q * p * fx - rem.costBase; ev.fee = f * fx;
          bump(realizedByAsset, tx.asset_id, ev.realized); bump(feesByAsset, tx.asset_id, ev.fee); break;
        case 'ADD_POSITION':
          h = H(tx.account_id, tx.asset_id); h.qty = qty(h.qty + q); h.costNative += g; h.costBase += g * fx;
          ev.flow = (p > 0 ? q * p : g) * fx; totals.positionsIn += ev.flow; break;
        case 'REDUCE_POSITION':
          h = H(tx.account_id, tx.asset_id);
          if (q > h.qty + EPS) violations.push({ tx_id: tx.tx_id, kind: 'QUANTITY', account_id: tx.account_id, asset_id: tx.asset_id, at: tx.occurred_at, available: h.qty, required: q });
          rem = removeAtAvg(h, q);
          if (tx.category === 'LOSS') { ev.realized = -rem.costBase; bump(realizedByAsset, tx.asset_id, ev.realized); }
          else { ev.flow = -(p > 0 ? q * p * fx : rem.costBase); totals.positionsOut += -ev.flow; }
          break;
        case 'ASSET_TRANSFER_OUT':
          h = H(tx.account_id, tx.asset_id);
          if (q > h.qty + EPS) violations.push({ tx_id: tx.tx_id, kind: 'QUANTITY', account_id: tx.account_id, asset_id: tx.asset_id, at: tx.occurred_at, available: h.qty, required: q });
          var avgB = h.qty > EPS ? h.costBase / h.qty : 0;
          rem = removeAtAvg(h, q);
          pendingMoves[tx.link_id] = rem;
          ev.fee = f * avgB; // network fee in units, valued at cost (informational; already capitalised)
          break;
        case 'ASSET_TRANSFER_IN':
          var mv = pendingMoves[tx.link_id] || { costNative: 0, costBase: 0 };
          delete pendingMoves[tx.link_id];
          h = H(tx.account_id, tx.asset_id); h.qty = qty(h.qty + q); h.costNative += mv.costNative; h.costBase += mv.costBase;
          break;
      }
      if (tx.account_id && cash[tx.account_id] < -EPS && !isLiability(tx.account_id) && tx.type !== 'ASSET_TRANSFER_IN' && tx.type !== 'ADD_POSITION') {
        violations.push({ tx_id: tx.tx_id, kind: 'CASH', account_id: tx.account_id, at: tx.occurred_at, balance: cash[tx.account_id] });
      }
      totals.flows += ev.flow; totals.realized += ev.realized; totals.realizedGross += ev.realizedGross;
      totals.income += ev.income; totals.fees += ev.fee;
      events.push(ev);
    });

    // ---- valuation
    var market = buildMarket(data, base);
    var quality = { missingFx: [], missingPrice: [], stalePrice: [], estimates: [] };
    var staleMs = staleDays * 864e5;
    var accountViews = {};
    Object.keys(accounts).forEach(function (id) {
      accountViews[id] = { account_id: id, cashNative: 0, cashBase: 0, holdingsBase: 0, totalBase: 0, fxMissing: false, holdings: [] };
    });
    var totalsV = { cashPositive: 0, liabilities: 0, crypto: 0, stock: 0, other: 0, costBasis: 0, unrealized: 0 };
    var buckets = {}; ALLOCATION_BUCKETS.forEach(function (b) { buckets[b] = 0; });

    Object.keys(cash).forEach(function (accId) {
      var acc = accounts[accId] || { currency: base };
      var v = accountViews[accId] || (accountViews[accId] = { account_id: accId, cashNative: 0, cashBase: 0, holdingsBase: 0, totalBase: 0, fxMissing: false, holdings: [] });
      v.cashNative = cash[accId];
      if (Math.abs(cash[accId]) < EPS) return;
      var r = fxAt(market, acc.currency, asOf);
      if (!r) { v.fxMissing = true; quality.missingFx.push({ account_id: accId, currency: acc.currency }); return; }
      v.fxRate = r.rate; v.fxAsOf = r.t;
      v.cashBase = base2(cash[accId] * r.rate);
      if (v.cashBase >= 0) { totalsV.cashPositive += v.cashBase; buckets.CASH += v.cashBase; }
      else totalsV.liabilities += -v.cashBase;
    });

    var positions = [];
    Object.keys(holdings).forEach(function (k) {
      var h = holdings[k];
      if (Math.abs(h.qty) < EPS) return;
      var asset = assets[h.asset_id] || { asset_id: h.asset_id, name: h.asset_id, asset_class: 'OTHER' };
      var pr = latestAt(market.prices[h.asset_id], asOf);
      var pos = {
        account_id: h.account_id, asset_id: h.asset_id, asset_class: asset.asset_class || 'OTHER', category: asset.category || '',
        qty: h.qty, costNative: h.costNative, costBase: base2(h.costBase), avgCostBase: h.qty ? h.costBase / h.qty : 0,
        price: null, priceCurrency: null, priceAsOf: null, priceSource: null, isEstimate: false, valuedAtCost: false, stale: false,
        valueBase: 0, unrealizedBase: 0
      };
      var priced = false;
      if (pr) {
        var r = fxAt(market, pr.currency, asOf);
        if (r) {
          pos.price = pr.price; pos.priceCurrency = pr.currency; pos.priceAsOf = pr.t; pos.priceSource = pr.source; pos.isEstimate = pr.is_estimate;
          pos.valueBase = base2(h.qty * pr.price * r.rate);
          pos.stale = asOf - pr.t > staleMs && asOf !== Infinity;
          priced = true;
          if (pos.stale) quality.stalePrice.push({ asset_id: h.asset_id, account_id: h.account_id, asOf: pr.t });
          if (pos.isEstimate) quality.estimates.push({ asset_id: h.asset_id });
        } else quality.missingFx.push({ asset_id: h.asset_id, currency: pr.currency });
      }
      if (!priced) { // never invent a price: fall back to recorded cost basis and flag it
        pos.valueBase = base2(h.costBase); pos.valuedAtCost = true;
        quality.missingPrice.push({ asset_id: h.asset_id, account_id: h.account_id });
      }
      pos.unrealizedBase = base2(pos.valueBase - h.costBase);
      positions.push(pos);
      var cls = pos.asset_class;
      if (cls === 'CRYPTO') { totalsV.crypto += pos.valueBase; buckets.CRYPTO += pos.valueBase; }
      else if (cls === 'STOCK') { totalsV.stock += pos.valueBase; buckets.STOCK += pos.valueBase; }
      else {
        totalsV.other += pos.valueBase;
        var b = asset.category === 'BUSINESS' ? 'BUSINESS' : asset.category === 'PROPERTY' ? 'PROPERTY' : 'OTHER';
        buckets[b] += pos.valueBase;
      }
      totalsV.costBasis += h.costBase; totalsV.unrealized += pos.unrealizedBase;
      var av = accountViews[h.account_id];
      if (av) { av.holdingsBase += pos.valueBase; av.holdings.push(pos); }
    });
    Object.keys(accountViews).forEach(function (id) {
      var v = accountViews[id];
      v.holdingsBase = base2(v.holdingsBase); v.totalBase = base2(v.cashBase + v.holdingsBase);
    });

    var investment = base2(totalsV.crypto + totalsV.stock + totalsV.other);
    var totalAssets = base2(totalsV.cashPositive + investment);
    var liabilities = base2(totalsV.liabilities);
    Object.keys(buckets).forEach(function (b) { buckets[b] = base2(buckets[b]); });

    return {
      base: base, tz: tz, asOf: asOf,
      summary: {
        netWorth: base2(totalAssets - liabilities), totalAssets: totalAssets, liabilities: liabilities,
        cash: base2(totalsV.cashPositive), investment: investment,
        crypto: base2(totalsV.crypto), stock: base2(totalsV.stock), other: base2(totalsV.other),
        costBasis: base2(totalsV.costBasis), unrealized: base2(totalsV.unrealized),
        realized: base2(totals.realized), realizedGross: base2(totals.realizedGross),
        income: base2(totals.income), fees: base2(totals.fees),
        netFlows: base2(totals.flows), deposits: base2(totals.deposits), withdrawals: base2(totals.withdrawals),
        opening: base2(totals.opening), positionsIn: base2(totals.positionsIn), positionsOut: base2(totals.positionsOut),
        reconcileFlow: base2(totals.reconcileFlow), transfers: base2(totals.transfers)
      },
      allocation: buckets,
      accounts: accountViews,
      positions: positions,
      byAsset: aggregateByAsset(positions, assets, realizedByAsset, incomeByAsset, feesByAsset),
      events: events,
      violations: violations,
      quality: quality,
      cashNative: cash
    };
  }

  function aggregateByAsset(positions, assets, realized, income, fees) {
    var m = {};
    function get(id) {
      var a = assets[id] || {};
      return m[id] || (m[id] = { asset_id: id, name: a.name || id, ticker: a.ticker || '', asset_class: a.asset_class || 'OTHER', category: a.category || '', qty: 0, costBase: 0, valueBase: 0, unrealizedBase: 0, realizedBase: 0, incomeBase: 0, feesBase: 0, price: null, priceCurrency: null, priceAsOf: null, priceSource: null, isEstimate: false, valuedAtCost: false, stale: false, locations: [] });
    }
    positions.forEach(function (p) {
      var a = get(p.asset_id);
      a.qty = qty(a.qty + p.qty); a.costBase += p.costBase; a.valueBase += p.valueBase; a.unrealizedBase += p.unrealizedBase;
      if (p.price !== null && (a.priceAsOf === null || p.priceAsOf > a.priceAsOf)) { a.price = p.price; a.priceCurrency = p.priceCurrency; a.priceAsOf = p.priceAsOf; a.priceSource = p.priceSource; a.isEstimate = p.isEstimate; }
      a.valuedAtCost = a.valuedAtCost || p.valuedAtCost; a.stale = a.stale || p.stale;
      a.locations.push({ account_id: p.account_id, qty: p.qty, valueBase: p.valueBase });
    });
    Object.keys(realized).forEach(function (id) { get(id).realizedBase += realized[id]; });
    Object.keys(income).forEach(function (id) { get(id).incomeBase += income[id]; });
    Object.keys(fees).forEach(function (id) { get(id).feesBase += fees[id]; });
    return Object.keys(m).map(function (id) {
      var a = m[id];
      a.costBase = base2(a.costBase); a.valueBase = base2(a.valueBase); a.unrealizedBase = base2(a.unrealizedBase);
      a.realizedBase = base2(a.realizedBase); a.incomeBase = base2(a.incomeBase); a.feesBase = base2(a.feesBase);
      a.avgCostBase = a.qty > EPS ? a.costBase / a.qty : 0;
      a.returnPct = a.costBase > EPS ? (a.unrealizedBase / a.costBase) * 100 : null;
      return a;
    });
  }

  /** Ledger violations newly introduced by a candidate dataset (used for validation). */
  function newViolations(before, after) {
    var seen = {};
    before.violations.forEach(function (v) { seen[v.kind + v.tx_id + v.account_id] = 1; });
    return after.violations.filter(function (v) { return !seen[v.kind + v.tx_id + v.account_id]; });
  }

  // ---------------------------------------------------------------- flows & period aggregation
  /** Sum event effects with fromMs < t <= toMs. */
  function sumEvents(events, fromMs, toMsV) {
    var s = { flows: 0, deposits: 0, withdrawals: 0, opening: 0, positions: 0, reconcile: 0, income: 0, fees: 0, realized: 0, transfers: 0, count: 0 };
    events.forEach(function (e) {
      if (!(e.t > fromMs && e.t <= toMsV)) return;
      s.count++;
      s.flows += e.flow; s.income += e.income; s.fees += e.fee; s.realized += e.realized; s.transfers += e.transfer;
      if (e.type === 'DEPOSIT') s.deposits += e.flow;
      else if (e.type === 'WITHDRAWAL') s.withdrawals += -e.flow;
      else if (e.type === 'OPENING_BALANCE') s.opening += e.flow;
      else if (e.type === 'ADD_POSITION' || e.type === 'REDUCE_POSITION') s.positions += e.flow;
      else if (e.type === 'RECONCILE') s.reconcile += e.flow;
    });
    Object.keys(s).forEach(function (k) { if (k !== 'count') s[k] = base2(s[k]); });
    return s;
  }

  /** Monthly cash-flow buckets (YYYY-MM in tz). */
  function monthlyFlows(events, tz) {
    var m = {};
    events.forEach(function (e) {
      var k = monthKey(localDate(e.t, tz));
      var b = m[k] || (m[k] = { month: k, deposits: 0, withdrawals: 0, netFlows: 0, income: 0, fees: 0, realized: 0, transfers: 0 });
      if (e.type === 'DEPOSIT') b.deposits += e.flow;
      if (e.type === 'WITHDRAWAL') b.withdrawals += -e.flow;
      b.netFlows += e.flow; b.income += e.income; b.fees += e.fee; b.realized += e.realized; b.transfers += e.transfer;
    });
    return Object.keys(m).sort().map(function (k) {
      var b = m[k]; Object.keys(b).forEach(function (f) { if (f !== 'month') b[f] = base2(b[f]); }); return b;
    });
  }

  // ---------------------------------------------------------------- performance
  /**
   * Flow-adjusted performance between two instants from a valuation series.
   *
   * valuations: [{t (ms), value (base)}] — daily snapshots, optionally plus a live point.
   * events:     ledger events (from computeState) providing external flows.
   *
   * Methods
   *  TWR  — time-weighted return, chain-linked across consecutive valuations:
   *         r_i = (V_i − F_i) / V_{i−1} − 1 with flows assumed at end of sub-period.
   *  MODIFIED_DIETZ — gain / (V_0 + Σ w_k F_k), w_k = fraction of period remaining.
   * Absolute gain (both): V_end − V_start − net external flows. Deposits are never profit.
   */
  function performance(valuations, events, fromMs, toMsV, method) {
    method = method || 'TWR';
    var pts = valuations.filter(function (v) { return isFinite(v.value) && v.t <= toMsV; }).sort(function (a, b) { return a.t - b.t; });
    var res = { method: method, available: false, startValue: null, endValue: null, netFlows: 0, gain: null, returnPct: null, startT: null, endT: null, partial: false, points: 0, note: '' };
    if (pts.length < 2) { res.note = 'Not enough valuation history yet.'; return res; }
    var startIdx = -1;
    for (var i = 0; i < pts.length; i++) { if (pts[i].t <= fromMs) startIdx = i; }
    if (startIdx === -1) { startIdx = 0; res.partial = true; res.note = 'History starts after the requested period start; measured from the first available valuation.'; }
    var endIdx = pts.length - 1;
    if (endIdx <= startIdx) { res.note = 'Not enough valuation history in this period.'; return res; }
    var s = pts[startIdx], e = pts[endIdx];
    var flows = sumEvents(events, s.t, e.t).flows;
    res.available = true; res.startValue = base2(s.value); res.endValue = base2(e.value); res.netFlows = flows;
    res.gain = base2(e.value - s.value - flows); res.startT = s.t; res.endT = e.t; res.points = endIdx - startIdx + 1;

    if (method === 'MODIFIED_DIETZ') {
      var span = e.t - s.t, weighted = 0;
      events.forEach(function (ev) { if (ev.flow && ev.t > s.t && ev.t <= e.t) weighted += ev.flow * ((e.t - ev.t) / span); });
      var denom = s.value + weighted;
      res.returnPct = denom > EPS ? round((res.gain / denom) * 100, 4) : null;
    } else {
      var growth = 1, linked = 0;
      for (var j = startIdx + 1; j <= endIdx; j++) {
        var a = pts[j - 1], b = pts[j];
        var f = sumEvents(events, a.t, b.t).flows;
        if (a.value > EPS) { growth *= (b.value - f) / a.value; linked++; }
        // a.value <= 0: no capital at risk in this sub-period; it contributes no return.
      }
      res.returnPct = linked ? round((growth - 1) * 100, 4) : null;
    }
    if (res.returnPct === null && !res.note) res.note = 'Return % undefined: no invested capital at period start.';
    return res;
  }

  // ---------------------------------------------------------------- snapshots
  function buildSnapshot(data, dateStr, tz, computedAt) {
    tz = tz || settingsMap(data.settings).timezone || TZ_DEFAULT;
    var end = endOfLocalDayMs(dateStr, tz);
    var st = computeState(data, { asOf: end, tz: tz });
    var dayFlows = sumEvents(st.events, startOfLocalDayMs(dateStr, tz) - 1, end);
    var fxUsed = {};
    Object.keys(st.accounts).forEach(function (id) { var a = st.accounts[id]; if (a.fxRate && a.fxRate !== 1) fxUsed[(findAccount(data, id) || {}).currency || id] = a.fxRate; });
    var oldest = null;
    st.positions.forEach(function (p) { if (p.priceAsOf && (oldest === null || p.priceAsOf < oldest)) oldest = p.priceAsOf; });
    return {
      snapshot_date: dateStr, net_worth: st.summary.netWorth, total_assets: st.summary.totalAssets, total_liabilities: st.summary.liabilities,
      cash_value: st.summary.cash, crypto_value: st.summary.crypto, stock_value: st.summary.stock, other_value: st.summary.other,
      investment_value: st.summary.investment, cost_basis: st.summary.costBasis, unrealized_pl: st.summary.unrealized,
      realized_pl_cum: st.summary.realized, income_cum: st.summary.income, fees_cum: st.summary.fees,
      net_flow_day: dayFlows.flows, net_flows_cum: st.summary.netFlows, base_currency: st.base,
      fx_json: JSON.stringify(fxUsed),
      quality_json: JSON.stringify({ missingPrice: st.quality.missingPrice.length, stalePrice: st.quality.stalePrice.length, missingFx: st.quality.missingFx.length, estimates: st.quality.estimates.length, oldestPrice: oldest ? new Date(oldest).toISOString() : null }),
      tx_count: st.events.length, computed_at: computedAt || new Date().toISOString()
    };
  }
  function findAccount(data, id) {
    var a = data.accounts || [];
    for (var i = 0; i < a.length; i++) if (a[i].account_id === id) return a[i];
    return null;
  }
  /** Valuation series from snapshots (+ optional live point). */
  function snapshotSeries(snapshots, tz, field) {
    field = field || 'net_worth';
    return (snapshots || []).map(function (s) {
      return { t: endOfLocalDayMs(String(s.snapshot_date).slice(0, 10), tz), date: String(s.snapshot_date).slice(0, 10), value: num(s[field]) };
    }).sort(function (a, b) { return a.t - b.t; });
  }

  // ---------------------------------------------------------------- integrity
  function checkIntegrity(data) {
    var issues = [];
    var ids = {}, reqs = {}, links = {};
    var accIds = {}; (data.accounts || []).forEach(function (a) { accIds[a.account_id] = a; });
    var assetIds = {}; (data.assets || []).forEach(function (a) { assetIds[a.asset_id] = a; });
    var txs = (data.transactions || []).map(normTx);
    var byId = {}; txs.forEach(function (t) { byId[t.tx_id] = t; });
    txs.forEach(function (t) {
      if (ids[t.tx_id]) issues.push({ level: 'error', code: 'DUPLICATE_TX_ID', tx_id: t.tx_id, message: 'Duplicate transaction ID ' + t.tx_id });
      ids[t.tx_id] = 1;
      if (t.request_id) {
        var rk = t.request_id + '|' + t.type + '|' + t.account_id + '|' + t.seq;
        reqs[t.request_id] = (reqs[t.request_id] || 0) + 1; void rk;
      }
      if (t.account_id && !accIds[t.account_id]) issues.push({ level: 'error', code: 'UNKNOWN_ACCOUNT', tx_id: t.tx_id, message: 'Transaction references unknown account ' + t.account_id });
      if (t.asset_id && !assetIds[t.asset_id]) issues.push({ level: 'error', code: 'UNKNOWN_ASSET', tx_id: t.tx_id, message: 'Transaction references unknown asset ' + t.asset_id });
      if (isNaN(t.t)) issues.push({ level: 'error', code: 'BAD_DATE', tx_id: t.tx_id, message: 'Unparseable date on ' + t.tx_id });
      if (t.type !== 'REVERSAL' && t.type.indexOf('ASSET_TRANSFER') !== 0 && t.status !== 'REVERSED' && t.currency.toUpperCase() !== baseCurrency(data) && !(t.fx_rate > 0)) issues.push({ level: 'warn', code: 'MISSING_FX', tx_id: t.tx_id, message: 'No FX rate on ' + t.tx_id });
      if (t.link_id && t.type.indexOf('TRANSFER') >= 0 && isEffective(t)) (links[t.link_id] = links[t.link_id] || []).push(t.type);
      if (t.type === 'REVERSAL' && !byId[t.reversal_of]) issues.push({ level: 'error', code: 'ORPHAN_REVERSAL', tx_id: t.tx_id, message: 'Reversal references missing transaction ' + t.reversal_of });
      if (t.status === 'REVERSED' && !t.reversed_by) issues.push({ level: 'warn', code: 'REVERSED_NO_REF', tx_id: t.tx_id, message: 'Reversed transaction without reversal reference ' + t.tx_id });
    });
    Object.keys(links).forEach(function (l) {
      var types = links[l].sort().join(',');
      if (types !== 'TRANSFER_IN,TRANSFER_OUT' && types !== 'ASSET_TRANSFER_IN,ASSET_TRANSFER_OUT') issues.push({ level: 'error', code: 'BROKEN_TRANSFER', link_id: l, message: 'Transfer ' + l + ' does not have exactly one outgoing and one incoming leg (' + types + ')' });
    });
    var st = computeState(data, { asOf: Infinity });
    st.violations.forEach(function (v) {
      issues.push({ level: 'error', code: v.kind === 'CASH' ? 'NEGATIVE_BALANCE' : 'NEGATIVE_QUANTITY', tx_id: v.tx_id, message: (v.kind === 'CASH' ? 'Balance below zero on ' : 'Quantity below zero on ') + v.account_id + ' after ' + v.tx_id });
    });
    // Reconciliation identity: net worth = cash + holdings − liabilities, with no double counting.
    var s = st.summary;
    var acctSum = 0; Object.keys(st.accounts).forEach(function (id) { acctSum += st.accounts[id].totalBase; });
    var unassigned = 0; st.positions.forEach(function (p) { if (!st.accounts[p.account_id]) unassigned += p.valueBase; });
    var identity = { netWorth: s.netWorth, accountsPlusUnassigned: base2(acctSum + unassigned), cashPlusInvestmentMinusLiabilities: base2(s.cash + s.investment - s.liabilities) };
    var fxGap = st.quality.missingFx.length > 0;
    if (!fxGap && Math.abs(identity.netWorth - identity.accountsPlusUnassigned) > 0.011) issues.push({ level: 'error', code: 'RECONCILE_MISMATCH', message: 'Account totals do not reconcile with net worth' });
    if (Math.abs(identity.netWorth - identity.cashPlusInvestmentMinusLiabilities) > 0.011) issues.push({ level: 'error', code: 'RECONCILE_MISMATCH', message: 'Category totals do not reconcile with net worth' });
    return { ok: issues.filter(function (i) { return i.level === 'error'; }).length === 0, issues: issues, identity: identity, txCount: txs.length };
  }

  // ---------------------------------------------------------------- planning
  function monthlyRate(annualPct) { return Math.pow(1 + num(annualPct) / 100, 1 / 12) - 1; }
  /** Future value after n months: PV(1+r)^n + PMT·((1+r)^n − 1)/r, contributions at month end. */
  function futureValue(pv, pmt, annualPct, months) {
    var r = monthlyRate(annualPct), n = Math.max(0, Math.round(months));
    if (Math.abs(r) < 1e-12) return base2(pv + pmt * n);
    var g = Math.pow(1 + r, n);
    return base2(pv * g + pmt * (g - 1) / r);
  }
  /** Months until target is reached (null if not within maxMonths). Simulated month by month. */
  function monthsToTarget(pv, pmt, annualPct, target, maxMonths) {
    maxMonths = maxMonths || 1200;
    if (pv >= target) return 0;
    var r = monthlyRate(annualPct), v = pv;
    for (var m = 1; m <= maxMonths; m++) { v = v * (1 + r) + pmt; if (v >= target - 0.005) return m; }
    return null;
  }
  /** Monthly contribution required to reach target in n months. */
  function requiredMonthly(pv, target, annualPct, months) {
    var n = Math.max(1, Math.round(months)), r = monthlyRate(annualPct);
    if (Math.abs(r) < 1e-12) return base2(Math.max(0, (target - pv) / n));
    var g = Math.pow(1 + r, n);
    return base2(Math.max(0, (target - pv * g) * r / (g - 1)));
  }
  function inflationAdjusted(target, inflationPct, years) { return base2(target * Math.pow(1 + num(inflationPct) / 100, Math.max(0, years))); }
  function projectionSeries(pv, pmt, annualPct, months) {
    var r = monthlyRate(annualPct), v = pv, out = [base2(pv)];
    for (var m = 1; m <= months; m++) { v = v * (1 + r) + pmt; out.push(base2(v)); }
    return out;
  }
  function monthsBetweenDates(fromStr, toStr) {
    var a = fromStr.split('-').map(Number), b = toStr.split('-').map(Number);
    return (b[0] - a[0]) * 12 + (b[1] - a[1]) + ((b[2] || 1) >= (a[2] || 1) ? 0 : -1);
  }
  function addMonths(dateStr, n) {
    var d = dateStr.split('-').map(Number);
    var t = new Date(Date.UTC(d[0], d[1] - 1 + n, Math.min(d[2], 28)));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }
  /** Value that counts toward a goal, by basis. */
  function goalBasisValue(summary, basis) {
    switch (basis) {
      case 'INVESTMENTS': return summary.investment;
      case 'CASH': return summary.cash;
      case 'LIQUID': return base2(summary.cash + summary.crypto + summary.stock);
      default: return summary.netWorth;
    }
  }
  function evaluateGoal(goal, summary, todayStr) {
    var target = num(goal.target_amount), current = goalBasisValue(summary, goal.basis || 'NET_WORTH');
    var pmt = num(goal.monthly_contribution), ret = num(goal.expected_return);
    var start = num(goal.starting_amount);
    var monthsLeft = goal.target_date ? Math.max(0, monthsBetweenDates(todayStr, String(goal.target_date).slice(0, 10))) : null;
    // Progress is measured against the full target; growth since the goal's starting amount is reported separately.
    var progress = target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0;
    var n = monthsToTarget(current, pmt, ret, target);
    var projectedDate = n === null ? null : addMonths(todayStr, n);
    var required = monthsLeft ? requiredMonthly(current, target, ret, monthsLeft) : null;
    var status = current >= target ? 'ACHIEVED' : (goal.target_date && projectedDate && projectedDate > String(goal.target_date).slice(0, 10)) || (goal.target_date && n === null) ? 'BEHIND' : 'ON_TRACK';
    if (!goal.target_date && current < target) status = n === null ? 'NO_PROJECTION' : 'ON_TRACK';
    return {
      current: base2(current), remaining: base2(Math.max(0, target - current)), progressPct: round(progress, 2), sinceStart: base2(current - start),
      monthsLeft: monthsLeft, monthsToTarget: n, projectedDate: projectedDate, requiredMonthly: required, status: status
    };
  }

  // ---------------------------------------------------------------- allocation & risk
  function allocationVsTarget(allocation, targets) {
    var total = 0; Object.keys(allocation).forEach(function (k) { total += allocation[k]; });
    return ALLOCATION_BUCKETS.map(function (k) {
      var cur = total > 0 ? allocation[k] / total * 100 : 0, tgt = num((targets || {})[k]);
      return { bucket: k, value: allocation[k], currentPct: round(cur, 2), targetPct: tgt, driftPct: round(cur - tgt, 2) };
    });
  }
  function concentration(byAsset, totalAssets, thresholdPct) {
    return byAsset.filter(function (a) { return totalAssets > 0 && a.valueBase / totalAssets * 100 > thresholdPct; })
      .map(function (a) { return { asset_id: a.asset_id, name: a.name, pct: round(a.valueBase / totalAssets * 100, 2) }; });
  }
  function emergencyFund(state, accounts, monthlyExpenses, targetMonths, accountIds) {
    var liquidTypes = { BANK: 1, EWALLET: 1, CASH: 1 };
    var sel = accountIds && accountIds.length ? accountIds : (accounts || []).filter(function (a) { return liquidTypes[a.type] && a.status !== 'ARCHIVED'; }).map(function (a) { return a.account_id; });
    var total = 0;
    sel.forEach(function (id) { var v = state.accounts[id]; if (v && v.cashBase > 0) total += v.cashBase; });
    var target = num(monthlyExpenses) * num(targetMonths);
    return { accounts: sel, reserve: base2(total), target: base2(target), monthsCovered: num(monthlyExpenses) > 0 ? round(total / num(monthlyExpenses), 1) : null, progressPct: target > 0 ? round(Math.min(100, total / target * 100), 1) : 0, shortfall: base2(Math.max(0, target - total)) };
  }

  // ---------------------------------------------------------------- export helpers
  /** Neutralise spreadsheet formula injection in user-entered text. Numbers pass through. */
  function sanitizeCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    var s = String(v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function toCsv(rows, columns) {
    function q(v) {
      v = sanitizeCell(v);
      var s = String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [columns.map(function (c) { return q(c.label || c.key); }).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return q(typeof c.value === 'function' ? c.value(r) : r[c.key]); }).join(',')); });
    return '﻿' + lines.join('\r\n');
  }
  function maskRef(ref) {
    var s = String(ref || '').replace(/\s/g, '');
    if (!s) return '';
    if (s.length <= 4) return '••••';
    return '•••• ' + s.slice(-4);
  }

  return {
    VERSION: VERSION, ACCOUNT_TYPES: ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS: ACCOUNT_TYPE_LABELS, ASSET_CLASSES: ASSET_CLASSES,
    OTHER_CATEGORIES: OTHER_CATEGORIES, TX_TYPES: TX_TYPES, TX_LABELS: TX_LABELS, CASH_TX_TYPES: CASH_TX_TYPES,
    ASSET_TX_TYPES: ASSET_TX_TYPES, ALLOCATION_BUCKETS: ALLOCATION_BUCKETS, TZ_DEFAULT: TZ_DEFAULT, BASE_DEFAULT: BASE_DEFAULT,
    num: num, round: round, money: money, base2: base2, qty: qty, decimals: decimals,
    toMs: toMs, localDate: localDate, localToUtcMs: localToUtcMs, endOfLocalDayMs: endOfLocalDayMs, startOfLocalDayMs: startOfLocalDayMs,
    addDays: addDays, daysBetween: daysBetween, formatDate: formatDate, formatDateTime: formatDateTime, formatDateStr: formatDateStr, monthKey: monthKey,
    normTx: normTx, isEffective: isEffective, sortTx: sortTx, settingsMap: settingsMap, baseCurrency: baseCurrency, settingNum: settingNum, settingJson: settingJson,
    buildMarket: buildMarket, fxAt: fxAt, computeState: computeState, newViolations: newViolations,
    sumEvents: sumEvents, monthlyFlows: monthlyFlows, performance: performance,
    buildSnapshot: buildSnapshot, snapshotSeries: snapshotSeries, checkIntegrity: checkIntegrity,
    monthlyRate: monthlyRate, futureValue: futureValue, monthsToTarget: monthsToTarget, requiredMonthly: requiredMonthly,
    inflationAdjusted: inflationAdjusted, projectionSeries: projectionSeries, monthsBetweenDates: monthsBetweenDates, addMonths: addMonths,
    goalBasisValue: goalBasisValue, evaluateGoal: evaluateGoal,
    allocationVsTarget: allocationVsTarget, concentration: concentration, emergencyFund: emergencyFund,
    sanitizeCell: sanitizeCell, toCsv: toCsv, maskRef: maskRef
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WealthCore;
