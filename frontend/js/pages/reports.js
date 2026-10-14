import { html, mount, $, download } from '../utils/dom.js';
import * as F from '../utils/format.js';
import { store } from '../state.js';
import { dataTable, modal, toast, errorMessage } from '../components/ui.js';
import { periodReport, monthlyPerformance, monthLabel, BUCKET_LABELS } from '../services/analytics.js';
const Core = window.WealthCore;

const TYPES = [
  ['summary', 'Monthly portfolio summary'], ['balances', 'Account balances'], ['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'],
  ['transfers', 'Internal transfers'], ['crypto', 'Crypto performance'], ['stocks', 'Stock performance'], ['other', 'Other asset valuations'],
  ['pnl', 'Realized & unrealized P&L'], ['feesincome', 'Fees & investment income'], ['networth', 'Net worth history'], ['monthly', 'Monthly performance & cash flow']
];
const ui = { type: 'summary', month: null, from: '', to: '', mode: 'month' };

function range() {
  const tz = store.tz;
  if (ui.mode === 'custom' && ui.from && ui.to) return { from: Core.endOfLocalDayMs(Core.addDays(ui.from, -1), tz), to: Math.min(Date.now(), Core.endOfLocalDayMs(ui.to, tz)), label: F.dateStr(ui.from) + ' – ' + F.dateStr(ui.to), fromStr: ui.from, toStr: ui.to };
  const m = ui.month || F.today().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const first = m + '-01';
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  return { from: Core.endOfLocalDayMs(Core.addDays(first, -1), tz), to: Math.min(Date.now(), Core.endOfLocalDayMs(last, tz)), label: monthLabel(m).replace(/ (\d\d)$/, ' 20$1'), fromStr: first, toStr: last };
}
const inRange = (t, r) => t > r.from && t <= r.to;
const P = (v) => F.php(v);

