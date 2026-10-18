import { html, raw, $, $$, uid, formData } from '../utils/dom.js';
import * as F from '../utils/format.js';
import { modal, toast, confirmDialog, errorMessage } from './ui.js';
import { store } from '../state.js';
const Core = window.WealthCore;

// ------------------------------------------------------------------ field helpers
const field = (label, input, help = '', cls = '') => html`<label class="field ${cls}"><span>${label}</span>${input}${help ? html`<small>${help}</small>` : ''}</label>`;
const input = (name, { type = 'text', value = '', required = false, step, min, placeholder = '', label = '', attrs = '' } = {}) =>
  html`<input name="${name}" type="${type}" value="${value ?? ''}" ${required ? 'required' : ''} ${step ? raw(`step="${step}"`) : ''} ${min !== undefined ? raw(`min="${min}"`) : ''} placeholder="${placeholder}" data-label="${label || name}" ${raw(attrs)}>`;
const num = (name, opts = {}) => input(name, { type: 'text', step: 'any', attrs: 'inputmode="decimal" autocomplete="off"', ...opts });
const select = (name, options, value, { required = false, label = '' } = {}) =>
  html`<select name="${name}" ${required ? 'required' : ''} data-label="${label || name}">${options.map(([v, l]) => html`<option value="${v}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${l}</option>`)}</select>`;
const textarea = (name, value = '', placeholder = '') => html`<textarea name="${name}" rows="2" maxlength="1000" placeholder="${placeholder}">${value}</textarea>`;
const row = (...cells) => html`<div class="field-row">${cells}</div>`;
const numVal = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : NaN; };

function accountOptions(filter = () => true, includeEmpty = true) {
  const list = store.activeAccounts().filter(filter).map((a) => [a.account_id, `${a.name} · ${a.currency}`]);
  return includeEmpty ? [['', 'Select account…'], ...list] : list;
}
function assetOptions(cls) {
  return [['', 'Select asset…'], ...store.activeAssets(cls).map((a) => [a.asset_id, `${a.ticker ? a.ticker + ' — ' : ''}${a.name}`])];
}
function cashOf(accId) { return store.live.cashNative[accId] || 0; }
function holdingQty(accId, assetId) {
  const p = store.live.positions.find((x) => x.account_id === accId && x.asset_id === assetId);
  return p ? p.qty : 0;
}
function fxDefault(cur) {
  if (!cur || cur === store.base) return 1;
  return store.latestFx(cur)?.rate || '';
}
/** Show/hide FX row and keep the PHP-equivalent preview live. */
function wireMoney(el, { accountField = 'account_id', amountFn, fxName = 'fx_rate', previewSel = '.preview' }) {
  const form = $('form', el);
  const update = () => {
    const acc = store.account(form[accountField]?.value);
    const cur = acc?.currency || store.base;
    $$('.cur', el).forEach((s) => { s.textContent = cur; });
    const fxRow = $(`[data-fx="${fxName}"]`, el);
    if (fxRow) {
      const foreign = cur !== store.base;
      fxRow.hidden = !foreign;
      const fxIn = form[fxName];
      fxIn.required = foreign;
      if (foreign && !fxIn.dataset.touched) fxIn.value = fxDefault(cur);
    }
    const amount = amountFn(form, acc);
    const fx = cur === store.base ? 1 : numVal(form[fxName]?.value);
    const pv = $(previewSel, el);
    if (pv) pv.innerHTML = String(isFinite(amount) && amount ? html`${F.money(amount, cur)}${cur !== store.base ? html` ≈ <strong>${isFinite(fx) && fx > 0 ? F.php(amount * fx) : '— (enter FX rate)'}</strong>` : ''}` : html`<span class="muted">—</span>`);
    el.dispatchEvent(new CustomEvent('money-updated', { detail: { acc, cur, amount, fx } }));
  };
  form.addEventListener('input', (e) => { if (e.target.name === fxName) e.target.dataset.touched = '1'; update(); });
  form.addEventListener('change', update);
  update();
}
const fxRow = (name = 'fx_rate', label = 'FX rate') => html`<div data-fx="${name}" hidden>${field(html`${label} (<span class="cur"></span> → ${store.base})`, num(name, { label: 'FX rate', placeholder: 'e.g. 58.25' }), html`${store.base} per 1 unit. Prefilled with the latest recorded rate; the rate used is stored with the transaction.`)}</div>`;
const metaFields = (v = {}) => html`${row(field('Reference no.', input('reference_no', { value: v.reference_no, placeholder: 'optional' })), field('Receipt / attachment', input('attachment', { value: v.attachment, placeholder: 'link or file name (optional)' })))}${field('Remarks', textarea('remarks', v.remarks))}`;

async function submit(action, payload, requestId, okMsg) {
  const res = await store.write(action, payload, requestId);
  toast(okMsg);
  return res;
}

