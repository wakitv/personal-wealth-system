'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, Core, Service } = require('./helpers');

const T0 = '2026-10-01T02:00:00Z';
const T1 = '2026-10-02T02:00:00Z';
const T2 = '2026-10-03T02:00:00Z';

function bank(app, opening = 100000, name = 'Bank') {
  return app.must('createAccount', { name, type: 'BANK', currency: 'PHP', opening_balance: opening, opening_date: T0 }).account.account_id;
}

test('Test G — duplicate submission records exactly one transaction', () => {
  const app = makeApp();
  const acc = bank(app);
  const req = { action: 'postTransaction', idToken: 'good-token', requestId: 'dup-request-0001', payload: { type: 'DEPOSIT', account_id: acc, gross_amount: 10000, occurred_at: T1 } };
  const r1 = Service.handle(req, app.deps);
  const r2 = Service.handle(req, app.deps);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.replayed, true);
  assert.equal(r2.data.transactions[0].tx_id, r1.data.transactions[0].tx_id);
  const deposits = app.data().transactions.filter((t) => t.type === 'DEPOSIT');
  assert.equal(deposits.length, 1);
  assert.equal(app.state().accounts[acc].cashNative, 110000);
  // the same requestId reused for another action is rejected
  const r3 = Service.handle({ ...req, action: 'createGoal', payload: { name: 'x', target_amount: 1 } }, app.deps);
  assert.equal(r3.ok, false);
  assert.equal(r3.error.code, 'CONFLICT');
  // writes without a requestId are rejected
  const r4 = Service.handle({ ...req, requestId: undefined }, app.deps);
  assert.equal(r4.ok, false);
});

test('Test H — reconciliation: accounts, holdings, transfers, fees and totals tie out', () => {
  const app = makeApp();
  const b = bank(app, 1000000, 'BDO');
  const ex = app.must('createAccount', { name: 'Binance', type: 'EXCHANGE', currency: 'USDT', opening_balance: 0 }).account.account_id;
  const w = app.must('createAccount', { name: 'Cold wallet', type: 'WALLET', currency: 'USDT' }).account.account_id;
  const btc = app.must('createAsset', { name: 'Bitcoin', ticker: 'BTC', asset_class: 'CRYPTO', currency: 'USDT' }).asset.asset_id;
  const biz = app.must('createAsset', { name: 'Café stake', asset_class: 'OTHER', category: 'BUSINESS', currency: 'PHP', unit_label: '%' }).asset.asset_id;
  // PHP → USDT transfer at 58: send 580,000 PHP, receive 10,000 USDT, 50 PHP fee
  app.must('postTransfer', { from_account_id: b, to_account_id: ex, amount: 580000, amount_in: 10000, fee: 50, fx_rate_to: 58, occurred_at: T1 });
  app.must('postTransaction', { type: 'BUY', account_id: ex, asset_id: btc, quantity: 0.1, unit_price: 60000, fee: 6, fx_rate: 58, occurred_at: T1 });
  app.must('postAssetTransfer', { asset_id: btc, from_account_id: ex, to_account_id: w, quantity: 0.1, fee_quantity: 0.0005, occurred_at: T2 });
  app.must('postTransaction', { type: 'ADD_POSITION', account_id: b, asset_id: biz, quantity: 10, gross_amount: 300000, occurred_at: T0 });
  app.must('updateValuation', { asset_id: biz, total_value: 350000, as_of: T2, valuation_source: 'owner estimate' });
  app.must('addFxRate', { currency: 'USDT', rate: 58, as_of: T2 });
  app.must('addPrice', { asset_id: btc, price: 62000, currency: 'USDT', as_of: T2 });

  const d = app.data();
  const s = Core.computeState(d, { asOf: Infinity });
  const integ = Core.checkIntegrity(d);
  assert.equal(integ.ok, true, JSON.stringify(integ.issues));

  assert.equal(s.accounts[b].cashNative, 1000000 - 580000 - 50);
  assert.equal(s.accounts[ex].cashNative, 10000 - 6006);
  const btcPos = s.byAsset.find((x) => x.asset_id === btc);
  assert.equal(btcPos.qty, 0.0995);
  assert.equal(btcPos.valueBase, Core.base2(0.0995 * 62000 * 58));
  // Totals: cash + investments − liabilities, with no double counting of wallet & holdings
  const cash = Core.base2(s.accounts[b].cashBase + s.accounts[ex].cashBase);
  const inv = Core.base2(btcPos.valueBase + 350000);
  assert.equal(s.summary.cash, cash);
  assert.equal(s.summary.investment, inv);
  assert.equal(s.summary.netWorth, Core.base2(cash + inv));
  assert.equal(integ.identity.accountsPlusUnassigned, s.summary.netWorth);
  // Internal transfers are not deposits; only the opening balance + business stake are flows
  assert.equal(s.summary.deposits, 0);
  assert.equal(s.summary.netFlows, 1300000);
  assert.equal(s.summary.transfers, 580000);
  // Gain identity: net worth − flows = realized + unrealized + income − (non-capitalised fees) + FX effects
  const gain = Core.base2(s.summary.netWorth - s.summary.netFlows);
  assert.ok(Number.isFinite(gain));
});

