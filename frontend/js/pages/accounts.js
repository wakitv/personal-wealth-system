import { html, mount, $ } from '../utils/dom.js';
import * as F from '../utils/format.js';
import { store } from '../state.js';
import { emptyState, chart, chartBox, dataTable, cssVar, toast, confirmDialog, errorMessage } from '../components/ui.js';
import { accountForm, cashTxForm, transferForm, assetTxForm, assetTransferForm } from '../components/forms.js';
import { txColumns } from './transactions.js';
import { monthLabel } from '../services/analytics.js';
const Core = window.WealthCore;
let showArchived = false;
let revealRefs = false;

const ref = (a) => (store.setting('mask_references', 'true') === 'true' && !revealRefs ? Core.maskRef(a.reference) : a.reference);

export function render(root, params) {
  if (params.id) return renderDetail(root, params.id);
  const st = store.live;
  const accounts = store.data.accounts.filter((a) => showArchived || a.status !== 'ARCHIVED');
  const groups = {};
  accounts.forEach((a) => { (groups[a.type] = groups[a.type] || []).push(a); });
  const total = (list) => list.reduce((s, a) => s + (st.accounts[a.account_id]?.totalBase || 0), 0);
  mount(root, html`
    <div class="page-head"><div><h1>Accounts & wallets</h1><p class="muted">Balances are calculated from the ledger. Account totals include assets held in them, counted once.</p></div>
      <div class="head-actions">
        <label class="check sm"><input type="checkbox" id="arch" ${showArchived ? 'checked' : ''}> <span>Show archived</span></label>
        <label class="check sm"><input type="checkbox" id="reveal" ${revealRefs ? 'checked' : ''}> <span>Reveal references</span></label>
        <button class="btn" data-a="transfer">${F.icon('swap')} Transfer</button>
        <button class="btn primary" data-a="add">${F.icon('plus')} Add account</button></div></div>
    ${!accounts.length ? emptyState('No accounts yet', 'Add GCash, Maya, your banks, exchanges like Binance or MEXC, wallets and cash on hand.', html`<button class="btn primary" data-a="add">Add account</button>`) : ''}
    ${Core.ACCOUNT_TYPES.filter((t) => groups[t]).map((t) => html`
      <section class="acct-group"><div class="group-head"><h2>${F.accountTypeLabel(t)}</h2><span class="amt">${F.php(total(groups[t]))}</span></div>
      <div class="grid g3">${groups[t].map((a) => {
        const v = st.accounts[a.account_id] || { cashNative: 0, cashBase: 0, holdingsBase: 0, totalBase: 0 };
        const last = store.txs().find((x) => x.account_id === a.account_id && x.type !== 'REVERSAL');
        return html`<a class="card acct ${a.status === 'ARCHIVED' ? 'archived' : ''}" href="#/accounts/${a.account_id}">
          <div class="acct-top"><div><strong>${a.name}</strong><div class="muted sm">${a.institution || F.accountTypeLabel(a.type)}${a.reference ? ' · ' + ref(a) : ''}</div></div>${F.badge(a.currency)}</div>
          <div class="acct-bal amt">${F.money(v.cashNative, a.currency)}</div>
          <div class="muted sm">${a.currency !== store.base ? (v.fxMissing ? 'No FX rate recorded — not included in totals' : '≈ ' + F.php(v.cashBase) + ' · rate ' + F.qty(v.fxRate) + ' ' + store.base) : 'Cash balance'}</div>
          ${v.holdingsBase ? html`<div class="acct-hold sm">+ holdings ${F.php(v.holdingsBase)} → <strong class="amt">${F.php(v.totalBase)}</strong></div>` : ''}
          <div class="muted xs">${last ? 'Last activity ' + F.date(last.occurred_at) : 'No activity'}${a.status === 'ARCHIVED' ? ' · archived' : ''}</div></a>`;
      })}</div></section>`)}`);
  root.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'add') accountForm();
    if (a === 'transfer') transferForm();
  };
  root.onchange = (e) => {
    if (e.target.id === 'arch') { showArchived = e.target.checked; render(root, params); }
    if (e.target.id === 'reveal') { revealRefs = e.target.checked; render(root, params); }
  };
}