// ------------------------------------------------------------------ cash transactions
const CASH_TITLES = { DEPOSIT: 'Add deposit', WITHDRAWAL: 'Add withdrawal', FEE: 'Record fee', INCOME: 'Record income', RECONCILE: 'Update balance', OPENING_BALANCE: 'Opening balance' };
const HELP = {
  DEPOSIT: 'Money coming in from outside your tracked accounts (salary, a gift, a cash-in). Counted as an external inflow — never as profit. For moves between your own accounts use Transfer.',
  WITHDRAWAL: 'Money leaving your tracked accounts (spending, sending to someone else). For moves between your own accounts use Transfer.',
  FEE: 'A standalone charge on the account (bank fee, maintenance fee). Reduces performance.',
  INCOME: 'Interest, dividends, staking rewards, rent. Counted as investment income.',
  RECONCILE: 'Bring the recorded balance in line with your actual statement. The app records the difference as an auditable adjustment — balances are never overwritten.'
};

export function cashTxForm(type, defaults = {}, editing = null) {
  const requestId = uid('req');
  const v = editing ? { ...editing, occurred_at: editing.occurred_at } : defaults;
  const isEdit = !!editing;
  const assets = type === 'INCOME' ? assetOptions() : null;
  const body = html`
    <p class="form-help">${HELP[type] || ''}</p>
    ${field('Account', select('account_id', accountOptions(), v.account_id, { required: true, label: 'Account' }))}
    <div class="avail muted"></div>
    ${field('Date & time', input('occurred_at', { type: 'datetime-local', value: F.toLocalInput(v.occurred_at), required: true, label: 'Date' }), F.tz())}
    ${type === 'RECONCILE' && !isEdit ? html`
      ${field(html`Actual balance per statement (<span class="cur"></span>)`, num('actual_balance', { required: true, label: 'Actual balance' }))}
      <div class="preview-box">Adjustment: <span class="preview"></span></div>
      ${field('Treat the difference as', select('category', [['FLOW', 'External flow (missed deposit/withdrawal) — not profit'], ['NON_FLOW', 'Gain or loss (missed interest, fees, error)']], store.setting('reconcile_default', 'FLOW')))}`
    : html`
      ${row(field(html`Amount (<span class="cur"></span>)`, num('gross_amount', { required: true, label: 'Amount', value: isEdit ? v.gross_amount : '' })),
            ['DEPOSIT', 'WITHDRAWAL', 'INCOME'].includes(type) ? field(html`Fee (<span class="cur"></span>)`, num('fee', { placeholder: '0', value: isEdit && v.fee ? v.fee : '' }), 'Recorded separately') : '')}
      ${type === 'RECONCILE' ? field('Treat the difference as', select('category', [['FLOW', 'External flow'], ['NON_FLOW', 'Gain or loss']], v.category)) : ''}
      ${type === 'INCOME' ? row(field('Kind', select('category', [['INTEREST', 'Interest'], ['DIVIDEND', 'Dividend'], ['STAKING', 'Staking reward'], ['REWARD', 'Reward / cashback'], ['RENT', 'Rent'], ['OTHER', 'Other']], v.category)), field('Related asset', select('asset_id', assets, v.asset_id), 'optional')) : ''}
      ${type === 'INCOME' ? html`<div class="inkind" hidden>${field('Received in units (in-kind)', num('quantity', { value: isEdit && v.quantity ? v.quantity : '', placeholder: 'e.g. 0.05' }), 'For rewards paid in the asset itself. Amount above = fair value at receipt; it becomes the cost basis of the new units.')}</div>` : ''}
      ${type === 'FEE' ? field('Fee type', select('category', [['BANK', 'Bank / account fee'], ['TRADING', 'Trading fee'], ['NETWORK', 'Network fee'], ['TAX', 'Tax'], ['OTHER', 'Other']], v.category)) : ''}
      <div class="preview-box">Equivalent: <span class="preview"></span></div>`}
    ${fxRow()}
    ${metaFields(v)}
    ${isEdit ? field('Reason for edit', input('reason', { required: true, label: 'Reason', placeholder: 'e.g. wrong amount' }), 'The original stays in the ledger as reversed; a corrected entry replaces it.') : ''}`;
  modal({
    title: isEdit ? 'Edit ' + F.typeLabel(type).toLowerCase() : CASH_TITLES[type], body, submitLabel: isEdit ? 'Save correction' : 'Record',
    onOpen: (el) => {
      const form = $('form', el);
      if (isEdit) { form.account_id.disabled = true; }
      wireMoney(el, {
        amountFn: (f, acc) => {
          if (type === 'RECONCILE' && !isEdit) { const a = numVal(f.actual_balance.value); return isFinite(a) && acc ? Core.money(a - cashOf(acc.account_id), acc.currency) : NaN; }
          return numVal(f.gross_amount.value);
        }
      });
      const avail = $('.avail', el);
      const showAvail = () => { const acc = store.account(form.account_id.value); avail.textContent = acc ? 'Recorded balance: ' + F.money(cashOf(acc.account_id), acc.currency) : ''; };
      form.account_id.addEventListener('change', showAvail); showAvail();
      if (type === 'INCOME') {
        const ik = $('.inkind', el);
        const t = () => { ik.hidden = !form.asset_id.value; };
        form.asset_id.addEventListener('change', t); t();
      }
    },
    onSubmit: async (form) => {
      const d = formData(form);
      const payload = { type, account_id: isEdit ? editing.account_id : d.account_id, occurred_at: F.fromLocalInput(d.occurred_at), gross_amount: d.gross_amount, fee: d.fee, fx_rate: d.fx_rate, category: d.category, reference_no: d.reference_no, attachment: d.attachment, remarks: d.remarks };
      if (type === 'INCOME') { payload.asset_id = d.asset_id || ''; payload.quantity = d.asset_id ? d.quantity : ''; }
      if (type === 'RECONCILE' && !isEdit) { payload.actual_balance = d.actual_balance; delete payload.gross_amount; }
      if (type === 'WITHDRAWAL' || type === 'FEE') {
        const acc = store.account(payload.account_id);
        const need = numVal(d.gross_amount) + (numVal(d.fee) || 0);
        if (acc && acc.type !== 'LIABILITY' && need > cashOf(acc.account_id) + 1e-9) throw new Error(`Insufficient funds: recorded balance is ${F.money(cashOf(acc.account_id), acc.currency)}.`);
      }
      if (isEdit) {
        const changes = { ...payload }; delete changes.type; delete changes.account_id;
        await submit('editTransaction', { tx_id: editing.tx_id, expected_updated_at: editing.updated_at, changes, reason: d.reason }, requestId, 'Correction saved');
      } else await submit('postTransaction', payload, requestId, { DEPOSIT: 'Deposit recorded', WITHDRAWAL: 'Withdrawal recorded', FEE: 'Fee recorded', INCOME: 'Income recorded', RECONCILE: 'Balance adjustment recorded' }[type]);
    }
  });
}