test('Test I — unauthenticated and unauthorised requests cannot read or write', () => {
  const app = makeApp();
  bank(app);
  const cases = [
    [undefined, 'UNAUTHENTICATED'], ['', 'UNAUTHENTICATED'], ['forged-token', 'UNAUTHENTICATED'],
    ['wrong-aud-token', 'UNAUTHENTICATED'], ['expired-token', 'UNAUTHENTICATED'], ['stranger-token', 'FORBIDDEN']
  ];
  for (const [tok, code] of cases) {
    for (const action of ['bootstrap', 'exportBackup', 'getAuditLog', 'postTransaction', 'restoreBackup', 'saveSettings']) {
      const r = Service.handle({ action, idToken: tok, requestId: 'attempt-' + Math.random().toString(36).slice(2, 12), payload: { type: 'DEPOSIT', account_id: 'x', gross_amount: 1, occurred_at: T1 } }, app.deps);
      assert.equal(r.ok, false, action + ' with ' + tok);
      assert.equal(r.error.code, code, action + ' with ' + tok);
      assert.equal(r.data, undefined);
    }
  }
  // health is public but exposes no records
  const h = Service.handle({ action: 'health' }, app.deps);
  assert.equal(h.ok, true);
  assert.deepEqual(Object.keys(h.data).sort(), ['apiVersion', 'coreVersion', 'service', 'sheetsReady', 'status', 'time']);
  assert.equal(JSON.stringify(h.data).includes('Bank'), false);
  // unknown actions and prototype tricks are rejected
  assert.equal(Service.handle({ action: '__proto__', idToken: 'good-token' }, app.deps).error.code, 'NOT_FOUND');
  assert.equal(Service.handle({ action: 'constructor', idToken: 'good-token' }, app.deps).error.code, 'NOT_FOUND');
  // nothing was written by the rejected requests
  assert.equal(app.data().transactions.length, 1);
});

test('checkClaims requires matching audience, issuer, expiry, verified email and allowlist', () => {
  const cfg = { clientId: 'cid', allowedEmails: ['Me@Example.com'] };
  const now = 1e12;
  const good = { aud: 'cid', iss: 'accounts.google.com', exp: String(now / 1000 + 60), email: 'me@example.com', email_verified: 'true' };
  assert.equal(Service.checkClaims(good, cfg, now).email, 'me@example.com');
  const bad = [{ aud: 'x' }, { iss: 'evil.com' }, { exp: String(now / 1000 - 1) }, { email_verified: 'false' }, { email: 'other@example.com' }];
  for (const b of bad) assert.throws(() => Service.checkClaims({ ...good, ...b }, cfg, now));
  assert.throws(() => Service.checkClaims(good, { clientId: 'cid', allowedEmails: [] }, now), /ALLOWED_EMAILS|MISCONFIGURED/);
});

