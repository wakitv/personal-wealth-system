'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, Core } = require('./helpers');

const T0 = '2026-10-01T02:00:00Z';
const T1 = '2026-10-02T02:00:00Z';
const T2 = '2026-10-03T02:00:00Z';

function phpAccount(app, name, opening, type = 'BANK') {
  return app.must('createAccount', { name, type, currency: 'PHP', opening_balance: opening, opening_date: T0 }).account.account_id;
}

test('Test A — deposit increases balance and is not profit', () => {
  const app = makeApp();
  const acc = phpAccount(app, 'BPI Savings', 100000);
  const before = app.state();
  app.must('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 10000, occurred_at: T1 });
  const after = app.state();
  assert.equal(after.accounts[acc].cashNative, 110000);
  // Investment profit = Δ net worth − external flows
  const gain = (after.summary.netWorth - before.summary.netWorth) - (after.summary.netFlows - before.summary.netFlows);
  assert.equal(gain, 0);
  assert.equal(after.summary.realized, 0);
  assert.equal(after.summary.unrealized, 0);
  assert.equal(after.summary.deposits, 10000);
});

test('Test B — withdrawal decreases balance; fee is separate', () => {
  const app = makeApp();
  const acc = phpAccount(app, 'GCash', 110000, 'EWALLET');
  app.must('postTransaction', { type: 'WITHDRAWAL', account_id: acc, gross_amount: 5000, occurred_at: T1 });
  assert.equal(app.state().accounts[acc].cashNative, 105000);
  app.must('postTransaction', { type: 'WITHDRAWAL', account_id: acc, gross_amount: 1000, fee: 15, occurred_at: T2 });
  const s = app.state();
  assert.equal(s.accounts[acc].cashNative, 103985);
  assert.equal(s.summary.fees, 15);
  assert.equal(s.summary.withdrawals, 6000); // fee is not a withdrawal
});

test('Test C — internal transfer leaves combined balance unchanged before fees; not a flow', () => {
  const app = makeApp();
  const a = phpAccount(app, 'A', 50000), b = phpAccount(app, 'B', 20000);
  const before = app.state();
  const res = app.must('postTransfer', { from_account_id: a, to_account_id: b, amount: 10000, occurred_at: T1 });
  const after = app.state();
  assert.equal(after.accounts[a].cashNative, 40000);
  assert.equal(after.accounts[b].cashNative, 30000);
  assert.equal(after.summary.netWorth, before.summary.netWorth);
  assert.equal(after.summary.netFlows, before.summary.netFlows);
  assert.equal(after.summary.deposits, 0);
  assert.equal(after.summary.income, 0);
  assert.equal(res.transactions.length, 2);
  assert.equal(res.transactions[0].link_id, res.transactions[1].link_id);
  // with fee: combined drops by exactly the fee
  app.must('postTransfer', { from_account_id: a, to_account_id: b, amount: 1000, fee: 25, occurred_at: T2 });
  const s = app.state();
  assert.equal(s.accounts[a].cashNative + s.accounts[b].cashNative, 70000 - 25);
});

test('Test D — unrealized profit on BTC', () => {
  const app = makeApp();
  const acc = phpAccount(app, 'Coins.ph', 3000000, 'EXCHANGE');
  const btc = app.must('createAsset', { name: 'Bitcoin', ticker: 'BTC', asset_class: 'CRYPTO', currency: 'PHP' }).asset.asset_id;
  app.must('postTransaction', { type: 'BUY', account_id: acc, asset_id: btc, quantity: 1, unit_price: 3000000, occurred_at: T1 });
  app.must('addPrice', { asset_id: btc, price: 3300000, as_of: T2 });
  const s = app.state();
  const pos = s.byAsset.find((x) => x.asset_id === btc);
  assert.equal(pos.valueBase, 3300000);
  assert.equal(pos.costBase, 3000000);
  assert.equal(pos.unrealizedBase, 300000);
  assert.equal(s.summary.cash, 0);
  assert.equal(s.summary.netWorth, 3300000); // cash spent is not double-counted with the coin
});

test('Test E — partial sale under weighted-average cost', () => {
  const app = makeApp();
  const acc = phpAccount(app, 'COL Financial', 10000, 'BROKERAGE');
  const stk = app.must('createAsset', { name: 'Example Corp', ticker: 'EXMP', asset_class: 'STOCK', exchange: 'PSE', currency: 'PHP' }).asset.asset_id;
  app.must('postTransaction', { type: 'BUY', account_id: acc, asset_id: stk, quantity: 10, unit_price: 100, occurred_at: T1 });
  app.must('postTransaction', { type: 'SELL', account_id: acc, asset_id: stk, quantity: 4, unit_price: 120, occurred_at: T2 });
  const s = app.state();
  const pos = s.byAsset.find((x) => x.asset_id === stk);
  assert.equal(pos.qty, 6);
  assert.equal(pos.costBase, 600);
  assert.equal(s.summary.realizedGross, 80);
  assert.equal(s.summary.realized, 80);
  assert.equal(s.accounts[acc].cashNative, 10000 - 1000 + 480);
});

test('Test E2 — fees are capitalised on buy and deducted on sell (no double counting)', () => {
  const app = makeApp();
  const acc = phpAccount(app, 'Broker', 10000, 'BROKERAGE');
  const stk = app.must('createAsset', { name: 'Fee Corp', ticker: 'FEE', asset_class: 'STOCK', currency: 'PHP' }).asset.asset_id;
  app.must('postTransaction', { type: 'BUY', account_id: acc, asset_id: stk, quantity: 10, unit_price: 100, fee: 20, occurred_at: T1 });
  app.must('postTransaction', { type: 'SELL', account_id: acc, asset_id: stk, quantity: 4, unit_price: 120, fee: 10, occurred_at: T2 });
  const s = app.state();
  const pos = s.byAsset.find((x) => x.asset_id === stk);
  assert.equal(pos.costBase, 612);           // (1000 + 20) × 6/10
  assert.equal(s.summary.realized, 62);      // 480 − 10 − 408
  assert.equal(s.summary.realizedGross, 72); // 480 − 408
  assert.equal(s.summary.fees, 30);
  // net worth identity: cash + value (last trade 120 × 6 = 720)
  assert.equal(s.summary.netWorth, 10000 - 1020 + 470 + 720);
  const gain = s.summary.netWorth - s.summary.netFlows;
  assert.equal(gain, Core.base2(s.summary.realized + s.summary.unrealized));
});

test('Test F — deposits are not performance (TWR and Modified Dietz)', () => {
  const tz = 'Asia/Manila';
  const vals = [
    { t: Core.endOfLocalDayMs('2026-10-01', tz), value: 200000 },
    { t: Core.endOfLocalDayMs('2026-10-02', tz), value: 250000 }
  ];
  const events = [{ t: Date.parse('2026-10-02T03:00:00Z'), type: 'DEPOSIT', flow: 50000, income: 0, fee: 0, realized: 0, transfer: 0 }];
  for (const m of ['TWR', 'MODIFIED_DIETZ']) {
    const p = Core.performance(vals, events, vals[0].t, vals[1].t, m);
    assert.equal(p.gain, 0, m);
    assert.equal(p.returnPct, 0, m);
    assert.equal(p.netFlows, 50000, m);
  }
  // with real market movement: +10% then deposit
  const v2 = [{ t: 1, value: 100000 }, { t: 2, value: 110000 }, { t: 3, value: 160000 }];
  const e2 = [{ t: 3, type: 'DEPOSIT', flow: 50000, income: 0, fee: 0, realized: 0, transfer: 0 }];
  const p2 = Core.performance(v2, e2, 1, 3, 'TWR');
  assert.equal(p2.gain, 10000);
  assert.equal(p2.returnPct, 10);
});

test('Test F (end-to-end) — snapshot-based performance ignores deposits', () => {
  const app = makeApp();
  const acc = phpAccount(app, 'Bank', 200000);
  app.setNow(Date.parse('2026-10-01T15:00:00Z'));
  app.must('takeSnapshot', { date: '2026-10-01' });
  app.setNow(Date.parse('2026-10-02T04:00:00Z'));
  app.must('postTransaction', { type: 'DEPOSIT', account_id: acc, gross_amount: 50000, occurred_at: '2026-10-02T03:00:00Z' });
  app.setNow(Date.parse('2026-10-02T15:00:00Z'));
  app.must('takeSnapshot', { date: '2026-10-02' });
  const d = app.data();
  const st = app.state();
  const series = Core.snapshotSeries(d.snapshots, 'Asia/Manila');
  assert.deepEqual(series.map((x) => x.value), [200000, 250000]);
  const p = Core.performance(series, st.events, series[0].t, series[1].t, 'TWR');
  assert.equal(p.gain, 0);
  assert.equal(p.returnPct, 0);
});

test('Test J — foreign currency converts at recorded FX, never added raw', () => {
  const app = makeApp();
  const php = phpAccount(app, 'Bank', 1000);
  // USDT exchange account opened with FX 58.00 PHP per USDT
  const usdt = app.must('createAccount', { name: 'Binance', type: 'EXCHANGE', currency: 'USDT', opening_balance: 100, opening_date: T0, opening_fx_rate: 58 }).account.account_id;
  let s = app.state();
  assert.equal(s.accounts[usdt].cashNative, 100);
  assert.equal(s.accounts[usdt].cashBase, 5800);
  assert.equal(s.summary.netWorth, 6800);
  assert.notEqual(s.summary.netWorth, 1100);
  // a newer recorded FX rate revalues the balance
  app.must('addFxRate', { currency: 'USDT', rate: 57.5, as_of: T1 });
  s = app.state();
  assert.equal(s.accounts[usdt].cashBase, 5750);
  // valuation as of an earlier date uses the rate in force then
  const sOld = app.state(Date.parse(T0) + 1000);
  assert.equal(sOld.accounts[usdt].cashBase, 5800);
  // foreign deposit without FX is rejected
  const r = app.api('postTransaction', { type: 'DEPOSIT', account_id: usdt, gross_amount: 10, occurred_at: T2 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  void php;
});

test('Test J2 — missing FX excludes the balance and flags it (no raw addition)', () => {
  const data = {
    settings: { base_currency: 'PHP' },
    accounts: [{ account_id: 'A1', type: 'BANK', currency: 'PHP' }, { account_id: 'A2', type: 'BANK', currency: 'JPY' }],
    assets: [], prices: [], fx: [],
    transactions: [
      { tx_id: 't1', type: 'OPENING_BALANCE', occurred_at: T0, account_id: 'A1', gross_amount: 1000, currency: 'PHP', fx_rate: 1 },
      { tx_id: 't2', type: 'OPENING_BALANCE', occurred_at: T0, account_id: 'A2', gross_amount: 50000, currency: 'JPY', fx_rate: 0 }
    ]
  };
  const s = Core.computeState(data, { asOf: Infinity });
  assert.equal(s.summary.netWorth, 1000);
  assert.equal(s.quality.missingFx.length, 1);
});

test('Missing and stale prices are flagged, never invented', () => {
  const app = makeApp();
  const acc = phpAccount(app, 'Wallet', 0, 'WALLET');
  const eth = app.must('createAsset', { name: 'Ether', ticker: 'ETH', asset_class: 'CRYPTO', currency: 'PHP' }).asset.asset_id;
  app.must('postTransaction', { type: 'ADD_POSITION', account_id: acc, asset_id: eth, quantity: 2, gross_amount: 200000, occurred_at: T0 });
  let s = app.state();
  const p = s.byAsset.find((x) => x.asset_id === eth);
  assert.equal(p.valuedAtCost, true);
  assert.equal(p.valueBase, 200000);
  assert.equal(s.quality.missingPrice.length, 1);
  app.must('addPrice', { asset_id: eth, price: 150000, as_of: T0 });
  s = Core.computeState(app.data(), { asOf: Date.parse('2026-10-14T00:00:00Z') });
  assert.equal(s.quality.missingPrice.length, 0);
  assert.equal(s.quality.stalePrice.length, 1);
  assert.equal(s.byAsset[0].valueBase, 300000);
});

test('Liabilities reduce net worth; net worth = assets − liabilities', () => {
  const app = makeApp();
  phpAccount(app, 'Bank', 500000);
  const card = app.must('createAccount', { name: 'Credit card', type: 'LIABILITY', currency: 'PHP', opening_balance: -45000, opening_date: T0 }).account.account_id;
  app.must('postTransaction', { type: 'DEPOSIT', account_id: card, gross_amount: 5000, occurred_at: T1, remarks: 'payment from outside' });
  const s = app.state();
  assert.equal(s.summary.liabilities, 40000);
  assert.equal(s.summary.totalAssets, 500000);
  assert.equal(s.summary.netWorth, 460000);
});

test('Reconcile to statement balance creates a signed adjustment', () => {
  const app = makeApp();
  const acc = phpAccount(app, 'Maya', 1000, 'EWALLET');
  app.must('postTransaction', { type: 'RECONCILE', account_id: acc, actual_balance: 1012.5, occurred_at: T1, category: 'NON_FLOW', remarks: 'interest found on statement' });
  let s = app.state();
  assert.equal(s.accounts[acc].cashNative, 1012.5);
  assert.equal(s.summary.netFlows, 1000); // NON_FLOW adjustment counts as gain, not deposit
  app.must('postTransaction', { type: 'RECONCILE', account_id: acc, actual_balance: 900, occurred_at: T2 });
  s = app.state();
  assert.equal(s.accounts[acc].cashNative, 900);
  assert.equal(s.summary.netFlows, Core.base2(1000 - 112.5)); // default FLOW
});

test('Crypto transfer between own wallets is not a sale; cost basis moves with coins', () => {
  const app = makeApp();
  const ex = phpAccount(app, 'Exchange', 100000, 'EXCHANGE');
  const w = phpAccount(app, 'Ledger wallet', 0, 'WALLET');
  const btc = app.must('createAsset', { name: 'Bitcoin', ticker: 'BTC', asset_class: 'CRYPTO', currency: 'PHP' }).asset.asset_id;
  app.must('postTransaction', { type: 'BUY', account_id: ex, asset_id: btc, quantity: 0.02, unit_price: 3000000, occurred_at: T1 });
  const before = app.state();
  app.must('postAssetTransfer', { asset_id: btc, from_account_id: ex, to_account_id: w, quantity: 0.02, fee_quantity: 0.0001, occurred_at: T2 });
  const s = app.state();
  const pos = s.positions.filter((p) => p.asset_id === btc);
  assert.equal(pos.length, 1);
  assert.equal(pos[0].account_id, w);
  assert.equal(pos[0].qty, 0.0199);
  assert.equal(pos[0].costBase, 60000);
  assert.equal(s.summary.realized, 0);
  assert.equal(s.summary.netFlows, before.summary.netFlows);
});

test('In-kind staking income adds units at fair value and counts as income', () => {
  const app = makeApp();
  const w = phpAccount(app, 'Wallet', 0, 'WALLET');
  const sol = app.must('createAsset', { name: 'Solana', ticker: 'SOL', asset_class: 'CRYPTO', currency: 'PHP' }).asset.asset_id;
  app.must('postTransaction', { type: 'ADD_POSITION', account_id: w, asset_id: sol, quantity: 10, gross_amount: 80000, unit_price: 9000, occurred_at: T0 });
  app.must('postTransaction', { type: 'INCOME', account_id: w, asset_id: sol, quantity: 0.1, gross_amount: 900, category: 'STAKING', occurred_at: T1 });
  const s = app.state();
  const p = s.byAsset.find((x) => x.asset_id === sol);
  assert.equal(p.qty, 10.1);
  assert.equal(p.costBase, 80900);
  assert.equal(s.summary.income, 900);
  assert.equal(s.summary.netFlows, 90000); // position added at market value
});

test('Rounding: currency decimals and float dust', () => {
  assert.equal(Core.money(0.1 + 0.2, 'PHP'), 0.3);
  assert.equal(Core.money(1.005, 'PHP'), 1.01);
  assert.equal(Core.money(123.4567891, 'USDT'), 123.456789);
  assert.equal(Core.money(1234.5, 'JPY'), 1235);
  assert.equal(Core.qty(0.1 + 0.2), 0.3);
  assert.equal(Object.is(Core.round(-0.0000001, 2), -0), false);
});

test('Dates: DD MMM YYYY in Asia/Manila', () => {
  assert.equal(Core.formatDate('2026-10-13T16:30:00Z', 'Asia/Manila'), '14 Oct 2026');
  assert.equal(Core.localDate('2026-10-13T15:59:59Z', 'Asia/Manila'), '2026-10-13');
  assert.equal(Core.localDate('2026-10-13T16:00:00Z', 'Asia/Manila'), '2026-10-14');
  assert.equal(new Date(Core.endOfLocalDayMs('2026-10-14', 'Asia/Manila')).toISOString(), '2026-10-14T15:59:59.999Z');
  assert.equal(Core.formatDateStr('2026-01-05'), '05 Jan 2026');
});

test('Planning math: future value, months to target, required contribution', () => {
  assert.equal(Core.futureValue(100000, 0, 0, 12), 100000);
  assert.equal(Core.futureValue(0, 1000, 0, 12), 12000);
  assert.equal(Core.futureValue(100000, 0, 12, 12), 112000); // effective annual rate
  assert.equal(Core.monthsToTarget(1000000, 100000, 0, 5000000), 40);
  assert.equal(Core.monthsToTarget(6000000, 0, 0, 5000000), 0);
  assert.equal(Core.monthsToTarget(100, 0, 0, 5000000), null);
  const req = Core.requiredMonthly(1000000, 5000000, 8, 60);
  const fv = Core.futureValue(1000000, req, 8, 60);
  assert.ok(Math.abs(fv - 5000000) < 1, 'required contribution reaches target: ' + fv);
  assert.equal(Core.inflationAdjusted(5000000, 4, 0), 5000000);
  assert.equal(Core.inflationAdjusted(100, 10, 2), 121);
  const g = Core.evaluateGoal({ target_amount: 5000000, monthly_contribution: 100000, expected_return: 0, target_date: '2030-01-14' }, { netWorth: 1000000 }, '2026-10-14');
  assert.equal(g.progressPct, 20);
  assert.equal(g.remaining, 4000000);
  assert.equal(g.monthsToTarget, 40);
  assert.equal(g.projectedDate, '2030-02-14');
  assert.equal(g.status, 'BEHIND');
});

test('Allocation vs target and concentration risk', () => {
  const rows = Core.allocationVsTarget({ CASH: 50, CRYPTO: 50, STOCK: 0, BUSINESS: 0, PROPERTY: 0, OTHER: 0 }, { CASH: 20, CRYPTO: 30, STOCK: 50 });
  assert.equal(rows.find((r) => r.bucket === 'CASH').driftPct, 30);
  const c = Core.concentration([{ asset_id: 'x', name: 'X', valueBase: 40 }, { asset_id: 'y', name: 'Y', valueBase: 10 }], 100, 25);
  assert.deepEqual(c.map((x) => x.asset_id), ['x']);
});

test('CSV export neutralises formula injection but keeps numbers', () => {
  const csv = Core.toCsv([{ a: '=HYPERLINK("http://x")', b: -500, c: '+1', d: 'ok, "quoted"' }], [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }]);
  const line = csv.split('\r\n')[1];
  assert.ok(line.startsWith('"\'=HYPERLINK'));
  assert.ok(line.includes(',-500,'));
  assert.ok(line.includes("'+1"));
  assert.ok(line.endsWith('"ok, ""quoted"""'));
});

test('Masking account references', () => {
  assert.equal(Core.maskRef('1234-5678-9012'), '•••• 9012');
  assert.equal(Core.maskRef('12'), '••••');
  assert.equal(Core.maskRef(''), '');
});

test('A recorded price at the same timestamp as a trade takes precedence', () => {
  const T = '2026-10-02T02:00:00Z';
  const data = {
    settings: { base_currency: 'PHP' },
    accounts: [{ account_id: 'A', type: 'BANK', currency: 'PHP' }],
    assets: [{ asset_id: 'X', asset_class: 'CRYPTO', currency: 'PHP' }],
    prices: [{ asset_id: 'X', price: 110, currency: 'PHP', as_of: T, source: 'MANUAL' }], fx: [],
    transactions: [
      { tx_id: 't0', type: 'OPENING_BALANCE', occurred_at: '2026-10-01T00:00:00Z', account_id: 'A', gross_amount: 1000, currency: 'PHP', fx_rate: 1 },
      { tx_id: 't1', type: 'BUY', occurred_at: T, account_id: 'A', asset_id: 'X', quantity: 1, unit_price: 100, currency: 'PHP', fx_rate: 1 }
    ]
  };
  const s = Core.computeState(data, { asOf: Infinity });
  assert.equal(s.byAsset[0].valueBase, 110);
  assert.equal(s.byAsset[0].priceSource, 'MANUAL');
});