// ------------------------------------------------------------------ transfers
export function transferForm(defaults = {}) {
  const requestId = uid('req');
  const body = html`
    <p class="form-help">Move money between two accounts you own. Both sides are linked by one transfer ID and never count as deposits, withdrawals, income or profit.</p>
    ${row(field('From', select('from_account_id', accountOptions(), defaults.from_account_id, { required: true, label: 'From account' })), field('To', select('to_account_id', accountOptions(), defaults.to_account_id, { required: true, label: 'To account' })))}
    <div class="avail muted"></div>
    ${field('Date & time', input('occurred_at', { type: 'datetime-local', value: F.toLocalInput(), required: true, label: 'Date' }))}
    ${row(field(html`Amount sent (<span class="cur-from"></span>)`, num('amount', { required: true, label: 'Amount' })), field(html`Transfer fee (<span class="cur-from"></span>)`, num('fee', { placeholder: '0' }), 'Charged on top of the amount sent'))}
    <div class="recv">${field(html`Amount received (<span class="cur-to"></span>)`, num('amount_in', { label: 'Amount received' }), 'Different currencies: enter what actually arrived.')}</div>
    ${fxRow('fx_rate_from', 'FX rate, source')}${fxRow('fx_rate_to', 'FX rate, destination')}
    ${metaFields()}`;
  modal({
    title: 'Transfer funds', body, submitLabel: 'Transfer',
    onOpen: (el) => {
      const form = $('form', el);
      const upd = () => {
        const a = store.account(form.from_account_id.value), b = store.account(form.to_account_id.value);
        $$('.cur-from', el).forEach((s) => { s.textContent = a?.currency || store.base; });
        $$('.cur-to', el).forEach((s) => { s.textContent = b?.currency || store.base; });
        const diff = a && b && a.currency !== b.currency;
        $('.recv', el).hidden = !diff; form.amount_in.required = !!diff;
        [['fx_rate_from', a], ['fx_rate_to', b]].forEach(([n, acc]) => {
          const r = $(`[data-fx="${n}"]`, el); const foreign = acc && acc.currency !== store.base;
          r.hidden = !foreign; form[n].required = !!foreign;
          $$('.cur', r).forEach((s) => { s.textContent = acc?.currency || ''; });
          if (foreign && !form[n].dataset.touched) form[n].value = fxDefault(acc.currency);
        });
        $('.avail', el).textContent = a ? 'Available in source: ' + F.money(cashOf(a.account_id), a.currency) : '';
      };
      form.addEventListener('change', upd); form.addEventListener('input', (e) => { if (e.target.name?.startsWith('fx_')) e.target.dataset.touched = '1'; });
      upd();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      if (d.from_account_id === d.to_account_id) throw new Error('Choose two different accounts.');
      const a = store.account(d.from_account_id);
      if (a && a.type !== 'LIABILITY' && numVal(d.amount) + (numVal(d.fee) || 0) > cashOf(a.account_id) + 1e-9) throw new Error('Insufficient funds in the source account.');
      await submit('postTransfer', { ...d, occurred_at: F.fromLocalInput(d.occurred_at) }, requestId, 'Transfer recorded');
    }
  });
}