function renderDetail(root, id) {
  const a = store.account(id);
  if (!a) { mount(root, emptyState('Account not found', 'It may have been removed from this view.', html`<a class="btn" href="#/accounts">Back to accounts</a>`)); return; }
  const v = store.live.accounts[id] || { cashNative: 0, cashBase: 0, holdingsBase: 0, totalBase: 0, holdings: [] };
  const txs = store.txs().filter((t) => t.account_id === id);
  const eff = txs.filter(Core.isEffective);
  const ev = store.live.events.filter((e) => e.account_id === id);
  const sums = (type) => Core.base2(eff.filter((t) => t.type === type).reduce((s, t) => s + t.gross_amount, 0));
  const archived = a.status === 'ARCHIVED';
  mount(root, html`
    <div class="page-head"><div><a href="#/accounts" class="back sm">← Accounts</a><h1>${a.name}</h1>
      <p class="muted">${F.accountTypeLabel(a.type)}${a.institution ? ' · ' + a.institution : ''}${a.reference ? ' · ' + ref(a) : ''} · ${a.currency}${archived ? ' · archived' : ''}</p></div>
      <div class="head-actions wrap">
        ${archived ? '' : html`<button class="btn sm" data-a="DEPOSIT">${F.icon('down')} Deposit</button><button class="btn sm" data-a="WITHDRAWAL">${F.icon('up')} Withdraw</button><button class="btn sm" data-a="transfer">${F.icon('swap')} Transfer</button><button class="btn sm" data-a="RECONCILE">${F.icon('scale')} Update balance</button><button class="btn sm" data-a="BUY">Buy</button><button class="btn sm" data-a="SELL">Sell</button><button class="btn sm" data-a="INCOME">Income</button><button class="btn sm" data-a="FEE">Fee</button>${v.holdings.length ? html`<button class="btn sm" data-a="atransfer">Move asset</button>` : ''}`}
        <button class="btn sm ghost" data-a="edit">Edit</button><button class="btn sm ghost" data-a="archive">${archived ? 'Restore' : 'Archive'}</button></div></div>
    <section class="grid g4">
      <div class="card stat"><div class="stat-label">Cash balance</div><div class="stat-value amt">${F.money(v.cashNative, a.currency)}</div><div class="stat-sub">${a.currency !== store.base ? (v.fxMissing ? 'No FX rate — record one in Settings' : '≈ ' + F.php(v.cashBase) + ' · rate ' + F.qty(v.fxRate) + ' (' + F.date(v.fxAsOf) + ')') : 'Recorded from ledger'}</div></div>
      <div class="card stat"><div class="stat-label">Holdings value</div><div class="stat-value amt">${F.php(v.holdingsBase)}</div><div class="stat-sub">${v.holdings.length} position${v.holdings.length === 1 ? '' : 's'}</div></div>
      <div class="card stat"><div class="stat-label">Account total</div><div class="stat-value amt">${F.php(v.totalBase)}</div><div class="stat-sub">Cash + holdings</div></div>
      <div class="card stat"><div class="stat-label">Deposits · Withdrawals</div><div class="stat-value sm2"><span class="amt up">${F.money(sums('DEPOSIT') + sums('OPENING_BALANCE'), a.currency, { compact: true })}</span> · <span class="amt down">${F.money(sums('WITHDRAWAL'), a.currency, { compact: true })}</span></div><div class="stat-sub">Transfers in ${F.money(sums('TRANSFER_IN'), a.currency, { compact: true })} · out ${F.money(sums('TRANSFER_OUT'), a.currency, { compact: true })}</div></div>
    </section>
    ${a.notes ? html`<div class="card note sm"><strong>Notes:</strong> ${a.notes}</div>` : ''}
    <section class="grid g2">${chartBox('ch-bal', 'Cash balance history (' + a.currency + ')')}<div class="card"><div class="card-head"><h3>Monthly activity</h3></div><div id="monthly"></div></div></section>
    ${v.holdings.length ? html`<section class="card"><div class="card-head"><h3>Holdings in this account</h3></div><div id="holdings"></div></section>` : ''}
    <section class="card"><div class="card-head"><h3>Transactions</h3></div><div id="acct-tx"></div></section>`);

  // running balance (from ledger, ascending)
  const asc = Core.sortTx(eff);
  let bal = 0; const pts = [];
  asc.forEach((t) => {
    const d = cashDelta(t);
    if (d === null) return;
    bal = Core.money(bal + d, a.currency);
    pts.push({ label: F.date(t.occurred_at), value: bal });
  });
  if (pts.length < 2) $('#ch-bal').closest('.chart-wrap').innerHTML = String(html`<div class="chart-empty">${pts.length ? 'One entry so far.' : 'No cash movements yet.'}</div>`);
  else chart($('#ch-bal'), { type: 'line', data: { labels: pts.map((p) => p.label), datasets: [{ data: pts.map((p) => p.value), stepped: true, borderColor: cssVar('--c1'), backgroundColor: cssVar('--c1') + '22', fill: true, pointRadius: 0, borderWidth: 2 }] }, options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => F.money(c.parsed.y, a.currency) } } } } });

  // monthly activity in account currency
  const months = {};
  asc.forEach((t) => {
    const m = Core.localDate(t.t, store.tz).slice(0, 7);
    const b = months[m] || (months[m] = { m, in: 0, out: 0, tin: 0, tout: 0, fees: 0, income: 0 });
    if (t.type === 'DEPOSIT' || t.type === 'OPENING_BALANCE') b.in += t.gross_amount;
    if (t.type === 'WITHDRAWAL') b.out += t.gross_amount;
    if (t.type === 'TRANSFER_IN') b.tin += t.gross_amount;
    if (t.type === 'TRANSFER_OUT') b.tout += t.gross_amount;
    if (t.type === 'INCOME' && !t.quantity) b.income += t.gross_amount;
    b.fees += t.type === 'FEE' ? t.gross_amount : t.type === 'ASSET_TRANSFER_OUT' ? 0 : t.fee;
  });
  const rows = Object.values(months).sort((x, y) => y.m.localeCompare(x.m));
  const m = (x) => F.money(x, a.currency, { compact: true });
  dataTable($('#monthly'), { search: false, pageSize: 12, rows, empty: 'No activity yet.', columns: [
    { key: 'm', label: 'Month', render: (r) => monthLabel(r.m) },
    { key: 'in', label: 'Deposits', align: 'r', render: (r) => m(r.in) }, { key: 'out', label: 'Withdrawals', align: 'r', render: (r) => m(r.out) },
    { key: 'tin', label: 'Transfers in', align: 'r', render: (r) => m(r.tin) }, { key: 'tout', label: 'Transfers out', align: 'r', render: (r) => m(r.tout) },
    { key: 'fees', label: 'Fees', align: 'r', render: (r) => m(r.fees) }] });
  if (v.holdings.length) dataTable($('#holdings'), { search: false, rows: v.holdings, columns: [
    { key: 'asset', label: 'Asset', render: (p) => html`<a href="#/assets/${p.asset_id}">${store.asset(p.asset_id)?.ticker || store.asset(p.asset_id)?.name}</a>`, sort: (p) => store.asset(p.asset_id)?.name },
    { key: 'qty', label: 'Quantity', align: 'r', render: (p) => F.qty(p.qty) },
    { key: 'costBase', label: 'Cost basis', align: 'r', render: (p) => F.php(p.costBase) },
    { key: 'valueBase', label: 'Value', align: 'r', render: (p) => F.php(p.valueBase) },
    { key: 'unrealizedBase', label: 'Unrealized', align: 'r', render: (p) => F.pl(p.unrealizedBase) }] });
  dataTable($('#acct-tx'), { rows: txs.filter((t) => t.type !== 'REVERSAL'), columns: txColumns({ showAccount: false }), initialSort: { key: 'date', dir: 'desc' } });

  root.onclick = async (e) => {
    const act = e.target.closest('[data-a]')?.dataset.a;
    if (!act) return;
    if (['DEPOSIT', 'WITHDRAWAL', 'RECONCILE', 'INCOME', 'FEE'].includes(act)) cashTxForm(act, { account_id: id });
    else if (act === 'BUY' || act === 'SELL') assetTxForm(act, { account_id: id });
    else if (act === 'transfer') transferForm({ from_account_id: id });
    else if (act === 'atransfer') assetTransferForm({ from_account_id: id });
    else if (act === 'edit') accountForm(a);
    else if (act === 'archive') {
      const ok = await confirmDialog({ title: archived ? 'Restore account' : 'Archive account', danger: !archived, confirmLabel: archived ? 'Restore' : 'Archive', message: archived ? 'The account will appear in forms again.' : 'Archived accounts are hidden from forms but keep their full history. Any remaining balance still counts toward net worth.' });
      if (!ok) return;
      try { await store.write('updateAccount', { account_id: id, status: archived ? 'ACTIVE' : 'ARCHIVED' }); toast(archived ? 'Account restored' : 'Account archived'); }
      catch (err) { toast(errorMessage(err), 'error'); }
    }
  };
}

/** Effect of one effective ledger row on the account's cash balance (null if none). */
export function cashDelta(t) {
  switch (t.type) {
    case 'OPENING_BALANCE': case 'TRANSFER_IN': case 'RECONCILE': return t.gross_amount;
    case 'DEPOSIT': return t.gross_amount - t.fee;
    case 'WITHDRAWAL': case 'TRANSFER_OUT': return -(t.gross_amount + t.fee);
    case 'FEE': return -t.gross_amount;
    case 'INCOME': return t.quantity > 0 && t.asset_id ? null : t.gross_amount - t.fee;
    case 'BUY': return -(t.quantity * t.unit_price + t.fee);
    case 'SELL': return t.quantity * t.unit_price - t.fee;
    default: return null;
  }
}
