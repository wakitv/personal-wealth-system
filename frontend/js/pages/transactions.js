import { html, mount, $, download } from '../utils/dom.js';
import * as F from '../utils/format.js';
import { store } from '../state.js';
import { dataTable, modal, loadingBlock, errorMessage } from '../components/ui.js';
import { editTx, reverseTx, quick, assetTransferForm } from '../components/forms.js';
import { api } from '../services/api.js';
const Core = window.WealthCore;

const filters = { type: '', account: '', asset: '', status: 'POSTED', from: '', to: '' };

export function txColumns({ showAccount = true } = {}) {
  return [
    { key: 'date', label: 'Date', sort: (t) => t.t, render: (t) => html`<span class="nowrap">${F.dateTime(t.occurred_at)}</span>` },
    { key: 'type', label: 'Type', render: (t) => html`${F.typeLabel(t.type)}${t.status === 'REVERSED' ? html` ${F.badge('reversed', 'muted')}` : ''}${t.replaces ? html` ${F.badge('corrected', 'info')}` : ''}${t.link_id && /TRANSFER/.test(t.type) ? html` ${F.badge('linked', '')}` : ''}` },
    ...(showAccount ? [{ key: 'account', label: 'Account', sort: (t) => store.account(t.account_id)?.name, render: (t) => html`<a href="#/accounts/${t.account_id}">${store.account(t.account_id)?.name || '—'}</a>${t.counter_account_id ? html`<span class="muted sm"> ${t.type.endsWith('OUT') ? '→' : '←'} ${store.account(t.counter_account_id)?.name || ''}</span>` : ''}` }] : []),
    { key: 'details', label: 'Details', sort: (t) => t.remarks, render: (t) => {
      const a = t.asset_id && store.asset(t.asset_id);
      return html`${a ? html`<a href="#/assets/${a.asset_id}">${F.qty(t.quantity)} ${a.ticker || a.name}</a>${t.unit_price ? ' @ ' + F.money(t.unit_price, t.currency) : ''} ` : ''}<span class="muted">${t.category && !['FLOW', 'OTHER'].includes(t.category) ? t.category.toLowerCase() + ' · ' : ''}${t.remarks}</span>`;
    } },
    { key: 'amount', label: 'Amount', align: 'r', sort: (t) => amountOf(t), render: (t) => (/ASSET_TRANSFER/.test(t.type) ? html`<span class="muted">${F.qty(t.quantity)} units</span>` : html`<span class="amt ${signOf(t) > 0 ? 'up' : signOf(t) < 0 ? 'down' : ''}">${F.money(signOf(t) * Math.abs(amountOf(t)), t.currency, { sign: signOf(t) !== 0 })}</span>`) },
    { key: 'fee', label: 'Fee', align: 'r', sort: (t) => t.fee, render: (t) => (t.fee ? (/ASSET_TRANSFER/.test(t.type) ? F.qty(t.fee) + ' u' : F.money(t.fee, t.currency)) : '') },
    { key: 'base', label: store.base + ' equiv.', align: 'r', sort: (t) => Math.abs(amountOf(t)) * t.fx_rate, render: (t) => (t.currency !== store.base && t.fx_rate ? html`<span class="muted">${F.php(Math.abs(amountOf(t)) * t.fx_rate)}</span>` : '') },
    { key: 'actions', label: '', noSort: true, align: 'r', render: (t) => html`<div class="row-actions"><button class="icon-btn" data-view="${t.tx_id}" aria-label="View details">${F.icon('eye')}</button>${Core.isEffective(t) ? html`${!/TRANSFER/.test(t.type) && !(t.link_id && t.type !== 'BUY') ? html`<button class="icon-btn" data-edit="${t.tx_id}" aria-label="Edit">${F.icon('edit')}</button>` : ''}<button class="icon-btn" data-reverse="${t.tx_id}" aria-label="Reverse">${F.icon('undo')}</button>` : ''}</div>` }
  ];
}
export function amountOf(t) {
  if (t.type === 'BUY' || t.type === 'SELL') return t.quantity * t.unit_price;
  return t.gross_amount;
}
function signOf(t) {
  if (['DEPOSIT', 'OPENING_BALANCE', 'INCOME', 'TRANSFER_IN', 'SELL'].includes(t.type)) return 1;
  if (['WITHDRAWAL', 'FEE', 'TRANSFER_OUT', 'BUY'].includes(t.type)) return -1;
  if (t.type === 'RECONCILE') return Math.sign(t.gross_amount);
  return 0;
}