// ------------------------------------------------------------------ asset transactions
const ASSET_TITLES = { BUY: 'Record purchase', SELL: 'Record sale', ADD_POSITION: 'Add existing position', REDUCE_POSITION: 'Reduce position' };
const ASSET_HELP = {
  BUY: 'Buying with cash held in the selected account. Fees are added to cost basis (weighted-average method).',
  SELL: 'Selling from the selected account. Realised P&L = proceeds − fee − weighted-average cost of the units sold.',
  ADD_POSITION: 'Bring units you already own under tracking (no cash moves). Enter what you paid in total as cost basis. This is an external inflow, not profit.',
  REDUCE_POSITION: 'Units leaving without a sale (gifted, sent to someone else, lost). Cost basis is removed at the average cost.'
};
export function assetTxForm(type, defaults = {}, editing = null) {
  const requestId = uid('req');
  const v = editing || defaults;
  const isEdit = !!editing;
  const cls = defaults.asset_class;
  const body = html`
    <p class="form-help">${ASSET_HELP[type]}</p>
    ${row(field('Asset', select('asset_id', assetOptions(cls), v.asset_id, { required: true, label: 'Asset' })), field('Held in account', select('account_id', accountOptions(), v.account_id, { required: true, label: 'Account' })))}
    <div class="avail muted"></div>
    ${field('Date & time', input('occurred_at', { type: 'datetime-local', value: F.toLocalInput(v.occurred_at), required: true, label: 'Date' }))}
    ${row(field('Quantity', num('quantity', { required: true, label: 'Quantity', value: isEdit ? v.quantity : '' }), 'Fractions allowed'),
          type === 'BUY' || type === 'SELL' ? field(html`Price per unit (<span class="cur"></span>)`, num('unit_price', { required: true, label: 'Price', value: isEdit ? v.unit_price : '' }))
          : type === 'ADD_POSITION' ? field(html`Total cost basis (<span class="cur"></span>)`, num('gross_amount', { required: true, label: 'Cost basis', value: isEdit ? v.gross_amount : '' }), 'What you paid in total, incl. fees')
          : field(html`Market price per unit (<span class="cur"></span>)`, num('unit_price', { value: isEdit && v.unit_price ? v.unit_price : '', placeholder: 'optional' }), 'Used to value the outflow'))}
    ${type === 'BUY' || type === 'SELL' ? field(html`Trading fee (<span class="cur"></span>)`, num('fee', { placeholder: '0', value: isEdit && v.fee ? v.fee : '' })) : ''}
    ${type === 'ADD_POSITION' ? field(html`Current market price per unit (<span class="cur"></span>)`, num('unit_price', { placeholder: 'optional', value: isEdit && v.unit_price ? v.unit_price : '' }), 'If known, the inflow is valued at market so later gains are measured from today, not from your original cost.') : ''}
    ${type === 'REDUCE_POSITION' ? field('Reason', select('category', [['WITHDRAWN', 'Sent / gifted out of tracking (external outflow)'], ['LOSS', 'Lost or written off (realised loss)']], v.category)) : ''}
    ${type === 'BUY' && !isEdit ? html`<label class="check"><input type="checkbox" name="fund_externally"> <span>Paid from outside my tracked accounts (records a linked deposit first)</span></label>` : ''}
    <div class="preview-box"><span class="pv-label">Total</span>: <span class="preview"></span></div>
    ${fxRow()}
    ${metaFields(v)}
    ${isEdit ? field('Reason for edit', input('reason', { required: true, label: 'Reason' })) : ''}`;
  modal({
    title: isEdit ? 'Edit ' + F.typeLabel(type).toLowerCase() : ASSET_TITLES[type], body, wide: true, submitLabel: isEdit ? 'Save correction' : 'Record',
    onOpen: (el) => {
      const form = $('form', el);
      if (isEdit) { form.asset_id.disabled = true; }
      $('.pv-label', el).textContent = type === 'SELL' ? 'Net proceeds' : type === 'BUY' ? 'Total cost' : 'Value';
      wireMoney(el, {
        amountFn: (f) => {
          const q = numVal(f.quantity.value), p = numVal(f.unit_price?.value), fee = numVal(f.fee?.value) || 0;
          if (type === 'BUY') return q * p + fee;
          if (type === 'SELL') return q * p - fee;
          if (type === 'ADD_POSITION') return numVal(f.gross_amount.value);
          return q * p;
        }
      });
      const avail = $('.avail', el);
      const show = () => {
        const acc = store.account(form.account_id.value), a = store.asset(form.asset_id.value);
        if (!acc) { avail.textContent = ''; return; }
        const parts = ['Cash: ' + F.money(cashOf(acc.account_id), acc.currency)];
        if (a) parts.push('Holding: ' + F.qty(holdingQty(acc.account_id, a.asset_id)) + ' ' + (a.ticker || a.unit_label || 'units'));
        if (a && a.currency !== acc.currency && (type === 'BUY' || type === 'SELL')) parts.push(`Note: trade price is entered in ${acc.currency}; the asset's market price is quoted in ${a.currency}.`);
        avail.textContent = parts.join(' · ');
      };
      form.addEventListener('change', show); show();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      const payload = { type, asset_id: isEdit ? editing.asset_id : d.asset_id, account_id: d.account_id, occurred_at: F.fromLocalInput(d.occurred_at), quantity: d.quantity, unit_price: d.unit_price, fee: d.fee, gross_amount: d.gross_amount, fx_rate: d.fx_rate, category: d.category, fund_externally: d.fund_externally, reference_no: d.reference_no, attachment: d.attachment, remarks: d.remarks };
      if (type === 'SELL' && numVal(d.quantity) > holdingQty(d.account_id, payload.asset_id) + 1e-9 && !isEdit) throw new Error('You only hold ' + F.qty(holdingQty(d.account_id, payload.asset_id)) + ' units in that account.');
      if (isEdit) {
        const changes = { ...payload }; delete changes.type; delete changes.asset_id; delete changes.fund_externally;
        await submit('editTransaction', { tx_id: editing.tx_id, expected_updated_at: editing.updated_at, changes, reason: d.reason }, requestId, 'Correction saved');
      } else await submit('postTransaction', payload, requestId, { BUY: 'Purchase recorded', SELL: 'Sale recorded', ADD_POSITION: 'Position added', REDUCE_POSITION: 'Position reduced' }[type]);
    }
  });
}