/** Every report as {title, columns, rows}; used for screen, CSV and XLSX. */
function build(type, r, rep) {
  const txs = store.txs().filter((t) => Core.isEffective(t) && inRange(t.t, r));
  const acc = (id) => store.account(id)?.name || id;
  const ast = (id) => store.asset(id)?.ticker || store.asset(id)?.name || '';
  const base = (t) => Core.base2((t.type === 'BUY' || t.type === 'SELL' ? t.quantity * t.unit_price : t.gross_amount) * t.fx_rate);
  const close = rep.close;
  const realizedBy = {}; store.live.events.forEach((e) => { if (inRange(e.t, r) && e.realized) realizedBy[e.asset_id] = (realizedBy[e.asset_id] || 0) + e.realized; });
  const posRows = (cls) => close.byAsset.filter((a) => cls === 'ALL' || a.asset_class === cls).map((a) => ({ asset: a.ticker || a.name, name: a.name, qty: a.qty, avg_cost: Core.base2(a.avgCostBase), cost_basis: a.costBase, price: a.price, price_ccy: a.priceCurrency || '', price_as_of: a.priceAsOf ? F.dateTime(a.priceAsOf) : '', price_source: a.valuedAtCost ? 'NO PRICE (at cost)' : a.priceSource || '', estimate: a.isEstimate ? 'yes' : '', value: a.valueBase, unrealized: a.unrealizedBase, return_pct: a.returnPct === null ? '' : Core.round(a.returnPct, 2), realized_period: Core.base2(realizedBy[a.asset_id] || 0), income_all_time: a.incomeBase }));
  const posCols = [['asset', 'Asset'], ['qty', 'Quantity', 'q'], ['avg_cost', 'Avg cost', 'm'], ['cost_basis', 'Cost basis', 'm'], ['price', 'Price', 'n'], ['price_ccy', 'Price ccy'], ['price_as_of', 'Price as of'], ['price_source', 'Source'], ['value', 'Market value', 'm'], ['unrealized', 'Unrealized', 'pl'], ['return_pct', 'Return %', 'pct'], ['realized_period', 'Realized (period)', 'pl']];
  const txRows = (list) => list.map((t) => ({ date: F.dateTime(t.occurred_at), type: F.typeLabel(t.type), account: acc(t.account_id), counter: t.counter_account_id ? acc(t.counter_account_id) : '', asset: ast(t.asset_id), amount: t.gross_amount, fee: t.fee, currency: t.currency, fx: t.fx_rate, base: base(t), reference: t.reference_no, remarks: t.remarks, tx_id: t.tx_id, link_id: t.link_id }));
  const txCols = [['date', 'Date'], ['type', 'Type'], ['account', 'Account'], ['amount', 'Amount', 'n'], ['fee', 'Fee', 'n'], ['currency', 'Ccy'], ['fx', 'FX', 'n'], ['base', store.base + ' equiv.', 'm'], ['reference', 'Reference'], ['remarks', 'Remarks'], ['tx_id', 'Transaction ID']];
  switch (type) {
    case 'summary': {
      const mp = monthlyPerformance().filter((m) => m.month >= r.fromStr.slice(0, 7) && m.month <= r.toStr.slice(0, 7));
      const total = Object.values(close.allocation).reduce((a, b) => a + b, 0);
      return { title: 'Closing asset allocation', columns: [['bucket', 'Category'], ['value', 'Value', 'm'], ['pct', '% of assets', 'pct']], rows: Object.entries(close.allocation).map(([k, v]) => ({ bucket: BUCKET_LABELS[k], value: v, pct: total ? Core.round(v / total * 100, 2) : 0 })), extra: mp };
    }
    case 'balances': return { title: 'Account balances at close', columns: [['account', 'Account'], ['type', 'Type'], ['currency', 'Ccy'], ['open_cash', 'Opening cash', 'n'], ['close_cash', 'Closing cash', 'n'], ['fx', 'FX at close', 'n'], ['cash_base', 'Cash ' + store.base, 'm'], ['holdings', 'Holdings ' + store.base, 'm'], ['total', 'Total ' + store.base, 'm']],
      rows: store.data.accounts.map((a) => { const v = close.accounts[a.account_id] || {}; return { account: a.name, type: F.accountTypeLabel(a.type), currency: a.currency, open_cash: rep.open ? rep.open.cashNative[a.account_id] || 0 : 0, close_cash: v.cashNative || 0, fx: v.fxRate || (a.currency === store.base ? 1 : ''), cash_base: v.cashBase || 0, holdings: v.holdingsBase || 0, total: v.totalBase || 0 }; }).filter((x) => x.open_cash || x.close_cash || x.holdings) };
    case 'deposits': return { title: 'External deposits', columns: txCols, rows: txRows(txs.filter((t) => t.type === 'DEPOSIT' || t.type === 'OPENING_BALANCE')) };
    case 'withdrawals': return { title: 'External withdrawals', columns: txCols, rows: txRows(txs.filter((t) => t.type === 'WITHDRAWAL')) };
    case 'transfers': {
      const outs = txs.filter((t) => t.type === 'TRANSFER_OUT' || t.type === 'ASSET_TRANSFER_OUT');
      const all = store.txs();
      return { title: 'Internal transfers (not counted as flows)', columns: [['date', 'Date'], ['from', 'From'], ['to', 'To'], ['what', 'Asset / ccy'], ['sent', 'Sent', 'n'], ['received', 'Received', 'n'], ['fee', 'Fee', 'n'], ['link_id', 'Transfer ID']],
        rows: outs.map((o) => { const i = all.find((x) => x.link_id === o.link_id && x.tx_id !== o.tx_id) || {}; const isA = o.type === 'ASSET_TRANSFER_OUT'; return { date: F.dateTime(o.occurred_at), from: acc(o.account_id), to: acc(i.account_id), what: isA ? ast(o.asset_id) : o.currency + (i.currency && i.currency !== o.currency ? ' → ' + i.currency : ''), sent: isA ? o.quantity : o.gross_amount, received: isA ? i.quantity : i.gross_amount, fee: o.fee, link_id: o.link_id }; }) };
    }
    case 'crypto': return { title: 'Crypto positions at close', columns: posCols, rows: posRows('CRYPTO') };
    case 'stocks': return { title: 'Stock positions at close', columns: posCols, rows: posRows('STOCK') };
    case 'other': return { title: 'Other asset valuations at close', columns: [['asset', 'Asset'], ['qty', 'Quantity / %', 'q'], ['cost_basis', 'Cost basis', 'm'], ['value', 'Estimated value', 'm'], ['price_as_of', 'Valuation date'], ['price_source', 'Source'], ['estimate', 'Estimate'], ['unrealized', 'Unrealized', 'pl']], rows: posRows('OTHER') };
    case 'pnl': return { title: 'P&L by asset (realized in period, unrealized at close)', columns: [['asset', 'Asset'], ['cost_basis', 'Cost basis', 'm'], ['value', 'Value', 'm'], ['unrealized', 'Unrealized', 'pl'], ['return_pct', 'Return %', 'pct'], ['realized_period', 'Realized in period', 'pl']], rows: [...posRows('ALL'), ...Object.keys(realizedBy).filter((id) => !close.byAsset.find((a) => a.asset_id === id)).map((id) => ({ asset: ast(id), cost_basis: 0, value: 0, unrealized: 0, return_pct: '', realized_period: Core.base2(realizedBy[id]) }))] };
    case 'feesincome': {
      const evs = store.live.events.filter((e) => inRange(e.t, r) && (e.fee || e.income));
      const byId = new Map(store.txs().map((t) => [t.tx_id, t]));
      return { title: 'Fees and investment income', columns: [['date', 'Date'], ['type', 'Type'], ['account', 'Account'], ['asset', 'Asset'], ['income', 'Income ' + store.base, 'm'], ['fee', 'Fees ' + store.base, 'm'], ['remarks', 'Remarks']],
        rows: evs.map((e) => { const t = byId.get(e.tx_id) || {}; return { date: F.dateTime(t.occurred_at), type: F.typeLabel(e.type) + (t.category ? ' · ' + t.category.toLowerCase() : ''), account: acc(e.account_id), asset: ast(e.asset_id), income: Core.base2(e.income), fee: Core.base2(e.fee), remarks: t.remarks }; }) };
    }
    case 'networth': return { title: 'Daily snapshots in period', columns: [['date', 'Date'], ['net_worth', 'Net worth', 'm'], ['assets', 'Assets', 'm'], ['liabilities', 'Liabilities', 'm'], ['cash', 'Cash', 'm'], ['crypto', 'Crypto', 'm'], ['stocks', 'Stocks', 'm'], ['other', 'Other', 'm'], ['flow', 'Net flow (day)', 'm'], ['quality', 'Data quality']],
      rows: store.snapshots().filter((s) => s.snapshot_date >= r.fromStr && s.snapshot_date <= r.toStr).map((s) => { let q = {}; try { q = JSON.parse(s.quality_json || '{}'); } catch { q = {}; } return { date: F.dateStr(s.snapshot_date), net_worth: s.net_worth, assets: s.total_assets, liabilities: s.total_liabilities, cash: s.cash_value, crypto: s.crypto_value, stocks: s.stock_value, other: s.other_value, flow: s.net_flow_day, quality: [q.missingPrice ? q.missingPrice + ' no price' : '', q.stalePrice ? q.stalePrice + ' stale' : '', q.missingFx ? q.missingFx + ' no FX' : '', q.estimates ? q.estimates + ' estimates' : ''].filter(Boolean).join(', ') || 'ok' }; }) };
    case 'monthly': {
      const mp = new Map(monthlyPerformance().map((m) => [m.month, m]));
      const mf = Core.monthlyFlows(store.live.events, store.tz).filter((m) => m.month >= r.fromStr.slice(0, 7) && m.month <= r.toStr.slice(0, 7));
      const months = [...new Set([...mf.map((m) => m.month), ...[...mp.keys()].filter((k) => k >= r.fromStr.slice(0, 7) && k <= r.toStr.slice(0, 7))])].sort();
      return { title: 'Monthly performance and cash flow', columns: [['month', 'Month'], ['deposits', 'Deposits', 'm'], ['withdrawals', 'Withdrawals', 'm'], ['net_flows', 'Net flows', 'm'], ['transfers', 'Internal transfers', 'm'], ['income', 'Income', 'm'], ['fees', 'Fees', 'm'], ['realized', 'Realized', 'pl'], ['gain', 'Investment result', 'pl'], ['return_pct', 'Return %', 'pct']],
        rows: months.map((k) => { const f = mf.find((x) => x.month === k) || {}; const p = mp.get(k) || {}; return { month: monthLabel(k), deposits: f.deposits || 0, withdrawals: f.withdrawals || 0, net_flows: f.netFlows || 0, transfers: f.transfers || 0, income: f.income || 0, fees: f.fees || 0, realized: f.realized || 0, gain: p.gain ?? '', return_pct: p.returnPct ?? '' }; }) };
    }
  }
  return { title: '', columns: [], rows: [] };
}

