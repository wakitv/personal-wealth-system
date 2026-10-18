// GENERATED from shared/service.js by scripts/build.js — edit the source, then run `npm run build`.
/**
 * Personal Wealth OS — API service layer.
 *
 * All request handling, validation, authorisation, idempotency and audit logic.
 * Storage, locking, clock, ID generation, token verification and HTTP are
 * injected (`deps`), so the identical code runs in:
 *   - Google Apps Script (backend/Service.gs, with SheetStore + LockService)
 *   - the browser sandbox (MemoryStore persisted to localStorage)
 *   - Node tests (MemoryStore + fakes)
 *
 * Depends on the global WealthCore (shared/core.js).
 */
function createWealthService(Core) {
  'use strict';

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------------ schema
  // Column types: s = string, n = number, b = boolean, j = JSON text
  var SCHEMA = {
    Settings: { key: 'key', cols: [['key', 's'], ['value', 's'], ['updated_at', 's']] },
    Accounts: { key: 'account_id', cols: [['account_id', 's'], ['name', 's'], ['type', 's'], ['institution', 's'], ['reference', 's'], ['currency', 's'], ['notes', 's'], ['status', 's'], ['created_at', 's'], ['updated_at', 's']] },
    Assets: { key: 'asset_id', cols: [['asset_id', 's'], ['name', 's'], ['ticker', 's'], ['asset_class', 's'], ['category', 's'], ['exchange', 's'], ['network', 's'], ['currency', 's'], ['unit_label', 's'], ['price_source', 's'], ['price_source_id', 's'], ['notes', 's'], ['status', 's'], ['created_at', 's'], ['updated_at', 's']] },
    Transactions: { key: 'tx_id', cols: [['tx_id', 's'], ['seq', 'n'], ['request_id', 's'], ['type', 's'], ['occurred_at', 's'], ['account_id', 's'], ['counter_account_id', 's'], ['asset_id', 's'], ['quantity', 'n'], ['unit_price', 'n'], ['gross_amount', 'n'], ['fee', 'n'], ['net_amount', 'n'], ['currency', 's'], ['fx_rate', 'n'], ['base_amount', 'n'], ['link_id', 's'], ['category', 's'], ['reference_no', 's'], ['attachment', 's'], ['remarks', 's'], ['status', 's'], ['reversal_of', 's'], ['reversed_by', 's'], ['replaces', 's'], ['created_at', 's'], ['updated_at', 's'], ['created_by', 's']] },
    PriceHistory: { key: 'price_id', cols: [['price_id', 's'], ['asset_id', 's'], ['price', 'n'], ['currency', 's'], ['as_of', 's'], ['source', 's'], ['is_estimate', 'b'], ['notes', 's'], ['created_at', 's']] },
    FXRates: { key: 'fx_id', cols: [['fx_id', 's'], ['currency', 's'], ['rate', 'n'], ['as_of', 's'], ['source', 's'], ['created_at', 's']] },
    DailySnapshots: { key: 'snapshot_date', cols: [['snapshot_date', 's'], ['net_worth', 'n'], ['total_assets', 'n'], ['total_liabilities', 'n'], ['cash_value', 'n'], ['crypto_value', 'n'], ['stock_value', 'n'], ['other_value', 'n'], ['investment_value', 'n'], ['cost_basis', 'n'], ['unrealized_pl', 'n'], ['realized_pl_cum', 'n'], ['income_cum', 'n'], ['fees_cum', 'n'], ['net_flow_day', 'n'], ['net_flows_cum', 'n'], ['base_currency', 's'], ['fx_json', 's'], ['quality_json', 's'], ['tx_count', 'n'], ['computed_at', 's']] },
    Goals: { key: 'goal_id', cols: [['goal_id', 's'], ['name', 's'], ['target_amount', 'n'], ['basis', 's'], ['starting_amount', 'n'], ['start_date', 's'], ['target_date', 's'], ['monthly_contribution', 'n'], ['expected_return', 'n'], ['priority', 'n'], ['status', 's'], ['notes', 's'], ['created_at', 's'], ['updated_at', 's']] },
    AuditLog: { key: 'audit_id', cols: [['audit_id', 's'], ['at', 's'], ['actor', 's'], ['action', 's'], ['entity', 's'], ['entity_id', 's'], ['request_id', 's'], ['before_json', 's'], ['after_json', 's']] },
    Requests: { key: 'request_id', cols: [['request_id', 's'], ['action', 's'], ['actor', 's'], ['at', 's'], ['result_json', 's']] }
  };
  var SHEETS = Object.keys(SCHEMA);

  var DEFAULT_SETTINGS = {
    base_currency: 'PHP', timezone: 'Asia/Manila', date_format: 'DD MMM YYYY', theme: 'dark', default_period: '30D',
    performance_method: 'TWR', reconcile_default: 'FLOW', stale_price_days: '3', concentration_threshold: '25',
    allocation_targets: '{"CASH":15,"CRYPTO":25,"STOCK":30,"BUSINESS":15,"PROPERTY":10,"OTHER":5}',
    scenario_returns: '{"conservative":4,"base":8,"optimistic":12}', inflation_rate: '4',
    emergency_monthly_expenses: '0', emergency_target_months: '6', emergency_accounts: '[]',
    price_auto_refresh: 'false', price_refresh_on_open: 'true', coingecko_fx_ids: '{"USDT":"tether","USDC":"usd-coin"}',
    mask_references: 'true'
  };
  var SETTING_RULES = {
    base_currency: /^[A-Z]{3,5}$/, timezone: /^[A-Za-z_]+\/[A-Za-z_\/+-]+$|^UTC$/, date_format: /^DD MMM YYYY$/,
    theme: /^(dark|light)$/, default_period: /^(1D|7D|30D|90D|YTD|1Y|ALL)$/, performance_method: /^(TWR|MODIFIED_DIETZ)$/,
    reconcile_default: /^(FLOW|NON_FLOW)$/, stale_price_days: /^\d{1,3}$/, concentration_threshold: /^\d{1,3}(\.\d+)?$/,
    allocation_targets: 'json', scenario_returns: 'json', inflation_rate: /^-?\d{1,2}(\.\d+)?$/,
    emergency_monthly_expenses: /^\d{1,12}(\.\d{1,2})?$/, emergency_target_months: /^\d{1,3}$/, emergency_accounts: 'json',
    price_auto_refresh: /^(true|false)$/, price_refresh_on_open: /^(true|false)$/, coingecko_fx_ids: 'json', mask_references: /^(true|false)$/
  };

  // ------------------------------------------------------------------ errors / responses
  function ApiError(code, message, details) { this.name = 'ApiError'; this.code = code; this.message = message; this.details = details || null; }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;
  function fail(code, message, details) { throw new ApiError(code, message, details); }

  // ------------------------------------------------------------------ validation helpers
  var MAX_AMOUNT = 1e13;
  function str(v, field, opts) {
    opts = opts || {};
    var s = v === undefined || v === null ? '' : String(v).trim();
    if (opts.required && !s) fail('VALIDATION', field + ' is required', { field: field });
    if (s.length > (opts.max || 500)) fail('VALIDATION', field + ' is too long', { field: field });
    if (s && opts.pattern && !opts.pattern.test(s)) fail('VALIDATION', field + ' has an invalid format', { field: field });
    return s;
  }
  function oneOf(v, list, field) {
    var s = String(v || '').trim().toUpperCase();
    if (list.indexOf(s) < 0) fail('VALIDATION', field + ' must be one of ' + list.join(', '), { field: field });
    return s;
  }
  function amount(v, field, opts) {
    opts = opts || {};
    if ((v === undefined || v === null || v === '') && !opts.required) return 0;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    if (!isFinite(n)) fail('VALIDATION', field + ' must be a number', { field: field });
    if (opts.allowNegative ? Math.abs(n) > MAX_AMOUNT : (n < 0 || n > MAX_AMOUNT)) fail('VALIDATION', field + ' is out of range', { field: field });
    if (opts.positive && !(n > 0)) fail('VALIDATION', field + ' must be greater than zero', { field: field });
    return n;
  }
  function isoTime(v, field, now) {
    var s = str(v, field, { required: true, max: 40 });
    var t = Date.parse(s);
    if (isNaN(t)) fail('VALIDATION', field + ' is not a valid date/time', { field: field });
    if (t > now + 864e5) fail('VALIDATION', field + ' cannot be more than one day in the future', { field: field });
    if (t < Date.UTC(1970, 0, 1)) fail('VALIDATION', field + ' is too far in the past', { field: field });
    return new Date(t).toISOString();
  }
  function currencyCode(v, field) { return str(v, field, { required: true, max: 6, pattern: /^[A-Z0-9]{3,6}$/ }).toUpperCase(); }
  function bool(v) { return v === true || v === 'true' || v === 'TRUE' || v === 1; }

  // ------------------------------------------------------------------ context helpers
  function makeCtx(deps, actor, requestId) {
    var cache = {};
    var ctx = {
      deps: deps, actor: actor, requestId: requestId || '',
      nowMs: deps.now(), nowIso: new Date(deps.now()).toISOString(),
      read: function (sheet) { return cache[sheet] || (cache[sheet] = deps.store.read(sheet)); },
      invalidate: function (sheet) { delete cache[sheet]; },
      id: function (prefix) { return prefix + '-' + deps.uuid().replace(/-/g, '').slice(0, 20).toUpperCase(); },
      audit: function (action, entity, entityId, before, after) {
        deps.store.append('AuditLog', [{ audit_id: ctx.id('AUD'), at: ctx.nowIso, actor: actor || '', action: action, entity: entity, entity_id: entityId, request_id: ctx.requestId, before_json: before ? JSON.stringify(before) : '', after_json: after ? JSON.stringify(after) : '' }]);
      }
    };
    return ctx;
  }
  function settings(ctx) {
    var m = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { m[k] = DEFAULT_SETTINGS[k]; });
    ctx.read('Settings').forEach(function (r) { if (r.key) m[r.key] = r.value; });
    return m;
  }
  function data(ctx) {
    return {
      accounts: ctx.read('Accounts'), assets: ctx.read('Assets'), transactions: ctx.read('Transactions'),
      prices: ctx.read('PriceHistory'), fx: ctx.read('FXRates'), settings: settings(ctx)
    };
  }
  function findBy(rows, key, id) { for (var i = 0; i < rows.length; i++) if (rows[i][key] === id) return rows[i]; return null; }
  function getAccount(ctx, id, needActive) {
    var a = findBy(ctx.read('Accounts'), 'account_id', String(id || ''));
    if (!a) fail('NOT_FOUND', 'Account not found', { account_id: id });
    if (needActive && a.status === 'ARCHIVED') fail('VALIDATION', 'Account "' + a.name + '" is archived');
    return a;
  }
  function getAsset(ctx, id, needActive, allowRemoved) {
    var a = findBy(ctx.read('Assets'), 'asset_id', String(id || ''));
    if (!a || (a.status === 'REMOVED' && !allowRemoved)) fail('NOT_FOUND', 'Asset not found', { asset_id: id });
    if (needActive && a.status === 'ARCHIVED') fail('VALIDATION', 'Asset "' + a.name + '" is archived');
    return a;
  }
  function checkVersion(row, expected) {
    if (expected !== undefined && expected !== null && expected !== '' && String(row.updated_at) !== String(expected)) {
      fail('CONFLICT', 'This record was changed elsewhere. Reload and try again.', { current_updated_at: row.updated_at });
    }
  }
  function fxFor(ctx, currency, provided, field) {
    var base = settings(ctx).base_currency;
    if (currency === base) return 1;
    var r = amount(provided, field || 'fx_rate', {});
    if (!(r > 0)) fail('VALIDATION', 'An FX rate to ' + base + ' is required for ' + currency + ' amounts', { field: field || 'fx_rate' });
    return r;
  }

  // ------------------------------------------------------------------ ledger writes
  function nextSeq(ctx) {
    var rows = ctx.read('Transactions'), m = 0;
    rows.forEach(function (r) { if (Core.num(r.seq) > m) m = Core.num(r.seq); });
    return m + 1;
  }
  function baseTx(ctx, fields) {
    var row = {};
    SCHEMA.Transactions.cols.forEach(function (c) { row[c[0]] = c[1] === 'n' ? 0 : ''; });
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
    row.status = row.status || 'POSTED';
    row.request_id = ctx.requestId; row.created_at = ctx.nowIso; row.updated_at = ctx.nowIso; row.created_by = ctx.actor || '';
    return row;
  }
  function finishAmounts(row) {
    var cur = row.currency;
    row.gross_amount = Core.money(row.gross_amount, cur);
    row.fee = row.type === 'ASSET_TRANSFER_OUT' ? Core.qty(row.fee) : Core.money(row.fee, cur);
    row.quantity = Core.qty(row.quantity);
    var t = row.type, g = row.gross_amount, f = row.fee;
    row.net_amount = t === 'DEPOSIT' || (t === 'INCOME' && !row.quantity) ? Core.money(g - f, cur)
      : t === 'WITHDRAWAL' || t === 'TRANSFER_OUT' ? Core.money(g + f, cur)
      : t === 'BUY' ? Core.money(g + f, cur) : t === 'SELL' ? Core.money(g - f, cur) : g;
    row.base_amount = Core.base2(g * (row.fx_rate || 0));
    return row;
  }
  /**
   * Validate candidate rows against the whole ledger, then append.
   * `reverseIds` are tx_ids that will be marked REVERSED in the same commit.
   */
  function commitLedger(ctx, newRows, reverseIds) {
    reverseIds = reverseIds || [];
    var d = data(ctx);
    var existing = d.transactions;
    var ids = {}; existing.forEach(function (r) { ids[r.tx_id] = 1; });
    newRows.forEach(function (r) { if (ids[r.tx_id]) fail('CONFLICT', 'Duplicate transaction ID'); ids[r.tx_id] = 1; });
    var seq = nextSeq(ctx);
    newRows.forEach(function (r) { r.seq = seq++; finishAmounts(r); });

    var rev = {}; reverseIds.forEach(function (id) { rev[id] = 1; });
    var candidate = existing.map(function (r) { if (!rev[r.tx_id]) return r; var c = {}; Object.keys(r).forEach(function (k) { c[k] = r[k]; }); c.status = 'REVERSED'; return c; }).concat(newRows);
    var before = Core.computeState(d, { asOf: Infinity });
    var dd = {}; Object.keys(d).forEach(function (k) { dd[k] = d[k]; }); dd.transactions = candidate;
    var after = Core.computeState(dd, { asOf: Infinity });
    var bad = Core.newViolations(before, after);
    if (bad.length) {
      var v = bad[0];
      var acc = findBy(d.accounts, 'account_id', v.account_id) || { name: v.account_id };
      if (v.kind === 'CASH') fail('INSUFFICIENT_FUNDS', 'Insufficient funds in "' + acc.name + '": this would take the balance below zero (' + Core.formatDate(v.at) + ').', v);
      var asset = findBy(d.assets, 'asset_id', v.asset_id) || { name: v.asset_id };
      fail('INSUFFICIENT_QUANTITY', 'Not enough ' + asset.name + ' in "' + acc.name + '" (available ' + Core.qty(v.available) + ', needed ' + Core.qty(v.required) + ').', v);
    }
    if (newRows.length) ctx.deps.store.append('Transactions', newRows);
    ctx.invalidate('Transactions');
    return newRows;
  }

  function buildCashTx(ctx, p, type) {
    var acc = getAccount(ctx, p.account_id, true);
    var occurred = isoTime(p.occurred_at, 'occurred_at', ctx.nowMs);
    var cur = acc.currency;
    if (p.currency && String(p.currency).toUpperCase() !== cur) fail('VALIDATION', 'Amounts must be entered in the account currency (' + cur + ')', { field: 'currency' });
    var fx = fxFor(ctx, cur, p.fx_rate);
    var row = baseTx(ctx, {
      tx_id: ctx.id('TX'), type: type, occurred_at: occurred, account_id: acc.account_id, currency: cur, fx_rate: fx,
      reference_no: str(p.reference_no, 'reference_no', { max: 120 }), attachment: str(p.attachment, 'attachment', { max: 500 }),
      remarks: str(p.remarks, 'remarks', { max: 1000 })
    });
    if (type === 'RECONCILE') {
      // Two input forms: a signed delta, or the actual statement balance to reconcile to.
      var target = p.actual_balance !== undefined && p.actual_balance !== '' ? amount(p.actual_balance, 'actual_balance', { allowNegative: true }) : null;
      var delta;
      if (target !== null) {
        var st = Core.computeState(data(ctx), { asOf: Date.parse(occurred) });
        delta = Core.money(target - (st.cashNative[acc.account_id] || 0), cur);
      } else delta = amount(p.gross_amount, 'gross_amount', { allowNegative: true });
      if (!delta) fail('VALIDATION', 'Recorded balance already matches; no adjustment needed');
      row.gross_amount = delta;
      row.category = p.category ? oneOf(p.category, ['FLOW', 'NON_FLOW'], 'category') : settings(ctx).reconcile_default;
    } else {
      row.gross_amount = amount(p.gross_amount, 'gross_amount', { required: true, positive: true });
      row.fee = amount(p.fee, 'fee');
      if (type === 'OPENING_BALANCE' && acc.type === 'LIABILITY' && bool(p.is_debt)) fail('VALIDATION', 'Record debt as a negative balance adjustment');
      if (type === 'INCOME') {
        row.category = p.category ? oneOf(p.category, ['DIVIDEND', 'INTEREST', 'STAKING', 'REWARD', 'RENT', 'OTHER'], 'category') : 'OTHER';
        if (p.asset_id) {
          var asset = getAsset(ctx, p.asset_id, true);
          row.asset_id = asset.asset_id;
          var q = amount(p.quantity, 'quantity');
          if (q > 0) { row.quantity = q; row.fee = 0; }
        }
      }
      if (type === 'FEE') {
        row.category = str(p.category, 'category', { max: 40 }).toUpperCase() || 'OTHER';
        if (p.asset_id) row.asset_id = getAsset(ctx, p.asset_id, false).asset_id;
      }
    }
    return row;
  }

  function buildAssetTx(ctx, p, type) {
    var acc = getAccount(ctx, p.account_id, true);
    var asset = getAsset(ctx, p.asset_id, true);
    var occurred = isoTime(p.occurred_at, 'occurred_at', ctx.nowMs);
    var cur = acc.currency;
    var fx = fxFor(ctx, cur, p.fx_rate);
    var q = amount(p.quantity, 'quantity', { required: true, positive: true });
    var row = baseTx(ctx, {
      tx_id: ctx.id('TX'), type: type, occurred_at: occurred, account_id: acc.account_id, asset_id: asset.asset_id,
      currency: cur, fx_rate: fx, quantity: q, reference_no: str(p.reference_no, 'reference_no', { max: 120 }),
      attachment: str(p.attachment, 'attachment', { max: 500 }), remarks: str(p.remarks, 'remarks', { max: 1000 })
    });
    if (type === 'BUY' || type === 'SELL') {
      row.unit_price = amount(p.unit_price, 'unit_price', { required: true, positive: true });
      row.fee = amount(p.fee, 'fee');
      row.gross_amount = q * row.unit_price;
      if (type === 'SELL' && row.fee > row.gross_amount) fail('VALIDATION', 'Fee cannot exceed sale proceeds');
    } else if (type === 'ADD_POSITION') {
      row.gross_amount = amount(p.gross_amount, 'cost basis', { required: true });
      row.unit_price = amount(p.unit_price, 'unit_price'); // optional market price at time of adding (for flow value)
    } else if (type === 'REDUCE_POSITION') {
      row.unit_price = amount(p.unit_price, 'unit_price');
      row.category = p.category ? oneOf(p.category, ['WITHDRAWN', 'LOSS'], 'category') : 'WITHDRAWN';
    }
    return row;
  }

  // ------------------------------------------------------------------ actions
  var A = {};

  A.health = { auth: false, fn: function (p, ctx) {
    var sheets = {};
    try { SHEETS.forEach(function (s) { sheets[s] = ctx.deps.store.hasSheet ? ctx.deps.store.hasSheet(s) : true; }); } catch (e) { sheets = 'unavailable'; }
    return { status: 'ok', service: 'Personal Wealth OS', apiVersion: API_VERSION, coreVersion: Core.VERSION, time: ctx.nowIso, sheetsReady: sheets };
  } };

  A.whoami = { fn: function (p, ctx) { return { email: ctx.actor }; } };

  A.bootstrap = { fn: function (p, ctx) {
    var s = settings(ctx);
    return {
      settings: s, accounts: ctx.read('Accounts'), assets: ctx.read('Assets'), transactions: ctx.read('Transactions'),
      prices: ctx.read('PriceHistory'), fx: ctx.read('FXRates'), snapshots: ctx.read('DailySnapshots'), goals: ctx.read('Goals'),
      user: { email: ctx.actor }, serverTime: ctx.nowIso, apiVersion: API_VERSION
    };
  } };

  // ---- accounts
  A.createAccount = { write: true, fn: function (p, ctx) {
    var row = {
      account_id: ctx.id('ACC'), name: str(p.name, 'name', { required: true, max: 80 }), type: oneOf(p.type, Core.ACCOUNT_TYPES, 'type'),
      institution: str(p.institution, 'institution', { max: 80 }), reference: str(p.reference, 'reference', { max: 60 }),
      currency: currencyCode(p.currency || settings(ctx).base_currency, 'currency'), notes: str(p.notes, 'notes', { max: 1000 }),
      status: 'ACTIVE', created_at: ctx.nowIso, updated_at: ctx.nowIso
    };
    if (/seed|mnemonic|private key|password/i.test(row.notes)) fail('VALIDATION', 'Never store passwords, seed phrases or private keys here.');
    var ob = amount(p.opening_balance, 'opening_balance', { allowNegative: true });
    if (ob < 0 && row.type !== 'LIABILITY') fail('VALIDATION', 'Only liability accounts can open with a negative balance');
    var obTime = ob ? isoTime(p.opening_date || ctx.nowIso, 'opening_date', ctx.nowMs) : null;
    var obFx = ob ? fxFor(ctx, row.currency, p.opening_fx_rate, 'opening_fx_rate') : 1;
    ctx.deps.store.append('Accounts', [row]); ctx.invalidate('Accounts');
    ctx.audit('CREATE', 'Account', row.account_id, null, row);
    var tx = null;
    if (ob) {
      // Positive opening balance = capital brought under tracking (an external flow, not profit).
      // Negative opening balance on a liability = debt brought under tracking (also a flow).
      var obRow = baseTx(ctx, {
        tx_id: ctx.id('TX'), type: ob > 0 ? 'OPENING_BALANCE' : 'RECONCILE', occurred_at: obTime,
        account_id: row.account_id, currency: row.currency, fx_rate: obFx,
        gross_amount: ob, category: ob > 0 ? '' : 'FLOW', remarks: 'Opening balance'
      });
      tx = commitLedger(ctx, [obRow])[0];
      ctx.audit('POST', 'Transaction', tx.tx_id, null, tx);
    }
    return { account: row, transaction: tx };
  } };

  A.updateAccount = { write: true, fn: function (p, ctx) {
    var acc = getAccount(ctx, p.account_id);
    checkVersion(acc, p.expected_updated_at);
    var before = JSON.parse(JSON.stringify(acc));
    var patch = {};
    if (p.name !== undefined) patch.name = str(p.name, 'name', { required: true, max: 80 });
    if (p.type !== undefined) patch.type = oneOf(p.type, Core.ACCOUNT_TYPES, 'type');
    if (p.institution !== undefined) patch.institution = str(p.institution, 'institution', { max: 80 });
    if (p.reference !== undefined) patch.reference = str(p.reference, 'reference', { max: 60 });
    if (p.notes !== undefined) patch.notes = str(p.notes, 'notes', { max: 1000 });
    if (patch.notes && /seed|mnemonic|private key|password/i.test(patch.notes)) fail('VALIDATION', 'Never store passwords, seed phrases or private keys here.');
    if (p.currency !== undefined && String(p.currency).toUpperCase() !== acc.currency) {
      var used = ctx.read('Transactions').some(function (t) { return t.account_id === acc.account_id; });
      if (used) fail('VALIDATION', 'Currency cannot change after transactions exist. Create a new account instead.');
      patch.currency = currencyCode(p.currency, 'currency');
    }
    if (p.status !== undefined) patch.status = oneOf(p.status, ['ACTIVE', 'ARCHIVED'], 'status');
    patch.updated_at = ctx.nowIso;
    var after = ctx.deps.store.update('Accounts', 'account_id', acc.account_id, patch); ctx.invalidate('Accounts');
    ctx.audit('UPDATE', 'Account', acc.account_id, before, after);
    return { account: after };
  } };

  // ---- assets
  var PRICE_SOURCES = ['MANUAL', 'BINANCE', 'COINGECKO'];
  var MARKET_SOURCES = ['BINANCE', 'COINGECKO'];
  /** Binance symbol (BTCUSDT; a TradingView-style "BINANCE:BTCUSDT" is accepted) or CoinGecko ID (bitcoin). */
  function normalizeSourceId(src, raw) {
    var v = String(raw || '').trim();
    if (src === 'MANUAL') return '';
    if (src === 'BINANCE') {
      v = v.toUpperCase().replace(/^BINANCE:/, '').replace(/[\/\-\s]/g, '');
      if (!/^[A-Z0-9]{5,20}$/.test(v)) fail('VALIDATION', 'Enter the Binance trading pair symbol, e.g. BTCUSDT', { field: 'price_source_id' });
      return v;
    }
    v = v.toLowerCase();
    if (!/^[a-z0-9-]{2,80}$/.test(v)) fail('VALIDATION', 'Enter the CoinGecko ID, e.g. bitcoin', { field: 'price_source_id' });
    return v;
  }
  function assetFields(p, ctx, isNew, existing) {
    var o = {};
    if (isNew || p.name !== undefined) o.name = str(p.name, 'name', { required: true, max: 80 });
    if (isNew || p.ticker !== undefined) o.ticker = str(p.ticker, 'ticker', { max: 20 }).toUpperCase();
    if (isNew) o.asset_class = oneOf(p.asset_class, Core.ASSET_CLASSES, 'asset_class');
    if (isNew || p.category !== undefined) o.category = p.category ? str(p.category, 'category', { max: 40 }).toUpperCase() : '';
    if (isNew || p.exchange !== undefined) o.exchange = str(p.exchange, 'exchange', { max: 40 });
    if (isNew || p.network !== undefined) o.network = str(p.network, 'network', { max: 40 });
    if (isNew || p.currency !== undefined) o.currency = currencyCode(p.currency || settings(ctx).base_currency, 'currency');
    if (isNew || p.unit_label !== undefined) o.unit_label = str(p.unit_label, 'unit_label', { max: 20 });
    if (isNew || p.price_source !== undefined) o.price_source = p.price_source ? oneOf(p.price_source, PRICE_SOURCES, 'price_source') : 'MANUAL';
    if (isNew || p.price_source !== undefined || p.price_source_id !== undefined) {
      var src = o.price_source || (existing && existing.price_source) || 'MANUAL';
      var rawId = p.price_source_id !== undefined ? p.price_source_id : (existing && existing.price_source_id) || '';
      o.price_source_id = normalizeSourceId(src, rawId);
    }
    if (isNew || p.notes !== undefined) o.notes = str(p.notes, 'notes', { max: 1000 });
    if (o.notes && /seed|mnemonic|private key|password/i.test(o.notes)) fail('VALIDATION', 'Never store passwords, seed phrases or private keys here.');
    return o;
  }
  A.createAsset = { write: true, fn: function (p, ctx) {
    var row = assetFields(p, ctx, true);
    row.asset_id = ctx.id('AST'); row.status = 'ACTIVE'; row.created_at = ctx.nowIso; row.updated_at = ctx.nowIso;
    if (row.ticker && row.asset_class !== 'OTHER') {
      var dup = ctx.read('Assets').some(function (a) { return a.ticker === row.ticker && a.asset_class === row.asset_class && a.status === 'ACTIVE' && (a.exchange || '') === (row.exchange || ''); });
      if (dup) fail('CONFLICT', 'An active ' + row.asset_class.toLowerCase() + ' asset with ticker ' + row.ticker + ' already exists');
    }
    ctx.deps.store.append('Assets', [row]); ctx.invalidate('Assets');
    ctx.audit('CREATE', 'Asset', row.asset_id, null, row);
    return { asset: row };
  } };
  A.updateAsset = { write: true, fn: function (p, ctx) {
    var a = getAsset(ctx, p.asset_id);
    checkVersion(a, p.expected_updated_at);
    var before = JSON.parse(JSON.stringify(a));
    var patch = assetFields(p, ctx, false, a);
    if (patch.currency && patch.currency !== a.currency) {
      var priced = ctx.read('PriceHistory').some(function (r) { return r.asset_id === a.asset_id; });
      if (priced) fail('VALIDATION', 'Price currency cannot change after prices are recorded');
    }
    if (p.status !== undefined) patch.status = oneOf(p.status, ['ACTIVE', 'ARCHIVED'], 'status');
    patch.updated_at = ctx.nowIso;
    var after = ctx.deps.store.update('Assets', 'asset_id', a.asset_id, patch); ctx.invalidate('Assets');
    ctx.audit('UPDATE', 'Asset', a.asset_id, before, after);
    return { asset: after };
  } };

  /**
   * Remove an asset. Nothing is deleted:
   *  - no effective transactions → the asset is marked REMOVED (hidden everywhere);
   *  - otherwise, with reverse_history = true, every effective transaction for the asset (and its
   *    linked legs, e.g. the other side of an asset transfer or a purchase's funding deposit) is
   *    reversed in one validated commit, then the asset is marked REMOVED. Purchases return their
   *    cash, sales are undone, income is removed. Refused if that would overdraw any account.
   */
  A.removeAsset = { write: true, fn: function (p, ctx) {
    var a = getAsset(ctx, p.asset_id, false);
    var reason = str(p.reason, 'reason', { required: true, max: 500 });
    var all = ctx.read('Transactions');
    var own = all.filter(function (t) { return t.asset_id === a.asset_id && t.status !== 'REVERSED' && t.type !== 'REVERSAL'; });
    var reversed = [];
    if (own.length) {
      if (!bool(p.reverse_history)) fail('CONFLICT', '"' + a.name + '" has ' + own.length + ' transaction(s). Confirm reversing its history to remove it, or archive it instead to keep the history.', { transactions: own.length });
      var seen = {}, group = [];
      own.forEach(function (t) { groupOf(ctx, t).forEach(function (g) { if (!seen[g.tx_id]) { seen[g.tx_id] = 1; group.push(g); } }); });
      var revRows = reversalRows(ctx, group, 'Asset removed: ' + reason);
      commitLedger(ctx, revRows, group.map(function (t) { return t.tx_id; }));
      applyReversal(ctx, group, revRows);
      reversed = group.map(function (t) { return t.tx_id; });
    }
    var before = JSON.parse(JSON.stringify(a));
    var after = ctx.deps.store.update('Assets', 'asset_id', a.asset_id, { status: 'REMOVED', updated_at: ctx.nowIso });
    ctx.invalidate('Assets');
    ctx.audit('REMOVE', 'Asset', a.asset_id, before, { status: 'REMOVED', reason: reason, reversed: reversed });
    return { asset: after, reversed: reversed };
  } };

  // ---- ledger
  A.postTransaction = { write: true, fn: function (p, ctx) {
    var type = oneOf(p.type, Core.CASH_TX_TYPES.concat(Core.ASSET_TX_TYPES), 'type');
    var rows = buildRows(ctx, type, p);
    var posted = commitLedger(ctx, rows);
    posted.forEach(function (r) { ctx.audit('POST', 'Transaction', r.tx_id, null, r); });
    return { transactions: posted };
  } };
  function buildRows(ctx, type, p) {
    if (Core.CASH_TX_TYPES.indexOf(type) >= 0) return [buildCashTx(ctx, p, type)];
    var row = buildAssetTx(ctx, p, type);
    if (type === 'BUY' && bool(p.fund_externally)) {
      // "Paid from outside the tracked accounts": record the external deposit that funded it, linked.
      var link = ctx.id('LNK');
      var dep = baseTx(ctx, { tx_id: ctx.id('TX'), type: 'DEPOSIT', occurred_at: row.occurred_at, account_id: row.account_id, currency: row.currency, fx_rate: row.fx_rate, gross_amount: row.quantity * row.unit_price + Core.num(row.fee), link_id: link, remarks: 'External funding for purchase' });
      row.link_id = link;
      return [dep, row];
    }
    return [row];
  }

  A.postTransfer = { write: true, fn: function (p, ctx) {
    var from = getAccount(ctx, p.from_account_id, true), to = getAccount(ctx, p.to_account_id, true);
    if (from.account_id === to.account_id) fail('VALIDATION', 'Source and destination must be different accounts');
    var occurred = isoTime(p.occurred_at, 'occurred_at', ctx.nowMs);
    var amt = amount(p.amount, 'amount', { required: true, positive: true });
    var fee = amount(p.fee, 'fee');
    var amtIn = from.currency === to.currency ? (p.amount_in !== undefined && p.amount_in !== '' ? amount(p.amount_in, 'amount_in', { positive: true }) : amt) : amount(p.amount_in, 'amount_in', { required: true, positive: true });
    if (from.currency === to.currency && amtIn > amt + 1e-9) fail('VALIDATION', 'Received amount cannot exceed amount sent for same-currency transfers');
    var link = ctx.id('TRF');
    var remarks = str(p.remarks, 'remarks', { max: 1000 }), refNo = str(p.reference_no, 'reference_no', { max: 120 });
    var out = baseTx(ctx, {
      tx_id: ctx.id('TX'), type: 'TRANSFER_OUT', occurred_at: occurred, link_id: link, remarks: remarks, reference_no: refNo,
      account_id: from.account_id, counter_account_id: to.account_id, currency: from.currency,
      fx_rate: fxFor(ctx, from.currency, p.fx_rate_from, 'fx_rate_from'), gross_amount: amt, fee: fee
    });
    var inn = baseTx(ctx, {
      tx_id: ctx.id('TX'), type: 'TRANSFER_IN', occurred_at: occurred, link_id: link, remarks: remarks, reference_no: refNo,
      account_id: to.account_id, counter_account_id: from.account_id, currency: to.currency,
      fx_rate: fxFor(ctx, to.currency, p.fx_rate_to, 'fx_rate_to'), gross_amount: amtIn
    });
    var posted = commitLedger(ctx, [out, inn]);
    posted.forEach(function (r) { ctx.audit('POST', 'Transaction', r.tx_id, null, r); });
    return { transactions: posted, link_id: link };
  } };

  A.postAssetTransfer = { write: true, fn: function (p, ctx) {
    var from = getAccount(ctx, p.from_account_id, true), to = getAccount(ctx, p.to_account_id, true);
    if (from.account_id === to.account_id) fail('VALIDATION', 'Source and destination must be different accounts');
    var asset = getAsset(ctx, p.asset_id, true);
    var occurred = isoTime(p.occurred_at, 'occurred_at', ctx.nowMs);
    var q = amount(p.quantity, 'quantity', { required: true, positive: true });
    var feeQ = amount(p.fee_quantity, 'fee_quantity');
    if (feeQ >= q) fail('VALIDATION', 'Network fee must be smaller than the quantity sent');
    var link = ctx.id('TRF');
    var out = baseTx(ctx, { tx_id: ctx.id('TX'), type: 'ASSET_TRANSFER_OUT', occurred_at: occurred, account_id: from.account_id, counter_account_id: to.account_id, asset_id: asset.asset_id, quantity: q, fee: feeQ, currency: from.currency, fx_rate: 0, link_id: link, remarks: str(p.remarks, 'remarks', { max: 1000 }), reference_no: str(p.reference_no, 'reference_no', { max: 120 }) });
    var inn = baseTx(ctx, { tx_id: ctx.id('TX'), type: 'ASSET_TRANSFER_IN', occurred_at: occurred, account_id: to.account_id, counter_account_id: from.account_id, asset_id: asset.asset_id, quantity: Core.qty(q - feeQ), currency: to.currency, fx_rate: 0, link_id: link, remarks: out.remarks, reference_no: out.reference_no });
    var posted = commitLedger(ctx, [out, inn]);
    posted.forEach(function (r) { ctx.audit('POST', 'Transaction', r.tx_id, null, r); });
    return { transactions: posted, link_id: link };
  } };

  function groupOf(ctx, tx) {
    var all = ctx.read('Transactions');
    if (!tx.link_id) return [tx];
    return all.filter(function (r) { return r.link_id === tx.link_id && r.status !== 'REVERSED' && r.type !== 'REVERSAL'; });
  }
  function reversalRows(ctx, group, reason) {
    return group.map(function (t) {
      return baseTx(ctx, { tx_id: ctx.id('TX'), type: 'REVERSAL', occurred_at: ctx.nowIso, account_id: t.account_id, asset_id: t.asset_id, currency: t.currency, fx_rate: Core.num(t.fx_rate), gross_amount: 0, reversal_of: t.tx_id, link_id: t.link_id, remarks: reason });
    });
  }
  function applyReversal(ctx, group, revRows) {
    group.forEach(function (t, i) {
      var after = ctx.deps.store.update('Transactions', 'tx_id', t.tx_id, { status: 'REVERSED', reversed_by: revRows[i].tx_id, updated_at: ctx.nowIso });
      ctx.audit('REVERSE', 'Transaction', t.tx_id, t, after);
    });
    ctx.invalidate('Transactions');
  }
  A.reverseTransaction = { write: true, fn: function (p, ctx) {
    var tx = findBy(ctx.read('Transactions'), 'tx_id', String(p.tx_id || ''));
    if (!tx) fail('NOT_FOUND', 'Transaction not found');
    if (tx.type === 'REVERSAL') fail('VALIDATION', 'A reversal entry cannot itself be reversed');
    if (tx.status === 'REVERSED') fail('CONFLICT', 'Transaction is already reversed');
    var reason = str(p.reason, 'reason', { required: true, max: 500 });
    var group = groupOf(ctx, tx);
    var revRows = reversalRows(ctx, group, reason);
    commitLedger(ctx, revRows, group.map(function (t) { return t.tx_id; }));
    applyReversal(ctx, group, revRows);
    return { reversed: group.map(function (t) { return t.tx_id; }), reversals: revRows.map(function (r) { return r.tx_id; }) };
  } };

  /** Edit = reverse the original (and its linked legs) + post a corrected replacement, atomically. */
  A.editTransaction = { write: true, fn: function (p, ctx) {
    var tx = findBy(ctx.read('Transactions'), 'tx_id', String(p.tx_id || ''));
    if (!tx) fail('NOT_FOUND', 'Transaction not found');
    if (tx.status === 'REVERSED' || tx.type === 'REVERSAL') fail('CONFLICT', 'Only posted transactions can be edited');
    if (/TRANSFER/.test(tx.type)) fail('VALIDATION', 'Transfers are edited by reversing and re-entering them');
    checkVersion(tx, p.expected_updated_at);
    var changes = p.changes || {};
    var type = tx.type;
    var merged = {};
    ['account_id', 'asset_id', 'occurred_at', 'quantity', 'unit_price', 'gross_amount', 'fee', 'fx_rate', 'category', 'reference_no', 'attachment', 'remarks'].forEach(function (k) {
      merged[k] = changes[k] !== undefined ? changes[k] : tx[k];
    });
    var group = groupOf(ctx, tx);
    if (tx.link_id && type !== 'BUY') fail('VALIDATION', 'This entry is linked to a purchase. Edit the purchase instead.');
    // An externally funded purchase keeps its linked funding deposit in step with the corrected amount.
    merged.fund_externally = type === 'BUY' && group.some(function (g) { return g.type === 'DEPOSIT'; });
    var replacement = buildRows(ctx, type, merged);
    replacement.forEach(function (r) { r.replaces = tx.tx_id; });
    var revRows = reversalRows(ctx, group, 'Edited: ' + (str(p.reason, 'reason', { max: 400 }) || 'correction'));
    commitLedger(ctx, revRows.concat(replacement), group.map(function (t) { return t.tx_id; }));
    applyReversal(ctx, group, revRows);
    replacement.forEach(function (r) { ctx.audit('POST', 'Transaction', r.tx_id, null, r); });
    return { reversed: group.map(function (t) { return t.tx_id; }), transactions: replacement };
  } };

  // ---- prices, valuations & FX
  A.addPrice = { write: true, fn: function (p, ctx) {
    var asset = getAsset(ctx, p.asset_id);
    var row = {
      price_id: ctx.id('PRC'), asset_id: asset.asset_id, price: amount(p.price, 'price', { required: true, positive: true }),
      currency: currencyCode(p.currency || asset.currency, 'currency'), as_of: isoTime(p.as_of || ctx.nowIso, 'as_of', ctx.nowMs),
      source: p.source === 'VALUATION' ? 'VALUATION' : 'MANUAL', is_estimate: bool(p.is_estimate) || p.source === 'VALUATION',
      notes: str(p.notes, 'notes', { max: 500 }), created_at: ctx.nowIso
    };
    if (row.currency !== asset.currency) fail('VALIDATION', 'Price must be in the asset currency (' + asset.currency + ')');
    ctx.deps.store.append('PriceHistory', [row]); ctx.invalidate('PriceHistory');
    ctx.audit('CREATE', 'Price', row.price_id, null, row);
    return { price: row };
  } };
  /** Valuation of a whole position (e.g. a business stake): stored as a per-unit estimate. */
  A.updateValuation = { write: true, fn: function (p, ctx) {
    var asset = getAsset(ctx, p.asset_id);
    var total = amount(p.total_value, 'total_value', { required: true, positive: true });
    var st = Core.computeState(data(ctx), { asOf: Infinity });
    var held = 0; st.positions.forEach(function (x) { if (x.asset_id === asset.asset_id) held += x.qty; });
    if (!(held > 0)) fail('VALIDATION', 'Record the position first (Add position), then update its valuation');
    return A.addPrice.fn({ asset_id: asset.asset_id, price: total / held, currency: asset.currency, as_of: p.as_of, source: 'VALUATION', is_estimate: true, notes: str(p.valuation_source, 'valuation_source', { max: 200 }) + (p.notes ? ' — ' + p.notes : '') }, ctx);
  } };
  A.addFxRate = { write: true, fn: function (p, ctx) {
    var base = settings(ctx).base_currency;
    var cur = currencyCode(p.currency, 'currency');
    if (cur === base) fail('VALIDATION', 'The base currency always has a rate of 1');
    var row = { fx_id: ctx.id('FX'), currency: cur, rate: amount(p.rate, 'rate', { required: true, positive: true }), as_of: isoTime(p.as_of || ctx.nowIso, 'as_of', ctx.nowMs), source: str(p.source, 'source', { max: 40 }) || 'MANUAL', created_at: ctx.nowIso };
    ctx.deps.store.append('FXRates', [row]); ctx.invalidate('FXRates');
    ctx.audit('CREATE', 'FXRate', row.fx_id, null, row);
    return { fx: row };
  } };
  /** Server-side price fetch (CoinGecko public API). Read-only market data; no keys needed. */
  A.refreshPrices = { write: true, fn: function (p, ctx) {
    if (!ctx.deps.http) fail('UNSUPPORTED', 'Automatic prices need the Apps Script backend');
    var s = settings(ctx), base = s.base_currency.toLowerCase();
    var assets = ctx.read('Assets').filter(function (a) { return a.status === 'ACTIVE' && a.price_source === 'COINGECKO' && a.price_source_id; });
    var fxIds = {}; try { fxIds = JSON.parse(s.coingecko_fx_ids || '{}'); } catch (e) { fxIds = {}; }
    var ids = {}; assets.forEach(function (a) { ids[a.price_source_id] = 1; }); Object.keys(fxIds).forEach(function (c) { ids[fxIds[c]] = 1; });
    var list = Object.keys(ids);
    if (!list.length) fail('VALIDATION', 'No crypto assets are set to use CoinGecko. Edit the coin and set Price source to CoinGecko with its CoinGecko ID.');
    var res = ctx.deps.http.getJson('https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(list.join(',')) + '&vs_currencies=' + base + '&include_last_updated_at=true');
    var prices = [], fxRows = [], skipped = [];
    // Fetched quotes are stamped with the fetch time so they supersede older manual entries;
    // CoinGecko's own "last updated" time is kept in the notes.
    var quoted = function (q) { return q.last_updated_at ? ' (CoinGecko updated ' + new Date(q.last_updated_at * 1000).toISOString() + ')' : ''; };
    assets.forEach(function (a) {
      var label = a.ticker || a.name;
      if (a.currency.toUpperCase() !== s.base_currency) { skipped.push(label + ': price currency is ' + a.currency + ', must be ' + s.base_currency); return; }
      var q = res[a.price_source_id];
      if (!q || !(q[base] > 0)) { skipped.push(label + ': CoinGecko has no price for ID "' + a.price_source_id + '" (check the ID)'); return; }
      prices.push({ price_id: ctx.id('PRC'), asset_id: a.asset_id, price: q[base], currency: s.base_currency, as_of: ctx.nowIso, source: 'COINGECKO', is_estimate: false, notes: 'coingecko:' + a.price_source_id + quoted(q), created_at: ctx.nowIso });
    });
    Object.keys(fxIds).forEach(function (c) {
      var q = res[fxIds[c]];
      if (q && q[base] > 0 && c.toUpperCase() !== s.base_currency) fxRows.push({ fx_id: ctx.id('FX'), currency: c.toUpperCase(), rate: q[base], as_of: ctx.nowIso, source: 'COINGECKO:' + fxIds[c], created_at: ctx.nowIso });
    });
    if (assets.length && !prices.length) fail('VALIDATION', 'No prices were updated. ' + skipped.join(' · '));
    if (prices.length) ctx.deps.store.append('PriceHistory', prices);
    if (fxRows.length) ctx.deps.store.append('FXRates', fxRows);
    ctx.invalidate('PriceHistory'); ctx.invalidate('FXRates');
    ctx.audit('REFRESH', 'Prices', 'coingecko', null, { prices: prices.length, fx: fxRows.length, skipped: skipped });
    return { prices: prices, fx: fxRows, skipped: skipped };
  } };

  /**
   * Save a batch of market quotes fetched by the signed-in user's browser (Binance and CoinGecko
   * block or throttle Google's servers, so the browser fetches and this records). One request,
   * one lock, one audit entry. Each quote must be in the asset's own price currency.
   */
  A.recordPrices = { write: true, fn: function (p, ctx) {
    var base = settings(ctx).base_currency;
    var inP = Array.isArray(p.prices) ? p.prices : [], inF = Array.isArray(p.fx) ? p.fx : [];
    if (!inP.length && !inF.length) fail('VALIDATION', 'No prices to record');
    if (inP.length > 300 || inF.length > 50) fail('VALIDATION', 'Too many prices in one request');
    var seen = {};
    var prices = inP.map(function (q, i) {
      var a = getAsset(ctx, q.asset_id, true);
      if (seen[a.asset_id]) fail('VALIDATION', 'Duplicate price for ' + (a.ticker || a.name));
      seen[a.asset_id] = 1;
      var source = oneOf(q.source, MARKET_SOURCES, 'prices[' + i + '].source');
      var cur = currencyCode(q.currency, 'prices[' + i + '].currency');
      if (cur !== a.currency) fail('VALIDATION', (a.ticker || a.name) + ': price must be in ' + a.currency + ' (got ' + cur + ')');
      return { price_id: ctx.id('PRC'), asset_id: a.asset_id, price: amount(q.price, 'price', { required: true, positive: true }), currency: cur, as_of: isoTime(q.as_of || ctx.nowIso, 'as_of', ctx.nowMs), source: source, is_estimate: false, notes: str(q.notes, 'notes', { max: 300 }), created_at: ctx.nowIso };
    });
    var fx = inF.map(function (r, i) {
      var cur = currencyCode(r.currency, 'fx[' + i + '].currency');
      if (cur === base) fail('VALIDATION', 'The base currency always has a rate of 1');
      return { fx_id: ctx.id('FX'), currency: cur, rate: amount(r.rate, 'rate', { required: true, positive: true }), as_of: isoTime(r.as_of || ctx.nowIso, 'as_of', ctx.nowMs), source: str(r.source, 'source', { max: 40 }) || 'MARKET', created_at: ctx.nowIso };
    });
    if (prices.length) ctx.deps.store.append('PriceHistory', prices);
    if (fx.length) ctx.deps.store.append('FXRates', fx);
    ctx.invalidate('PriceHistory'); ctx.invalidate('FXRates');
    ctx.audit('REFRESH', 'Prices', 'browser', null, { prices: prices.length, fx: fx.length, sources: prices.map(function (x) { return x.source; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }) });
    return { prices: prices, fx: fx };
  } };

  // ---- settings
  A.saveSettings = { write: true, fn: function (p, ctx) {
    var vals = p.values || {};
    var current = ctx.read('Settings');
    var changed = [];
    Object.keys(vals).forEach(function (k) {
      if (!SETTING_RULES[k]) fail('VALIDATION', 'Unknown setting ' + k);
      var v = typeof vals[k] === 'object' ? JSON.stringify(vals[k]) : String(vals[k]);
      var rule = SETTING_RULES[k];
      if (rule === 'json') { try { JSON.parse(v); } catch (e) { fail('VALIDATION', k + ' must be valid JSON'); } }
      else if (!rule.test(v)) fail('VALIDATION', 'Invalid value for ' + k);
      if (k === 'base_currency') {
        var hasTx = ctx.read('Transactions').length > 0;
        if (hasTx && v !== settings(ctx).base_currency) fail('VALIDATION', 'Base currency cannot change after transactions are recorded');
      }
      if (k === 'allocation_targets') {
        var t = JSON.parse(v), sum = 0; Object.keys(t).forEach(function (x) { sum += Core.num(t[x]); });
        if (Math.abs(sum - 100) > 0.01) fail('VALIDATION', 'Allocation targets must add up to 100% (currently ' + Core.round(sum, 2) + '%)');
      }
      var existing = findBy(current, 'key', k);
      var before = existing ? existing.value : DEFAULT_SETTINGS[k];
      if (existing) ctx.deps.store.update('Settings', 'key', k, { value: v, updated_at: ctx.nowIso });
      else ctx.deps.store.append('Settings', [{ key: k, value: v, updated_at: ctx.nowIso }]);
      ctx.audit('UPDATE', 'Setting', k, { value: before }, { value: v });
      changed.push(k);
    });
    ctx.invalidate('Settings');
    return { settings: settings(ctx), changed: changed };
  } };

  // ---- goals
  function goalFields(p, isNew) {
    var o = {};
    if (isNew || p.name !== undefined) o.name = str(p.name, 'name', { required: true, max: 80 });
    if (isNew || p.target_amount !== undefined) o.target_amount = amount(p.target_amount, 'target_amount', { required: true, positive: true });
    if (isNew || p.basis !== undefined) o.basis = p.basis ? oneOf(p.basis, ['NET_WORTH', 'INVESTMENTS', 'LIQUID', 'CASH'], 'basis') : 'NET_WORTH';
    if (isNew || p.starting_amount !== undefined) o.starting_amount = amount(p.starting_amount, 'starting_amount');
    if (isNew || p.start_date !== undefined) o.start_date = str(p.start_date, 'start_date', { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ });
    if (isNew || p.target_date !== undefined) o.target_date = str(p.target_date, 'target_date', { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ });
    if (isNew || p.monthly_contribution !== undefined) o.monthly_contribution = amount(p.monthly_contribution, 'monthly_contribution');
    if (isNew || p.expected_return !== undefined) { o.expected_return = amount(p.expected_return, 'expected_return', { allowNegative: true }); if (Math.abs(o.expected_return) > 100) fail('VALIDATION', 'expected_return must be between -100 and 100 (%)'); }
    if (isNew || p.priority !== undefined) o.priority = Math.round(amount(p.priority, 'priority')) || 1;
    if (isNew || p.notes !== undefined) o.notes = str(p.notes, 'notes', { max: 1000 });
    return o;
  }
  A.createGoal = { write: true, fn: function (p, ctx) {
    var row = goalFields(p, true);
    row.goal_id = ctx.id('GOAL'); row.status = 'ACTIVE'; row.created_at = ctx.nowIso; row.updated_at = ctx.nowIso;
    ctx.deps.store.append('Goals', [row]); ctx.invalidate('Goals');
    ctx.audit('CREATE', 'Goal', row.goal_id, null, row);
    return { goal: row };
  } };
  A.updateGoal = { write: true, fn: function (p, ctx) {
    var g = findBy(ctx.read('Goals'), 'goal_id', String(p.goal_id || ''));
    if (!g) fail('NOT_FOUND', 'Goal not found');
    checkVersion(g, p.expected_updated_at);
    var patch = goalFields(p, false);
    if (p.status !== undefined) patch.status = oneOf(p.status, ['ACTIVE', 'ACHIEVED', 'ARCHIVED'], 'status');
    patch.updated_at = ctx.nowIso;
    var after = ctx.deps.store.update('Goals', 'goal_id', g.goal_id, patch); ctx.invalidate('Goals');
    ctx.audit('UPDATE', 'Goal', g.goal_id, g, after);
    return { goal: after };
  } };

  // ---- snapshots
  function snapshotFor(ctx, dateStr) {
    var d = data(ctx);
    var row = Core.buildSnapshot(d, dateStr, d.settings.timezone, ctx.nowIso);
    var existing = findBy(ctx.read('DailySnapshots'), 'snapshot_date', dateStr);
    if (existing) ctx.deps.store.update('DailySnapshots', 'snapshot_date', dateStr, row);
    else ctx.deps.store.append('DailySnapshots', [row]);
    ctx.invalidate('DailySnapshots');
    return row;
  }
  A.takeSnapshot = { write: true, fn: function (p, ctx) {
    var tz = settings(ctx).timezone;
    var today = Core.localDate(ctx.nowMs, tz);
    var date = p.date ? str(p.date, 'date', { pattern: /^\d{4}-\d{2}-\d{2}$/ }) : today;
    if (date > today) fail('VALIDATION', 'Cannot snapshot a future date');
    var row = snapshotFor(ctx, date);
    ctx.audit('SNAPSHOT', 'DailySnapshot', date, null, { net_worth: row.net_worth });
    return { snapshot: row };
  } };
  /** Recompute snapshots for a date range from the ledger + recorded prices (reproducible). */
  A.rebuildSnapshots = { write: true, fn: function (p, ctx) {
    var tz = settings(ctx).timezone, today = Core.localDate(ctx.nowMs, tz);
    var txs = ctx.read('Transactions');
    if (!txs.length) return { count: 0, note: 'No transactions yet' };
    var first = txs.map(function (t) { return Core.localDate(t.occurred_at, tz); }).sort()[0];
    var from = p.from ? str(p.from, 'from', { pattern: /^\d{4}-\d{2}-\d{2}$/ }) : first;
    var to = p.to ? str(p.to, 'to', { pattern: /^\d{4}-\d{2}-\d{2}$/ }) : today;
    if (to > today) to = today;
    if (from < first) from = first;
    var n = Core.daysBetween(from, to) + 1;
    if (n <= 0) fail('VALIDATION', '"from" must be on or before "to"');
    if (n > 1100) fail('VALIDATION', 'Rebuild at most 1,100 days per request');
    var d = data(ctx);
    var existing = {}; ctx.read('DailySnapshots').forEach(function (s) { existing[String(s.snapshot_date)] = 1; });
    var fresh = [];
    for (var i = 0; i < n; i++) {
      var date = Core.addDays(from, i);
      var row = Core.buildSnapshot(d, date, tz, ctx.nowIso);
      if (existing[date]) ctx.deps.store.update('DailySnapshots', 'snapshot_date', date, row); else fresh.push(row);
    }
    if (fresh.length) ctx.deps.store.append('DailySnapshots', fresh);
    ctx.invalidate('DailySnapshots');
    ctx.audit('REBUILD', 'DailySnapshot', from + '..' + to, null, { days: n });
    return { count: n, from: from, to: to };
  } };

  // ---- integrity, audit, backup
  A.integrityCheck = { fn: function (p, ctx) {
    var res = Core.checkIntegrity(data(ctx));
    var reqs = {};
    ctx.read('Transactions').forEach(function (t) { if (t.request_id && t.type !== 'REVERSAL') (reqs[t.request_id] = reqs[t.request_id] || []).push(t); });
    // A request may legitimately post several linked legs; flag only unlinked duplicates.
    Object.keys(reqs).forEach(function (r) { var l = reqs[r]; if (l.length > 1 && l.some(function (t) { return !t.link_id && !t.replaces; }) && !l.every(function (t) { return t.replaces; })) res.issues.push({ level: 'warn', code: 'MULTI_ROW_REQUEST', message: 'Request ' + r + ' produced ' + l.length + ' rows' }); });
    return res;
  } };
  A.getAuditLog = { fn: function (p, ctx) {
    var rows = ctx.read('AuditLog').slice().reverse();
    var lim = Math.min(1000, Math.max(1, Math.round(Core.num(p.limit) || 200)));
    if (p.entity_id) rows = rows.filter(function (r) { return r.entity_id === p.entity_id; });
    return { rows: rows.slice(0, lim), total: rows.length };
  } };
  A.exportBackup = { fn: function (p, ctx) {
    var out = { format: 'personal-wealth-os-backup', version: 1, exported_at: ctx.nowIso, sheets: {} };
    SHEETS.forEach(function (s) { if (s !== 'Requests') out.sheets[s] = ctx.read(s); });
    ctx.audit('EXPORT', 'Backup', 'full', null, { rows: SHEETS.map(function (s) { return s + ':' + (out.sheets[s] ? out.sheets[s].length : 0); }).join(' ') });
    return out;
  } };
  A.restoreBackup = { write: true, fn: function (p, ctx) {
    var b = p.backup;
    if (!b || b.format !== 'personal-wealth-os-backup' || !b.sheets) fail('VALIDATION', 'Not a Personal Wealth OS backup file');
    var occupied = ['Accounts', 'Assets', 'Transactions'].filter(function (s) { return ctx.read(s).length > 0; });
    if (occupied.length) fail('CONFLICT', 'Restore only runs into an empty database (found data in ' + occupied.join(', ') + '). Use a fresh spreadsheet.');
    var probe = { accounts: b.sheets.Accounts || [], assets: b.sheets.Assets || [], transactions: b.sheets.Transactions || [], prices: b.sheets.PriceHistory || [], fx: b.sheets.FXRates || [], settings: b.sheets.Settings || [] };
    var integ = Core.checkIntegrity(probe);
    if (!integ.ok) fail('VALIDATION', 'Backup failed integrity checks; nothing was restored', integ.issues.slice(0, 10));
    var counts = {};
    SHEETS.forEach(function (s) {
      if (s === 'Requests' || !b.sheets[s] || !b.sheets[s].length) return;
      var cols = SCHEMA[s].cols.map(function (c) { return c[0]; });
      var rows = b.sheets[s].map(function (r) { var o = {}; cols.forEach(function (c) { o[c] = r[c] === undefined ? '' : r[c]; }); return o; });
      if (s === 'Settings') rows = rows.filter(function (r) { return SETTING_RULES[r.key]; });
      ctx.deps.store.append(s, rows); ctx.invalidate(s); counts[s] = rows.length;
    });
    ctx.audit('RESTORE', 'Backup', b.exported_at || '', null, counts);
    return { restored: counts };
  } };

  // ------------------------------------------------------------------ auth
  /**
   * Validate Google ID-token claims (signature already verified by Google's tokeninfo endpoint).
   * cfg: { clientId, allowedEmails: [] }
   */
  function checkClaims(claims, cfg, nowMs) {
    if (!claims) fail('UNAUTHENTICATED', 'Sign in required');
    if (!cfg || !cfg.clientId) fail('MISCONFIGURED', 'Server is missing GOOGLE_CLIENT_ID');
    if (!cfg.allowedEmails || !cfg.allowedEmails.length) fail('MISCONFIGURED', 'Server is missing ALLOWED_EMAILS');
    if (claims.aud !== cfg.clientId) fail('UNAUTHENTICATED', 'Token was not issued for this app');
    if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') fail('UNAUTHENTICATED', 'Untrusted token issuer');
    if (!(Number(claims.exp) * 1000 > nowMs)) fail('UNAUTHENTICATED', 'Session expired, sign in again');
    if (!(claims.email_verified === true || claims.email_verified === 'true')) fail('FORBIDDEN', 'Email not verified');
    var email = String(claims.email || '').toLowerCase();
    var allowed = cfg.allowedEmails.map(function (e) { return String(e).trim().toLowerCase(); });
    if (allowed.indexOf(email) < 0) fail('FORBIDDEN', 'This Google account is not authorised for this Wealth OS');
    return { email: email, exp: Number(claims.exp) };
  }

  // ------------------------------------------------------------------ dispatcher
  function handle(req, deps) {
    var started = deps.now();
    try {
      if (!req || typeof req !== 'object') fail('VALIDATION', 'Malformed request');
      var action = String(req.action || '');
      var def = Object.prototype.hasOwnProperty.call(A, action) ? A[action] : null;
      if (!def) fail('NOT_FOUND', 'Unknown action');
      var actor = '';
      if (def.auth !== false) {
        var who = deps.authenticate(req.idToken); // throws ApiError on failure
        actor = who.email;
      }
      var payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
      var runAction = function () {
        var ctx = makeCtx(deps, actor, req.requestId);
        if (def.write) {
          var rid = str(req.requestId, 'requestId', { required: true, max: 80, pattern: /^[A-Za-z0-9_-]{8,80}$/ });
          var prior = findBy(ctx.read('Requests'), 'request_id', rid);
          if (prior) {
            if (prior.action !== action) fail('CONFLICT', 'requestId already used for a different action');
            var stored = {}; try { stored = JSON.parse(prior.result_json || '{}'); } catch (e) { stored = {}; }
            return { replayed: true, data: stored };
          }
          var result = def.fn(payload, ctx);
          var json = JSON.stringify(result);
          deps.store.append('Requests', [{ request_id: rid, action: action, actor: actor, at: ctx.nowIso, result_json: json.length > 40000 ? '{"truncated":true}' : json }]);
          return { replayed: false, data: result };
        }
        return { replayed: false, data: def.fn(payload, ctx) };
      };
      var out = def.write ? deps.withLock(runAction) : runAction();
      return { ok: true, data: out.data, replayed: out.replayed, requestId: req.requestId || null, ms: deps.now() - started };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, error: { code: e.code, message: e.message, details: e.details } };
      if (deps.log) deps.log(e);
      return { ok: false, error: { code: 'INTERNAL', message: 'Unexpected server error' } };
    }
  }

  /** Internal entry for trusted server jobs (time-driven triggers). No token: runs as the script owner. */
  function runInternal(action, payload, deps, label) {
    var def = A[action];
    if (!def) throw new Error('Unknown action ' + action);
    var ctx = makeCtx(deps, label || 'system:trigger', 'job-' + deps.now());
    return deps.withLock(function () { return def.fn(payload || {}, ctx); });
  }

  // ------------------------------------------------------------------ in-memory store (sandbox & tests)
  function MemoryStore(initial) {
    var db = {};
    SHEETS.forEach(function (s) { db[s] = (initial && initial[s]) ? initial[s].map(function (r) { return JSON.parse(JSON.stringify(r)); }) : []; });
    function clone(r) { return JSON.parse(JSON.stringify(r)); }
    function coerce(sheet, r) {
      var o = {};
      SCHEMA[sheet].cols.forEach(function (c) {
        var v = r[c[0]];
        if (v === undefined || v === null) v = c[1] === 'n' ? 0 : c[1] === 'b' ? false : '';
        o[c[0]] = c[1] === 'n' ? Core.num(v) : c[1] === 'b' ? bool(v) : String(v);
      });
      return o;
    }
    return {
      hasSheet: function (s) { return !!db[s]; },
      read: function (s) { if (!db[s]) throw new Error('Unknown sheet ' + s); return db[s].map(clone); },
      append: function (s, rows) { rows.forEach(function (r) { db[s].push(coerce(s, r)); }); },
      update: function (s, key, id, patch) {
        for (var i = 0; i < db[s].length; i++) if (db[s][i][key] === id) {
          var merged = clone(db[s][i]); Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
          db[s][i] = coerce(s, merged); return clone(db[s][i]);
        }
        throw new ApiError('NOT_FOUND', s + ' row not found');
      },
      dump: function () { return JSON.parse(JSON.stringify(db)); }
    };
  }

  return {
    API_VERSION: API_VERSION, SCHEMA: SCHEMA, SHEETS: SHEETS, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    handle: handle, runInternal: runInternal, checkClaims: checkClaims, MemoryStore: MemoryStore, ApiError: ApiError,
    actions: Object.keys(A)
  };
}

// Browser: WealthCore is loaded first by index.html. Apps Script: Code.gs calls
// createWealthService(WealthCore) at request time (file load order is not guaranteed).
var WealthService = typeof WealthCore !== 'undefined' ? createWealthService(WealthCore) : null;
if (typeof module !== 'undefined' && module.exports) module.exports = createWealthService(require('./core.js'));