function filtered() {
  return store.txs().filter((t) => {
    if (t.type === 'REVERSAL' && filters.status !== 'ALL') return false;
    if (filters.type && !(filters.type === 'TRANSFER' ? /TRANSFER/.test(t.type) : t.type === filters.type)) return false;
    if (filters.account && t.account_id !== filters.account) return false;
    if (filters.asset && t.asset_id !== filters.asset) return false;
    if (filters.status === 'POSTED' && t.status === 'REVERSED') return false;
    if (filters.status === 'REVERSED' && t.status !== 'REVERSED') return false;
    const d = Core.localDate(t.t, store.tz);
    if (filters.from && d < filters.from) return false;
    if (filters.to && d > filters.to) return false;
    return true;
  });
}

export function render(root) {
  const types = [['', 'All types'], ['DEPOSIT', 'Deposits'], ['WITHDRAWAL', 'Withdrawals'], ['TRANSFER', 'Transfers'], ['BUY', 'Buys'], ['SELL', 'Sales'], ['INCOME', 'Income'], ['FEE', 'Fees'], ['RECONCILE', 'Balance adjustments'], ['OPENING_BALANCE', 'Opening balances'], ['ADD_POSITION', 'Positions added'], ['REDUCE_POSITION', 'Positions reduced']];
  const opt = (list, v) => list.map(([k, l]) => html`<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`);
  mount(root, html`
    <div class="page-head"><div><h1>Transactions</h1><p class="muted">The ledger is the source of truth. Entries are never deleted — corrections are reversals with an audit trail.</p></div>
      <div class="head-actions wrap"><button class="btn sm" data-q="deposit">Deposit</button><button class="btn sm" data-q="withdrawal">Withdrawal</button><button class="btn sm" data-q="transfer">Transfer</button><button class="btn sm" data-q="buy">Buy</button><button class="btn sm" data-q="sell">Sell</button><button class="btn sm" data-q="income">Income</button><button class="btn sm" data-q="fee">Fee</button><button class="btn sm" data-q="atransfer">Move asset</button></div></div>
    <div class="card filters">
      <select id="f-type" aria-label="Type">${opt(types, filters.type)}</select>
      <select id="f-account" aria-label="Account">${opt([['', 'All accounts'], ...store.data.accounts.map((a) => [a.account_id, a.name])], filters.account)}</select>
      <select id="f-asset" aria-label="Asset">${opt([['', 'All assets'], ...store.data.assets.map((a) => [a.asset_id, a.ticker || a.name])], filters.asset)}</select>
      <select id="f-status" aria-label="Status">${opt([['POSTED', 'Posted'], ['REVERSED', 'Reversed'], ['ALL', 'All incl. reversal entries']], filters.status)}</select>
      <input type="date" id="f-from" value="${filters.from}" aria-label="From date"><input type="date" id="f-to" value="${filters.to}" aria-label="To date">
      <button class="btn sm ghost" id="f-clear">Clear</button><button class="btn sm" id="f-csv">${F.icon('file')} CSV</button>
    </div>
    <div class="card" id="tx-table"></div>`);
  const table = dataTable($('#tx-table'), { rows: filtered(), columns: txColumns(), initialSort: { key: 'date', dir: 'desc' }, empty: 'No transactions match these filters.', pageSize: 30 });
  root.onchange = (e) => {
    const k = { 'f-type': 'type', 'f-account': 'account', 'f-asset': 'asset', 'f-status': 'status', 'f-from': 'from', 'f-to': 'to' }[e.target.id];
    if (k) { filters[k] = e.target.value; table.refresh(filtered()); }
  };
  root.onclick = (e) => {
    if (e.target.id === 'f-clear') { Object.assign(filters, { type: '', account: '', asset: '', status: 'POSTED', from: '', to: '' }); render(root); return; }
    if (e.target.closest('#f-csv')) { exportCsv(filtered()); return; }
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (q === 'atransfer') return assetTransferForm();
    if (q) return quick[q]();
  };
}

/** Shared row-action handler (also used by account and asset pages). */
export function handleRowAction(e) {
  const find = (id) => store.txs().find((t) => t.tx_id === id);
  const v = e.target.closest('[data-view]'), ed = e.target.closest('[data-edit]'), rv = e.target.closest('[data-reverse]');
  if (v) txDetail(find(v.dataset.view));
  if (ed) editTx(find(ed.dataset.edit));
  if (rv) reverseTx(find(rv.dataset.reverse));
}
// One delegated listener serves every ledger table in the app (outside modals).
document.addEventListener('click', (e) => { if (e.target.closest('[data-view],[data-edit],[data-reverse]') && !e.target.closest('.modal')) handleRowAction(e); });