function renderCell(kind, v) {
  if (v === '' || v === null || v === undefined) return html`<span class="muted">—</span>`;
  if (kind === 'm') return F.php(v);
  if (kind === 'pl') return F.pl(v);
  if (kind === 'pct') return F.pct(v);
  if (kind === 'q') return F.qty(v);
  if (kind === 'n') return typeof v === 'number' ? F.qty(v) : v;
  return v;
}

function summaryBlock(r, rep) {
  const c = rep.close.summary, fl = rep.flows;
  const perf = store.performance('CUSTOM', { from: r.fromStr, to: r.toStr });
  const items = [['Opening net worth', P(rep.openNW)], ['Closing net worth', P(rep.closeNW)], ['Deposits + opening balances', P(fl.deposits + fl.opening)], ['External withdrawals', P(fl.withdrawals)], ['Other external flows', P(fl.positions + fl.reconcile)], ['Internal transfers (excluded)', P(fl.transfers)], ['Realized P&L (period)', F.pl(fl.realized)], ['Unrealized P&L (at close)', F.pl(c.unrealized)], ['Change in unrealized', F.pl(rep.unrealizedChange)], ['Investment income', P(fl.income)], ['Fees', P(fl.fees)], ['Investment result', F.pl(rep.gain)], ['Return', perf.available && perf.returnPct !== null ? F.pct(perf.returnPct) : '—']];
  return html`<div class="report-summary">${items.map(([k, v]) => html`<div><span class="muted">${k}</span><strong class="amt">${v}</strong></div>`)}</div>
    <p class="method-note muted"><strong>Method & limitations.</strong> Investment result = closing net worth − opening net worth − net external flows; deposits and withdrawals are never counted as profit, and internal transfers are excluded. Return % uses ${store.setting('performance_method', 'TWR') === 'TWR' ? 'time-weighted chain-linking of daily snapshots (flows assumed at end of day)' : 'Modified Dietz'}${perf.available ? `, using ${perf.snapshotPoints} snapshot point(s)` : ''}. Cost basis is weighted-average with fees capitalised. Values use recorded prices and FX rates as of each date; holdings without a price are valued at cost; manual valuations are estimates. ${perf.note || ''}</p>`;
}