export function assetTransferForm(defaults = {}) {
  const requestId = uid('req');
  const body = html`
    <p class="form-help">Move units between accounts you own (e.g. exchange → hardware wallet). Not a sale: cost basis moves with the units. A network fee paid in the asset reduces the units received.</p>
    ${field('Asset', select('asset_id', assetOptions(defaults.asset_class), defaults.asset_id, { required: true, label: 'Asset' }))}
    ${row(field('From', select('from_account_id', accountOptions(), defaults.from_account_id, { required: true, label: 'From' })), field('To', select('to_account_id', accountOptions(), '', { required: true, label: 'To' })))}
    <div class="avail muted"></div>
    ${field('Date & time', input('occurred_at', { type: 'datetime-local', value: F.toLocalInput(), required: true, label: 'Date' }))}
    ${row(field('Quantity sent', num('quantity', { required: true, label: 'Quantity' })), field('Network fee (units)', num('fee_quantity', { placeholder: '0' })))}
    ${metaFields()}`;
  modal({
    title: 'Transfer asset between accounts', body, submitLabel: 'Transfer',
    onOpen: (el) => {
      const form = $('form', el);
      const show = () => { const a = store.asset(form.asset_id.value); $('.avail', el).textContent = a && form.from_account_id.value ? 'Available: ' + F.qty(holdingQty(form.from_account_id.value, a.asset_id)) : ''; };
      form.addEventListener('change', show); show();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      await submit('postAssetTransfer', { ...d, occurred_at: F.fromLocalInput(d.occurred_at) }, requestId, 'Asset transfer recorded');
    }
  });
}

// ------------------------------------------------------------------ prices / valuations / FX
export function priceForm(asset) {
  const requestId = uid('req');
  modal({
    title: 'Update price — ' + (asset.ticker || asset.name),
    body: html`<p class="form-help">Manual price entry. It is stored with its source and timestamp and shown as “manual”.</p>
      ${row(field(`Price per unit (${asset.currency})`, num('price', { required: true, label: 'Price' })), field('As of', input('as_of', { type: 'datetime-local', value: F.toLocalInput(), required: true, label: 'As of' })))}
      <label class="check"><input type="checkbox" name="is_estimate"> <span>This is an estimate</span></label>
      ${field('Notes / source', input('notes', { placeholder: 'e.g. PSE close, exchange ticker' }))}`,
    onSubmit: async (form) => {
      const d = formData(form);
      await submit('addPrice', { asset_id: asset.asset_id, price: d.price, currency: asset.currency, as_of: F.fromLocalInput(d.as_of), is_estimate: d.is_estimate, notes: d.notes }, requestId, 'Price recorded');
    }
  });
}
export function valuationForm(asset) {
  const requestId = uid('req');
  const held = store.live.positions.filter((p) => p.asset_id === asset.asset_id).reduce((s, p) => s + p.qty, 0);
  modal({
    title: 'Update valuation — ' + asset.name,
    body: html`<p class="form-help">Estimated total value of your position (${F.qty(held)} ${asset.unit_label || 'units'}). Shown as an estimate everywhere it appears.</p>
      ${row(field(`Total value (${asset.currency})`, num('total_value', { required: true, label: 'Value' })), field('Valuation date', input('as_of', { type: 'datetime-local', value: F.toLocalInput(), required: true, label: 'Date' })))}
      ${field('Valuation source', input('valuation_source', { required: true, label: 'Source', placeholder: 'e.g. appraisal, owner estimate, latest financials' }))}
      ${field('Notes', input('notes'))}`,
    onSubmit: async (form) => {
      const d = formData(form);
      await submit('updateValuation', { asset_id: asset.asset_id, total_value: d.total_value, as_of: F.fromLocalInput(d.as_of), valuation_source: d.valuation_source, notes: d.notes }, requestId, 'Valuation recorded');
    }
  });
}
export function fxForm(currency = '') {
  const requestId = uid('req');
  modal({
    title: 'Record FX rate',
    body: html`<p class="form-help">How many ${store.base} one unit of the currency is worth. Used to value balances from this time forward; past transactions keep the rate stored on them.</p>
      ${row(field('Currency', input('currency', { required: true, value: currency, placeholder: 'USDT, USD…', label: 'Currency', attrs: 'maxlength="6" style="text-transform:uppercase"' })), field(`Rate (${store.base} per 1)`, num('rate', { required: true, label: 'Rate' })))}
      ${row(field('As of', input('as_of', { type: 'datetime-local', value: F.toLocalInput(), required: true, label: 'As of' })), field('Source', input('source', { placeholder: 'e.g. BSP, exchange P2P' })))}`,
    onSubmit: async (form) => {
      const d = formData(form);
      await submit('addFxRate', { currency: d.currency.toUpperCase(), rate: d.rate, as_of: F.fromLocalInput(d.as_of), source: d.source || 'MANUAL' }, requestId, 'FX rate recorded');
    }
  });
}