function txDetail(t) {
  if (!t) return;
  const acc = store.account(t.account_id), asset = t.asset_id && store.asset(t.asset_id);
  const related = store.txs().filter((x) => (t.link_id && x.link_id === t.link_id && x.tx_id !== t.tx_id) || x.reversal_of === t.tx_id || x.tx_id === t.reversed_by || x.tx_id === t.replaces || x.replaces === t.tx_id);
  const rows = [['Transaction ID', t.tx_id], ['Type', F.typeLabel(t.type)], ['Status', t.status], ['Date & time', F.dateTime(t.occurred_at) + ' (' + store.tz + ')'], ['Account', acc?.name], ['Counter account', t.counter_account_id ? store.account(t.counter_account_id)?.name : ''], ['Asset', asset ? (asset.ticker || '') + ' ' + asset.name : ''], ['Quantity', t.quantity ? F.qty(t.quantity) : ''], ['Unit price', t.unit_price ? F.money(t.unit_price, t.currency) : ''], ['Gross amount', F.money(t.gross_amount, t.currency)], ['Fee', t.fee ? (/ASSET_TRANSFER/.test(t.type) ? F.qty(t.fee) + ' units' : F.money(t.fee, t.currency)) : ''], ['Net amount', F.money(t.net_amount, t.currency)], ['Currency', t.currency], ['FX rate', t.currency !== store.base && t.fx_rate ? F.qty(t.fx_rate) + ' ' + store.base : ''], [store.base + ' equivalent', t.base_amount ? F.php(t.base_amount) : ''], ['Transfer / link ID', t.link_id], ['Category', t.category], ['Reference no.', t.reference_no], ['Attachment', t.attachment], ['Remarks', t.remarks], ['Replaces', t.replaces], ['Reversal of', t.reversal_of], ['Reversed by', t.reversed_by], ['Request ID', t.request_id], ['Created', F.dateTime(t.created_at) + (t.created_by ? ' by ' + t.created_by : '')], ['Updated', F.dateTime(t.updated_at)]].filter(([, v]) => v);
  modal({
    title: F.typeLabel(t.type) + ' details', wide: true,
    body: html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
      ${related.length ? html`<h4>Linked entries</h4><ul class="plain">${related.map((r) => html`<li><button class="link" data-view="${r.tx_id}">${F.typeLabel(r.type)} · ${r.tx_id}</button> <span class="muted">${r.status}</span></li>`)}</ul>` : ''}
      <h4>Audit trail</h4><div id="audit">${loadingBlock(2)}</div>`,
    onOpen: async (el) => {
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) txDetail(store.txs().find((x) => x.tx_id === b.dataset.view)); });
      try {
        const res = await api.call('getAuditLog', { entity_id: t.tx_id, limit: 50 });
        mount($('#audit', el), res.rows.length ? html`<ul class="plain">${res.rows.map((r) => html`<li><strong>${r.action}</strong> · ${F.dateTime(r.at)} · <span class="muted">${r.actor}</span></li>`)}</ul>` : html`<p class="muted">No audit entries.</p>`);
      } catch (err) { mount($('#audit', el), html`<p class="muted">${errorMessage(err)}</p>`); }
    }
  });
}

export function exportCsv(rows) {
  const cols = [
    { key: 'tx_id', label: 'Transaction ID' }, { label: 'Date', value: (t) => F.dateTime(t.occurred_at) }, { label: 'ISO timestamp', value: (t) => t.occurred_at },
    { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { label: 'Account', value: (t) => store.account(t.account_id)?.name || t.account_id },
    { label: 'Counter account', value: (t) => store.account(t.counter_account_id)?.name || '' }, { label: 'Asset', value: (t) => store.asset(t.asset_id)?.ticker || store.asset(t.asset_id)?.name || '' },
    { key: 'quantity', label: 'Quantity' }, { key: 'unit_price', label: 'Unit price' }, { key: 'gross_amount', label: 'Gross amount' }, { key: 'fee', label: 'Fee' },
    { key: 'net_amount', label: 'Net amount' }, { key: 'currency', label: 'Currency' }, { key: 'fx_rate', label: 'FX rate' }, { key: 'base_amount', label: store.base + ' equivalent' },
    { key: 'link_id', label: 'Transfer ID' }, { key: 'category', label: 'Category' }, { key: 'reference_no', label: 'Reference' }, { key: 'remarks', label: 'Remarks' },
    { key: 'replaces', label: 'Replaces' }, { key: 'reversal_of', label: 'Reversal of' }];
  download(`transactions-${F.today()}.csv`, Core.toCsv(rows, cols), 'text/csv;charset=utf-8');
}