export function render(root) {
  const r = range();
  const rep = periodReport(r.from, r.to);
  const def = build(ui.type, r, rep);
  const monthOpts = (() => { const out = []; let m = F.today().slice(0, 7); const first = store.firstTxMs(); const stop = first ? Core.localDate(first, store.tz).slice(0, 7) : m; for (let i = 0; i < 120; i++) { out.push(m); if (m <= stop) break; const [y, mo] = m.split('-').map(Number); m = mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'); } return out; })();
  mount(root, html`
    <div class="page-head no-print"><div><h1>Reports</h1><p class="muted">Every figure comes from your recorded ledger, prices and FX rates.</p></div>
      <div class="head-actions wrap"><button class="btn" id="r-csv">${F.icon('file')} CSV</button><button class="btn" id="r-xlsx">${F.icon('file')} Excel workbook</button><button class="btn primary" id="r-print">${F.icon('print')} Print / PDF</button></div></div>
    <div class="card filters no-print">
      <select id="r-type" aria-label="Report">${TYPES.map(([k, l]) => html`<option value="${k}" ${k === ui.type ? 'selected' : ''}>${l}</option>`)}</select>
      <select id="r-mode" aria-label="Period type"><option value="month" ${ui.mode === 'month' ? 'selected' : ''}>Month</option><option value="custom" ${ui.mode === 'custom' ? 'selected' : ''}>Custom range</option></select>
      ${ui.mode === 'month' ? html`<select id="r-month" aria-label="Month">${monthOpts.map((m) => html`<option value="${m}" ${m === (ui.month || monthOpts[0]) ? 'selected' : ''}>${monthLabel(m).replace(/ (\d\d)$/, ' 20$1')}</option>`)}</select>`
        : html`<input type="date" id="r-from" value="${ui.from || r.fromStr}" aria-label="From"><input type="date" id="r-to" value="${ui.to || r.toStr}" aria-label="To"><button class="btn sm" id="r-apply">Apply</button>`}
    </div>
    <article class="card report" id="report">
      <header class="report-head"><div><div class="muted sm">Personal Wealth OS · ${TYPES.find((t) => t[0] === ui.type)[1]}</div><h2>${r.label}</h2><div class="muted sm">${F.dateStr(r.fromStr)} – ${F.dateStr(r.toStr)} · ${store.base} · generated ${F.dateTime(Date.now())} (${store.tz})</div></div></header>
      ${summaryBlock(r, rep)}
      <h3>${def.title}</h3><div id="r-table"></div>
      ${ui.type === 'summary' && def.extra?.length ? html`<h3>Monthly breakdown</h3><table class="table"><thead><tr><th>Month</th><th class="r">Start</th><th class="r">End</th><th class="r">Net flows</th><th class="r">Result</th><th class="r">Return</th></tr></thead><tbody>${def.extra.map((m) => html`<tr><td>${monthLabel(m.month)}${m.partial ? '*' : ''}</td><td class="r">${P(m.startValue)}</td><td class="r">${P(m.endValue)}</td><td class="r">${P(m.netFlows)}</td><td class="r">${F.pl(m.gain)}</td><td class="r">${F.pct(m.returnPct)}</td></tr>`)}</tbody></table>` : ''}
    </article>`);
  dataTable($('#r-table'), { rows: def.rows, search: def.rows.length > 15, pageSize: 500, empty: 'No records in this period.', columns: def.columns.map(([k, l, kind]) => ({ key: k, label: l, align: kind ? 'r' : '', render: (row) => renderCell(kind, row[k]) })) });
  root.onchange = (e) => {
    if (e.target.id === 'r-type') { ui.type = e.target.value; render(root); }
    if (e.target.id === 'r-mode') { ui.mode = e.target.value; render(root); }
    if (e.target.id === 'r-month') { ui.month = e.target.value; render(root); }
  };
  root.onclick = async (e) => {
    if (e.target.id === 'r-apply') { const f = $('#r-from').value, t = $('#r-to').value; if (f && t && f <= t) { ui.from = f; ui.to = t; store.memo.clear(); render(root); } else toast('Choose a valid date range', 'error'); }
    if (e.target.closest('#r-print')) window.print();
    if (e.target.closest('#r-csv')) download(`${ui.type}-${r.fromStr}_${r.toStr}.csv`, Core.toCsv(def.rows, def.columns.map(([k, l]) => ({ key: k, label: l }))), 'text/csv;charset=utf-8');
    if (e.target.closest('#r-xlsx')) exportWorkbook(r);
  };
}

async function loadSheetJs() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx-0.18.5.full.min.js'; /* vendored SheetJS CE (Apache-2.0), loaded on demand */ s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel library. Use CSV instead.')); document.head.appendChild(s); });
  return window.XLSX;
}
/** Multi-sheet workbook with every report for the period plus the raw ledger. */
export async function exportWorkbook(r = range()) {
  try {
    const XLSX = await loadSheetJs();
    const rep = periodReport(r.from, r.to);
    const wb = XLSX.utils.book_new();
    const clean = (v) => Core.sanitizeCell(v);
    const s = rep.close.summary, fl = rep.flows;
    const summary = [['Personal Wealth OS — report'], ['Period', F.dateStr(r.fromStr) + ' – ' + F.dateStr(r.toStr)], ['Base currency', store.base], ['Generated', F.dateTime(Date.now()) + ' ' + store.tz], [],
      ['Opening net worth', rep.openNW], ['Closing net worth', rep.closeNW], ['External deposits', fl.deposits + fl.opening], ['External withdrawals', fl.withdrawals], ['Other external flows', fl.positions + fl.reconcile], ['Internal transfers (excluded)', fl.transfers], ['Realized P&L (period)', fl.realized], ['Unrealized P&L at close', s.unrealized], ['Investment income', fl.income], ['Fees', fl.fees], ['Investment result', rep.gain], [],
      ['Method', 'Result = closing − opening − net external flows. Deposits are not profit. Weighted-average cost; recorded prices/FX; unpriced holdings at cost; manual valuations are estimates.']];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary.map((row) => row.map(clean))), 'Summary');
    TYPES.forEach(([k, label]) => {
      const def = build(k, r, rep);
      const aoa = [def.columns.map((c) => c[1]), ...def.rows.map((row) => def.columns.map((c) => clean(row[c[0]])))];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), label.replace(/[^A-Za-z ]/g, '').slice(0, 31));
    });
    const cols = ['tx_id', 'occurred_at', 'type', 'status', 'account_id', 'counter_account_id', 'asset_id', 'quantity', 'unit_price', 'gross_amount', 'fee', 'net_amount', 'currency', 'fx_rate', 'base_amount', 'link_id', 'category', 'reference_no', 'remarks', 'reversal_of', 'replaces'];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, ...store.data.transactions.map((t) => cols.map((c) => clean(t[c])))]), 'Ledger');
    XLSX.writeFile(wb, `wealth-report-${r.fromStr}_${r.toStr}.xlsx`);
    toast('Workbook downloaded');
  } catch (e) { toast(errorMessage(e), 'error'); }
}

export function exportMenu() {
  modal({
    title: 'Export',
    body: html`<div class="chooser">
      <a class="choice" href="#/reports" data-close><strong>Monthly report</strong><span>View, print or save as PDF</span></a>
      <button type="button" class="choice" data-e="xlsx"><strong>Excel workbook</strong><span>This month: every report + full ledger</span></button>
      <button type="button" class="choice" data-e="csv"><strong>Transactions CSV</strong><span>Full ledger for Excel / Google Sheets</span></button>
      <a class="choice" href="#/settings" data-close><strong>Full backup</strong><span>JSON backup & restore in Settings</span></a></div>`,
    onOpen: (el) => el.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-e]')?.dataset.e;
      if (k === 'xlsx') exportWorkbook();
      if (k === 'csv') (await import('./transactions.js')).exportCsv(store.txs());
    })
  });
}