// ------------------------------------------------------------------ accounts & assets
export function accountForm(existing = null) {
  const requestId = uid('req');
  const a = existing || { currency: store.base, type: 'BANK' };
  const types = Core.ACCOUNT_TYPES.map((t) => [t, F.accountTypeLabel(t)]);
  modal({
    title: existing ? 'Edit account' : 'Add account',
    body: html`
      ${row(field('Account name', input('name', { required: true, value: a.name, label: 'Name', placeholder: 'e.g. GCash, Binance, BPI Savings' })), field('Type', select('type', types, a.type)))}
      ${row(field('Institution / exchange', input('institution', { value: a.institution, placeholder: 'e.g. BDO, Binance' })), field('Currency', input('currency', { required: true, value: a.currency, label: 'Currency', attrs: 'maxlength="6" style="text-transform:uppercase"' }), existing ? 'Fixed once transactions exist' : 'PHP, USD, USDT…'))}
      ${field('Account reference (optional)', input('reference', { value: a.reference, placeholder: 'last digits or nickname', attrs: 'autocomplete="off"' }), 'Masked in normal views. Never enter passwords, PINs, private keys or seed phrases.')}
      ${!existing ? html`<fieldset class="group"><legend>Opening balance</legend>
        ${row(field(html`Balance (<span class="cur-x">${a.currency}</span>)`, num('opening_balance', { placeholder: '0' }), 'Liabilities: enter as a negative number'), field('As of', input('opening_date', { type: 'datetime-local', value: F.toLocalInput() })))}
        <div class="ob-fx" hidden>${field(html`FX rate (${store.base} per 1 <span class="cur-fx"></span>)`, num('opening_fx_rate', { label: 'FX rate' }), 'Needed to value this balance in ' + store.base + '. Saved with the opening entry.')}</div></fieldset>` : ''}
      ${field('Notes', textarea('notes', a.notes))}
      ${existing ? field('Status', select('status', [['ACTIVE', 'Active'], ['ARCHIVED', 'Archived (hidden from forms; history kept)']], a.status)) : ''}`,
    onOpen: (el) => {
      const form = $('form', el);
      const upd = () => {
        const cur = form.currency.value.toUpperCase();
        $$('.cur-x', el).forEach((s) => { s.textContent = cur; });
        const box = $('.ob-fx', el);
        if (box) {
          box.hidden = cur === store.base || !cur;
          form.opening_fx_rate.required = !box.hidden && !!form.opening_balance.value;
          $$('.cur-fx', el).forEach((s) => { s.textContent = cur; });
          if (!box.hidden && !form.opening_fx_rate.value) form.opening_fx_rate.value = fxDefault(cur);
        }
      };
      form.addEventListener('input', upd); upd();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      d.currency = d.currency.toUpperCase();
      if (existing) await submit('updateAccount', { account_id: existing.account_id, expected_updated_at: existing.updated_at, ...d }, requestId, 'Account updated');
      else await submit('createAccount', { ...d, opening_date: d.opening_date ? F.fromLocalInput(d.opening_date) : '' }, requestId, 'Account added');
    }
  });
}