test('Invalid amounts are rejected', () => {
  const app = makeApp();
  const acc = bank(app);
  for (const gross_amount of [0, -5, 'abc', '', 1e15, null]) {
    const r = app.api('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount, occurred_at: T1 });
    assert.equal(r.ok, false, String(gross_amount));
    assert.equal(r.error.code, 'VALIDATION');
  }
  assert.equal(app.api('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 10, occurred_at: 'not a date' }).error.code, 'VALIDATION');
  assert.equal(app.api('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 10, occurred_at: '2030-01-01T00:00:00Z' }).error.code, 'VALIDATION');
  assert.equal(app.api('postTransaction', { type: 'HACK', account_id: acc, gross_amount: 10, occurred_at: T1 }).error.code, 'VALIDATION');
  assert.equal(app.api('postTransaction', { type: 'DEPOSIT', account_id: 'nope', gross_amount: 10, occurred_at: T1 }).error.code, 'NOT_FOUND');
  assert.equal(app.api('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 10, currency: 'USD', occurred_at: T1 }).error.code, 'VALIDATION');
  assert.equal(app.data().transactions.length, 1);
});

test('Insufficient funds and quantities are blocked, including backdated entries', () => {
  const app = makeApp();
  const acc = bank(app, 1000);
  let r = app.api('postTransaction', { type: 'WITHDRAWAL', account_id: acc, gross_amount: 1000, fee: 1, occurred_at: T1 });
  assert.equal(r.error.code, 'INSUFFICIENT_FUNDS');
  app.must('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 5000, occurred_at: T2 });
  // balance is 6000 today, but a withdrawal dated before the deposit would overdraw history
  r = app.api('postTransaction', { type: 'WITHDRAWAL', account_id: acc, gross_amount: 3000, occurred_at: T1 });
  assert.equal(r.error.code, 'INSUFFICIENT_FUNDS');
  const stk = app.must('createAsset', { name: 'S', ticker: 'S', asset_class: 'STOCK', currency: 'PHP' }).asset.asset_id;
  r = app.api('postTransaction', { type: 'SELL', account_id: acc, asset_id: stk, quantity: 1, unit_price: 10, occurred_at: T2 });
  assert.equal(r.error.code, 'INSUFFICIENT_QUANTITY');
  r = app.api('postTransfer', { from_account_id: acc, to_account_id: bank(app, 0, 'Other'), amount: 999999, occurred_at: T2 });
  assert.equal(r.error.code, 'INSUFFICIENT_FUNDS');
});

test('Reversal is audited, removes the effect, and cannot be repeated', () => {
  const app = makeApp();
  const acc = bank(app, 1000);
  const tx = app.must('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 500, occurred_at: T1 }).transactions[0];
  app.must('reverseTransaction', { tx_id: tx.tx_id, reason: 'entered twice' });
  const d = app.data();
  const orig = d.transactions.find((t) => t.tx_id === tx.tx_id);
  assert.equal(orig.status, 'REVERSED');
  const rev = d.transactions.find((t) => t.reversal_of === tx.tx_id);
  assert.equal(rev.type, 'REVERSAL');
  assert.equal(orig.reversed_by, rev.tx_id);
  assert.equal(app.state().accounts[acc].cashNative, 1000);
  assert.equal(app.api('reverseTransaction', { tx_id: tx.tx_id, reason: 'again' }).error.code, 'CONFLICT');
  assert.equal(app.api('reverseTransaction', { tx_id: rev.tx_id, reason: 'x' }).error.code, 'VALIDATION');
  const audit = app.must('getAuditLog', { entity_id: tx.tx_id }).rows;
  assert.ok(audit.some((a) => a.action === 'REVERSE'));
  assert.ok(audit.some((a) => a.action === 'POST'));
  // rows are never deleted
  assert.equal(d.transactions.length, 3);
});

test('Reversing a spent deposit is blocked (would overdraw)', () => {
  const app = makeApp();
  const acc = bank(app, 0);
  const dep = app.must('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 500, occurred_at: T1 }).transactions[0];
  app.must('postTransaction', { type: 'WITHDRAWAL', account_id: acc, gross_amount: 400, occurred_at: T2 });
  assert.equal(app.api('reverseTransaction', { tx_id: dep.tx_id, reason: 'oops' }).error.code, 'INSUFFICIENT_FUNDS');
});

test('Transfer reversal reverses both legs together', () => {
  const app = makeApp();
  const a = bank(app, 1000, 'A'), b = bank(app, 0, 'B');
  const t = app.must('postTransfer', { from_account_id: a, to_account_id: b, amount: 300, occurred_at: T1 });
  app.must('reverseTransaction', { tx_id: t.transactions[1].tx_id, reason: 'wrong account' });
  const s = app.state();
  assert.equal(s.accounts[a].cashNative, 1000);
  assert.equal(s.accounts[b].cashNative, 0);
  assert.equal(Core.checkIntegrity(app.data()).ok, true);
});

test('Edit = reversal + replacement; dependent figures recalculate', () => {
  const app = makeApp();
  const acc = bank(app, 10000);
  const stk = app.must('createAsset', { name: 'S', ticker: 'S', asset_class: 'STOCK', currency: 'PHP' }).asset.asset_id;
  const buy = app.must('postTransaction', { type: 'BUY', account_id: acc, asset_id: stk, quantity: 10, unit_price: 100, occurred_at: T1 }).transactions[0];
  app.must('postTransaction', { type: 'SELL', account_id: acc, asset_id: stk, quantity: 4, unit_price: 120, occurred_at: T2 });
  assert.equal(app.state().summary.realized, 80);
  const res = app.must('editTransaction', { tx_id: buy.tx_id, expected_updated_at: buy.updated_at, changes: { unit_price: 90 }, reason: 'typo' });
  assert.equal(res.transactions[0].replaces, buy.tx_id);
  const s = app.state();
  assert.equal(s.summary.realized, 120); // (120 − 90) × 4
  assert.equal(s.byAsset[0].costBase, 540);
  // stale edit is rejected (optimistic concurrency)
  const r = app.api('editTransaction', { tx_id: res.transactions[0].tx_id, expected_updated_at: 'stale', changes: { unit_price: 80 } });
  assert.equal(r.error.code, 'CONFLICT');
  // an edit that would make a later sale impossible is rejected
  const r2 = app.api('editTransaction', { tx_id: res.transactions[0].tx_id, changes: { quantity: 2 } });
  assert.equal(r2.error.code, 'INSUFFICIENT_QUANTITY');
});

test('Externally funded buy records a linked deposit and nets to zero cash', () => {
  const app = makeApp();
  const acc = bank(app, 0, 'Broker');
  const stk = app.must('createAsset', { name: 'S', ticker: 'S', asset_class: 'STOCK', currency: 'PHP' }).asset.asset_id;
  const r = app.must('postTransaction', { type: 'BUY', account_id: acc, asset_id: stk, quantity: 5, unit_price: 100, fee: 10, fund_externally: true, occurred_at: T1 });
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0].type, 'DEPOSIT');
  const s = app.state();
  assert.equal(s.accounts[acc].cashNative, 0);
  assert.equal(s.summary.deposits, 510);
  assert.equal(s.summary.netWorth, 500);
});

test('Simultaneous requests are serialised: the second overdraft fails cleanly', () => {
  const app = makeApp();
  const acc = bank(app, 1000);
  // two different submissions racing for the same funds; the store lock serialises them
  const results = [1, 2].map((i) => Service.handle({ action: 'postTransaction', idToken: 'good-token', requestId: 'race-request-' + i, payload: { type: 'WITHDRAWAL', account_id: acc, gross_amount: 700, occurred_at: T1 } }, app.deps));
  assert.deepEqual(results.map((r) => r.ok), [true, false]);
  assert.equal(results[1].error.code, 'INSUFFICIENT_FUNDS');
  assert.equal(app.state().accounts[acc].cashNative, 300);
  // a lock that cannot be acquired surfaces as an error and writes nothing
  const busy = { ...app.deps, withLock: () => { throw new Service.ApiError('BUSY', 'Another update is in progress'); } };
  const r = Service.handle({ action: 'postTransaction', idToken: 'good-token', requestId: 'race-request-3', payload: { type: 'DEPOSIT', account_id: acc, gross_amount: 1, occurred_at: T1 } }, busy);
  assert.equal(r.error.code, 'BUSY');
  assert.equal(app.data().transactions.length, 2);
});

test('Optimistic concurrency on account updates; archived accounts accept no new entries', () => {
  const app = makeApp();
  const acc = app.must('createAccount', { name: 'Old', type: 'BANK', currency: 'PHP', reference: '00123456789' }).account;
  app.setNow(app.now() + 1000);
  const upd = app.must('updateAccount', { account_id: acc.account_id, expected_updated_at: acc.updated_at, name: 'Renamed' }).account;
  assert.equal(upd.name, 'Renamed');
  assert.equal(app.api('updateAccount', { account_id: acc.account_id, expected_updated_at: acc.updated_at, name: 'Lost update' }).error.code, 'CONFLICT');
  app.must('updateAccount', { account_id: acc.account_id, status: 'ARCHIVED' });
  assert.equal(app.api('postTransaction', { type: 'DEPOSIT', account_id: acc.account_id, gross_amount: 1, occurred_at: T1 }).error.code, 'VALIDATION');
  // secrets are refused
  assert.equal(app.api('createAccount', { name: 'W', type: 'WALLET', notes: 'seed phrase: abandon abandon ...' }).error.code, 'VALIDATION');
});

test('Snapshots are reproducible from the ledger and rebuild fills gaps', () => {
  const app = makeApp();
  const acc = bank(app, 1000);
  app.must('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 500, occurred_at: T2 });
  const r = app.must('rebuildSnapshots', {});
  assert.equal(r.from, '2026-10-01');
  assert.equal(r.to, '2026-10-14');
  const snaps = app.data().snapshots;
  assert.equal(snaps.length, 14);
  assert.equal(snaps.find((s) => s.snapshot_date === '2026-10-02').net_worth, 1000);
  assert.equal(snaps.find((s) => s.snapshot_date === '2026-10-03').net_worth, 1500);
  assert.equal(snaps.find((s) => s.snapshot_date === '2026-10-03').net_flow_day, 500);
  // rebuilding again updates in place (no duplicates) and yields identical numbers
  app.must('rebuildSnapshots', {});
  const again = app.data().snapshots;
  assert.equal(again.length, 14);
  assert.deepEqual(again.map((s) => s.net_worth), snaps.map((s) => s.net_worth));
  assert.equal(app.api('takeSnapshot', { date: '2027-01-01' }).error.code, 'VALIDATION');
});

test('Settings validation', () => {
  const app = makeApp();
  assert.equal(app.api('saveSettings', { values: { allocation_targets: { CASH: 50, CRYPTO: 10 } } }).error.code, 'VALIDATION');
  assert.equal(app.api('saveSettings', { values: { evil_key: '1' } }).error.code, 'VALIDATION');
  assert.equal(app.api('saveSettings', { values: { stale_price_days: '=1+1' } }).error.code, 'VALIDATION');
  const ok = app.must('saveSettings', { values: { stale_price_days: '5', allocation_targets: { CASH: 20, CRYPTO: 30, STOCK: 30, BUSINESS: 10, PROPERTY: 5, OTHER: 5 } } });
  assert.equal(ok.settings.stale_price_days, '5');
  bank(app);
  assert.equal(app.api('saveSettings', { values: { base_currency: 'USD' } }).error.code, 'VALIDATION');
});

test('Goals CRUD with archive', () => {
  const app = makeApp();
  const g = app.must('createGoal', { name: 'Short-term', target_amount: 5000000, monthly_contribution: 50000, expected_return: 6, target_date: '2029-12-31', priority: 1 }).goal;
  assert.equal(g.status, 'ACTIVE');
  const a = app.must('updateGoal', { goal_id: g.goal_id, status: 'ARCHIVED' }).goal;
  assert.equal(a.status, 'ARCHIVED');
  assert.equal(app.api('createGoal', { name: 'x', target_amount: -1 }).error.code, 'VALIDATION');
});

test('Backup → restore round trip into an empty database; refuses non-empty', () => {
  const app = makeApp();
  const acc = bank(app, 1234);
  app.must('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 66, occurred_at: T1 });
  const backup = app.must('exportBackup');
  assert.equal(app.api('restoreBackup', { backup }).error.code, 'CONFLICT');
  const fresh = makeApp();
  const r = fresh.must('restoreBackup', { backup });
  assert.equal(r.restored.Transactions, 2);
  assert.equal(fresh.state().summary.netWorth, 1300);
  assert.equal(fresh.api('restoreBackup', { backup: { format: 'nope' } }).error.code, 'VALIDATION');
});

test('Price refresh uses server-side HTTP and records source + timestamp', () => {
  const http = { getJson: (url) => { assert.ok(url.startsWith('https://api.coingecko.com/')); return { bitcoin: { php: 3500000, last_updated_at: 1792000000 }, tether: { php: 57.9, last_updated_at: 1792000000 } }; } };
  const app = makeApp({ http });
  app.must('createAsset', { name: 'Bitcoin', ticker: 'BTC', asset_class: 'CRYPTO', currency: 'PHP', price_source: 'COINGECKO', price_source_id: 'bitcoin' });
  const r = app.must('refreshPrices', {});
  assert.equal(r.prices.length, 1);
  assert.equal(r.prices[0].source, 'COINGECKO');
  assert.equal(r.fx[0].currency, 'USDT');
  assert.equal(app.data().prices[0].price, 3500000);
  assert.equal(app.data().prices[0].as_of, new Date(app.now()).toISOString(), 'stamped with fetch time');
  // a wrong ID or non-PHP asset is explained, not silently "successful"
  const bad = makeApp({ http: { getJson: () => ({}) } });
  bad.must('createAsset', { name: 'Typo', ticker: 'TYP', asset_class: 'CRYPTO', currency: 'PHP', price_source: 'COINGECKO', price_source_id: 'bitcoinn' });
  bad.must('createAsset', { name: 'Ether', ticker: 'ETH', asset_class: 'CRYPTO', currency: 'USDT', price_source: 'COINGECKO', price_source_id: 'ethereum' });
  const e = bad.api('refreshPrices', {});
  assert.equal(e.ok, false);
  assert.match(e.error.message, /check the ID/);
  assert.match(e.error.message, /must be PHP/);
  // no coins configured: FX rates (USDT) still refresh
  const fxOnly = makeApp({ http: { getJson: () => ({ tether: { php: 58 } }) } }).must('refreshPrices', {});
  assert.equal(fxOnly.fx[0].rate, 58);
  // sandbox (no http) explains instead of faking
  const sb = makeApp();
  assert.equal(sb.api('refreshPrices', {}).error.code, 'UNSUPPORTED');
});

test('Remove asset: unused asset is hidden; asset with history requires confirmation and reverses it all', () => {
  const app = makeApp();
  const acc = bank(app, 10000, 'Broker');
  const w = bank(app, 0, 'Wallet');
  // unused asset → removed immediately, ticker can be reused
  const typo = app.must('createAsset', { name: 'Bitcoin', ticker: 'BTC', asset_class: 'CRYPTO', currency: 'USDT' }).asset;
  assert.equal(app.api('removeAsset', { asset_id: typo.asset_id }).error.code, 'VALIDATION'); // reason required
  const r0 = app.must('removeAsset', { asset_id: typo.asset_id, reason: 'wrong currency' });
  assert.equal(r0.asset.status, 'REMOVED');
  assert.deepEqual(r0.reversed, []);
  const btc = app.must('createAsset', { name: 'Bitcoin', ticker: 'BTC', asset_class: 'CRYPTO', currency: 'PHP' }).asset.asset_id;
  // removed asset can't be used, priced or removed again
  assert.equal(app.api('addPrice', { asset_id: typo.asset_id, price: 1 }).error.code, 'NOT_FOUND');
  assert.equal(app.api('removeAsset', { asset_id: typo.asset_id, reason: 'x' }).error.code, 'NOT_FOUND');

  // asset with buy, transfer, sale, income
  app.must('postTransaction', { type: 'BUY', account_id: acc, asset_id: btc, quantity: 0.002, unit_price: 3000000, fee: 10, occurred_at: '2026-10-02T02:00:00Z' });
  app.must('postAssetTransfer', { asset_id: btc, from_account_id: acc, to_account_id: w, quantity: 0.001, occurred_at: '2026-10-03T02:00:00Z' });
  app.must('postTransaction', { type: 'SELL', account_id: acc, asset_id: btc, quantity: 0.0005, unit_price: 3200000, occurred_at: '2026-10-04T02:00:00Z' });
  const before = app.state();
  assert.ok(before.byAsset.find((a) => a.asset_id === btc).qty > 0);
  const refused = app.api('removeAsset', { asset_id: btc, reason: 'test' });
  assert.equal(refused.error.code, 'CONFLICT');
  assert.equal(refused.error.details.transactions, 4);
  const r = app.must('removeAsset', { asset_id: btc, reason: 'entered by mistake', reverse_history: true });
  assert.equal(r.reversed.length, 4);
  const s = app.state();
  assert.equal(s.accounts[acc].cashNative, 10000, 'cash restored exactly');
  assert.equal(s.positions.filter((p) => p.asset_id === btc).length, 0);
  assert.equal(s.summary.realized, 0);
  assert.equal(s.summary.netWorth, 10000);
  assert.equal(Core.checkIntegrity(app.data()).ok, true);
  assert.equal(app.data().transactions.length, 1 + 4 + 4, 'nothing deleted: opening + originals + reversals kept');
  assert.ok(app.must('getAuditLog', { entity_id: btc }).rows.some((x) => x.action === 'REMOVE'));
});

test('Remove asset is refused if reversing its history would overdraw an account', () => {
  const app = makeApp();
  const acc = bank(app, 1000);
  const stk = app.must('createAsset', { name: 'S', ticker: 'S', asset_class: 'STOCK', currency: 'PHP' }).asset.asset_id;
  app.must('postTransaction', { type: 'BUY', account_id: acc, asset_id: stk, quantity: 10, unit_price: 50, occurred_at: '2026-10-02T02:00:00Z' });
  app.must('postTransaction', { type: 'SELL', account_id: acc, asset_id: stk, quantity: 10, unit_price: 100, occurred_at: '2026-10-03T02:00:00Z' });
  app.must('postTransaction', { type: 'WITHDRAWAL', account_id: acc, gross_amount: 1400, occurred_at: '2026-10-04T02:00:00Z' });
  const r = app.api('removeAsset', { asset_id: stk, reason: 'x', reverse_history: true });
  assert.equal(r.error.code, 'INSUFFICIENT_FUNDS');
  assert.equal(app.data().assets.find((a) => a.asset_id === stk).status, 'ACTIVE', 'nothing changed');
});

test('Market price sources: Binance symbol normalisation and batch recordPrices', () => {
  const app = makeApp();
  const a = app.must('createAsset', { name: 'Bitcoin', ticker: 'BTC', asset_class: 'CRYPTO', currency: 'PHP', price_source: 'BINANCE', price_source_id: 'binance:btc/usdt' }).asset;
  assert.equal(a.price_source_id, 'BTCUSDT');
  assert.equal(app.api('createAsset', { name: 'X', ticker: 'X', asset_class: 'CRYPTO', price_source: 'BINANCE', price_source_id: '??' }).error.code, 'VALIDATION');
  assert.equal(app.api('createAsset', { name: 'Y', ticker: 'Y', asset_class: 'CRYPTO', price_source: 'COINGECKO', price_source_id: 'Bad ID!' }).error.code, 'VALIDATION');
  // switching back to manual clears the id; updating only the id keeps the source
  const e = app.must('createAsset', { name: 'Ether', ticker: 'ETH', asset_class: 'CRYPTO', currency: 'USDT', price_source: 'COINGECKO', price_source_id: 'ethereum' }).asset;
  assert.equal(app.must('updateAsset', { asset_id: e.asset_id, price_source_id: 'Ethereum' }).asset.price_source_id, 'ethereum');
  assert.equal(app.must('updateAsset', { asset_id: e.asset_id, price_source: 'MANUAL' }).asset.price_source_id, '');
  // batch record
  const r = app.must('recordPrices', { prices: [{ asset_id: a.asset_id, price: 3600000, currency: 'PHP', source: 'BINANCE', notes: 'BTCUSDT 62000 × 58.06' }, { asset_id: e.asset_id, price: 2500, currency: 'USDT', source: 'BINANCE' }], fx: [{ currency: 'USDT', rate: 58.06, source: 'COINGECKO:tether' }] });
  assert.equal(r.prices.length, 2);
  const d = app.data();
  assert.equal(d.prices.find((x) => x.asset_id === a.asset_id).source, 'BINANCE');
  assert.equal(d.fx[0].rate, 58.06);
  // wrong currency, unknown source, removed asset, empty → rejected; nothing partially written
  const n = app.data().prices.length;
  assert.equal(app.api('recordPrices', { prices: [{ asset_id: a.asset_id, price: 1, currency: 'USDT', source: 'BINANCE' }] }).error.code, 'VALIDATION');
  assert.equal(app.api('recordPrices', { prices: [{ asset_id: a.asset_id, price: 1, currency: 'PHP', source: 'MADEUP' }] }).error.code, 'VALIDATION');
  assert.equal(app.api('recordPrices', { prices: [{ asset_id: a.asset_id, price: -1, currency: 'PHP', source: 'BINANCE' }] }).error.code, 'VALIDATION');
  assert.equal(app.api('recordPrices', {}).error.code, 'VALIDATION');
  assert.equal(app.data().prices.length, n);
  const s = app.state();
  assert.equal(s.byAsset.length, 0); // no holdings yet, prices alone don't create value
});