const CLASS_NAMES = { CRYPTO: 'crypto asset', STOCK: 'stock', OTHER: 'asset' };
export function assetForm(cls, existing = null) {
  const requestId = uid('req');
  const a = existing || { asset_class: cls, currency: store.base, price_source: 'MANUAL' };
  cls = a.asset_class;
  const cats = Core.OTHER_CATEGORIES.map((c) => [c, c[0] + c.slice(1).toLowerCase()]);
  modal({
    title: (existing ? 'Edit ' : 'Add ') + CLASS_NAMES[cls], wide: true,
    body: html`
      ${row(field(cls === 'STOCK' ? 'Company name' : 'Name', input('name', { required: true, value: a.name, label: 'Name', placeholder: cls === 'CRYPTO' ? 'Bitcoin' : cls === 'STOCK' ? 'Ayala Land' : 'e.g. Café partnership' })),
            cls !== 'OTHER' ? field('Ticker', input('ticker', { value: a.ticker, required: true, label: 'Ticker', placeholder: cls === 'CRYPTO' ? 'BTC' : 'ALI' })) : field('Category', select('category', cats, a.category)))}
      ${row(cls === 'CRYPTO' ? field('Network (optional)', input('network', { value: a.network, placeholder: 'e.g. Bitcoin, ERC-20, TRC-20' })) : cls === 'STOCK' ? field('Exchange', input('exchange', { value: a.exchange, placeholder: 'PSE, NASDAQ…' })) : field('Unit label', input('unit_label', { value: a.unit_label, placeholder: '% ownership, oz, units' }), 'What “quantity” means for this asset'),
            field('Price currency', input('currency', { required: true, value: a.currency, label: 'Currency', attrs: 'maxlength="6" style="text-transform:uppercase"' }), existing ? 'Fixed once prices exist' : 'Currency its market price is quoted in'))}
      ${cls === 'CRYPTO' ? html`${row(field('Price source', select('price_source', [['MANUAL', 'Manual entry'], ['BINANCE', 'Binance (automatic)'], ['COINGECKO', 'CoinGecko (automatic)']], a.price_source)), html`<div class="src-id">${field(html`<span class="src-label">Symbol</span>`, input('price_source_id', { value: a.price_source_id, placeholder: 'BTCUSDT' }), html`<span class="src-help"></span>`)}</div>`)}`: ''}
      ${field('Notes', textarea('notes', a.notes))}
      ${existing ? field('Status', select('status', [['ACTIVE', 'Active'], ['ARCHIVED', 'Archived']], a.status)) : ''}`,
    onOpen: (el) => {
      const form = $('form', el);
      if (!form.price_source) return;
      const upd = () => {
        const src = form.price_source.value, box = $('.src-id', el);
        box.hidden = src === 'MANUAL';
        form.price_source_id.required = src !== 'MANUAL';
        $('.src-label', el).textContent = src === 'BINANCE' ? 'Binance pair symbol' : 'CoinGecko ID';
        form.price_source_id.placeholder = src === 'BINANCE' ? 'e.g. BTCUSDT, ETHUSDT, SOLUSDT' : 'e.g. bitcoin, ethereum';
        form.price_source_id.dataset.label = src === 'BINANCE' ? 'Binance symbol' : 'CoinGecko ID';
        $('.src-help', el).textContent = src === 'BINANCE'
          ? 'Same as TradingView (BINANCE:BTCUSDT). Prices in USDT are converted to ' + store.base + ' with the latest USDT rate, or kept in USDT if the price currency is USDT.'
          : 'From the coin\'s CoinGecko page address, e.g. coingecko.com/en/coins/bitcoin → bitcoin.';
      };
      form.price_source.addEventListener('change', upd); upd();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      d.currency = d.currency.toUpperCase();
      if (d.price_source === 'MANUAL') d.price_source_id = '';
      if (existing) await submit('updateAsset', { asset_id: existing.asset_id, expected_updated_at: existing.updated_at, ...d }, requestId, 'Asset updated');
      else {
        const res = await submit('createAsset', { ...d, asset_class: cls }, requestId, 'Asset added');
        setTimeout(() => assetTxForm(cls === 'OTHER' ? 'ADD_POSITION' : 'BUY', { asset_id: res.asset.asset_id, asset_class: cls }), 150);
      }
    }
  });
}
export function addAssetChooser() {
  modal({
    title: 'Add asset',
    body: html`<div class="chooser">
      <button type="button" class="choice" data-cls="CRYPTO"><strong>Crypto</strong><span>Coins & tokens on exchanges or wallets</span></button>
      <button type="button" class="choice" data-cls="STOCK"><strong>Stock</strong><span>Shares, ETFs, funds</span></button>
      <button type="button" class="choice" data-cls="OTHER"><strong>Other asset</strong><span>Business, property, metals, private</span></button></div>`,
    onOpen: (el) => el.addEventListener('click', (e) => { const b = e.target.closest('[data-cls]'); if (b) assetForm(b.dataset.cls); })
  });
}

// ------------------------------------------------------------------ remove asset
/**
 * Remove an asset. With no history it is simply removed. With history, every transaction for it
 * is reversed first (purchases refunded, sales undone) — nothing is deleted, all audited.
 */
export function removeAssetForm(asset, onDone) {
  const requestId = uid('req');
  const txs = store.txs().filter((t) => t.asset_id === asset.asset_id && Core.isEffective(t));
  const counts = {};
  txs.forEach((t) => { const l = F.typeLabel(t.type); counts[l] = (counts[l] || 0) + 1; });
  const held = store.live.positions.filter((p) => p.asset_id === asset.asset_id).reduce((s, p) => s + p.qty, 0);
  const label = (asset.ticker ? asset.ticker + ' · ' : '') + asset.name;
  modal({
    title: 'Remove ' + label, danger: true, submitLabel: txs.length ? 'Reverse history & remove' : 'Remove asset',
    body: txs.length ? html`
      <div class="banner danger sm">${F.icon('alert')}<div><strong>This asset has ${txs.length} transaction${txs.length === 1 ? '' : 's'}</strong>
        (${Object.entries(counts).map(([k, v]) => v + ' ' + k.toLowerCase()).join(', ')})${held ? html` and you currently hold <strong>${F.qty(held)}</strong>` : ''}.</div></div>
      <p class="sm">Removing it <strong>reverses all of them</strong>, as if they never happened:</p>
      <ul class="sm muted" style="margin:0;padding-left:18px">
        <li>purchases are refunded to the account's cash, sales and income are undone;</li>
        <li>linked entries (transfers of this asset, funding deposits) are reversed too;</li>
        <li>nothing is deleted — originals and reversals stay in the ledger and audit log.</li></ul>
      <p class="sm">Use this for an asset <strong>added by mistake</strong>. If you really owned it and sold or moved it out, use <strong>Archive</strong> instead to keep your real history and P&amp;L.</p>
      <label class="check"><input type="checkbox" name="confirm" required data-label="Confirmation"> <span>I understand — reverse ${txs.length} transaction${txs.length === 1 ? '' : 's'} and remove this asset</span></label>
      ${field('Reason (kept in the audit log)', input('reason', { required: true, label: 'Reason', placeholder: 'e.g. added by mistake, wrong price currency' }))}`
      : html`<p class="sm">This asset has no transactions. It will be removed from your portfolio and forms. Its price records stay in the audit trail.</p>
      ${field('Reason (kept in the audit log)', input('reason', { required: true, label: 'Reason', placeholder: 'e.g. duplicate, wrong currency' }))}`,
    onSubmit: async (form) => {
      const d = formData(form);
      if (txs.length && !d.confirm) throw new Error('Tick the confirmation box to reverse the history.');
      const res = await store.write('removeAsset', { asset_id: asset.asset_id, reason: d.reason, reverse_history: txs.length > 0 }, requestId);
      toast(res.reversed.length ? `${label} removed · ${res.reversed.length} transaction(s) reversed` : `${label} removed`);
      onDone?.();
    }
  });
}

// ------------------------------------------------------------------ goals
export function goalForm(existing = null) {
  const requestId = uid('req');
  const g = existing || { basis: 'NET_WORTH', priority: (store.data.goals || []).length + 1, start_date: F.today(), starting_amount: store.live.summary.netWorth };
  modal({
    title: existing ? 'Edit goal' : 'New goal', wide: true,
    body: html`
      ${row(field('Goal name', input('name', { required: true, value: g.name, label: 'Name', placeholder: 'e.g. First ₱5M' })), field(`Target amount (${store.base})`, num('target_amount', { required: true, value: g.target_amount, label: 'Target' })))}
      ${row(field('Counts toward goal', select('basis', [['NET_WORTH', 'Net worth'], ['INVESTMENTS', 'Investments only'], ['LIQUID', 'Liquid assets (cash + crypto + stocks)'], ['CASH', 'Cash only']], g.basis)), field('Priority', num('priority', { value: g.priority })))}
      ${row(field('Starting amount', num('starting_amount', { value: g.starting_amount })), field('Start date', input('start_date', { type: 'date', value: g.start_date })))}
      ${row(field('Target date', input('target_date', { type: 'date', value: g.target_date })), field(`Planned monthly contribution (${store.base})`, num('monthly_contribution', { value: g.monthly_contribution })))}
      ${field('Expected annual return assumption (%)', num('expected_return', { value: g.expected_return ?? '', placeholder: 'e.g. 6' }), 'A hypothetical assumption for projections — not a forecast or a guarantee.')}
      ${field('Notes', textarea('notes', g.notes))}
      ${existing ? field('Status', select('status', [['ACTIVE', 'Active'], ['ACHIEVED', 'Achieved'], ['ARCHIVED', 'Archived']], g.status)) : ''}`,
    onSubmit: async (form) => {
      const d = formData(form);
      if (existing) await submit('updateGoal', { goal_id: existing.goal_id, expected_updated_at: existing.updated_at, ...d }, requestId, 'Goal updated');
      else await submit('createGoal', d, requestId, 'Goal created');
    }
  });
}

// ------------------------------------------------------------------ edit / reverse dispatch
export function editTx(tx) {
  if (Core.CASH_TX_TYPES.includes(tx.type)) return cashTxForm(tx.type, {}, tx);
  if (Core.ASSET_TX_TYPES.includes(tx.type)) return assetTxForm(tx.type, {}, tx);
  toast('Transfers are corrected by reversing and re-entering them.', 'error');
}
export async function reverseTx(tx) {
  const linked = tx.link_id ? store.txs().filter((t) => t.link_id === tx.link_id && Core.isEffective(t)) : [tx];
  const reason = await confirmDialog({
    title: 'Reverse transaction', confirmLabel: 'Reverse', withReason: true,
    message: `This posts a reversing entry${linked.length > 1 ? ' for all ' + linked.length + ' linked legs' : ''}. Nothing is deleted — the original and the reversal both stay in the ledger and audit log, and every balance and P&L figure is recalculated.`
  });
  if (!reason) return;
  try { await store.write('reverseTransaction', { tx_id: tx.tx_id, reason }, uid('req')); toast('Transaction reversed'); }
  catch (e) { toast(errorMessage(e), 'error', 7000); }
}

/** Quick actions used by the dashboard and nav. */
export const quick = {
  deposit: (d) => cashTxForm('DEPOSIT', d), withdrawal: (d) => cashTxForm('WITHDRAWAL', d), transfer: (d) => transferForm(d),
  addAsset: () => addAssetChooser(), buy: (d) => assetTxForm('BUY', d || {}), sell: (d) => assetTxForm('SELL', d || {}),
  balance: (d) => cashTxForm('RECONCILE', d), income: (d) => cashTxForm('INCOME', d), fee: (d) => cashTxForm('FEE', d),
  account: () => accountForm()
};
