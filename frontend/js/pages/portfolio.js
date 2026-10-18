import { html, mount, $ } from '../utils/dom.js';
import * as F from '../utils/format.js';
import { store } from '../state.js';
import { dataTable, emptyState, statCard, chart, chartBox, cssVar, toast, errorMessage, confirmDialog, PALETTE } from '../components/ui.js';
import { assetForm, assetTxForm, priceForm, valuationForm, assetTransferForm, cashTxForm, removeAssetForm } from '../components/forms.js';
import { txColumns } from './transactions.js';
import { qualityBanner } from './dashboard.js';
import { refreshMarketPrices, marketAssets } from '../services/market.js';
const Core = window.WealthCore;

const CLASS = { CRYPTO: { title: 'Crypto', route: 'crypto', noun: 'crypto asset' }, STOCK: { title: 'Stocks', route: 'stocks', noun: 'stock' }, OTHER: { title: 'Other assets', route: 'other', noun: 'asset' } };

function rowsFor(cls) {
  const st = store.live;
  const by = new Map(st.byAsset.map((a) => [a.asset_id, a]));
  const market = Core.buildMarket(store.coreData(), store.base);
  const staleMs = Number(store.setting('stale_price_days', 3)) * 864e5;
  return store.data.assets.filter((a) => a.status !== 'REMOVED' && (!cls || a.asset_class === cls) && (a.status !== 'ARCHIVED' || by.get(a.asset_id)?.qty))
    .map((a) => {
      const row = { ...(by.get(a.asset_id) || { qty: 0, costBase: 0, valueBase: 0, unrealizedBase: 0, realizedBase: 0, incomeBase: 0, feesBase: 0, locations: [], price: null }), asset: a, asset_id: a.asset_id, name: a.name, ticker: a.ticker };
      // Show the latest recorded price even when nothing is held (positions only carry a price when qty > 0).
      if (row.price === null || row.price === undefined) {
        const list = market.prices[a.asset_id] || [];
        const lp = list.length ? list[list.length - 1] : null;
        if (lp) Object.assign(row, { price: lp.price, priceCurrency: lp.currency, priceAsOf: lp.t, priceSource: lp.source, isEstimate: lp.is_estimate, stale: Date.now() - lp.t > staleMs, valuedAtCost: false });
      }
      return row;
    });
}
function priceCell(r) {
  if (r.valuedAtCost) return html`<span class="muted">No price</span> ${F.badge('at cost', 'warn')}`;
  if (r.price === null) return html`<span class="muted">—</span>`;
  const src = { MANUAL: 'manual', VALUATION: 'estimate', COINGECKO: 'CoinGecko', BINANCE: 'Binance', LAST_TRADE: 'last trade' }[r.priceSource] || r.priceSource;
  return html`<div>${F.money(r.price, r.priceCurrency)}</div><div class="xs muted">${src} · ${F.ago(r.priceAsOf)}${r.stale ? html` ${F.badge('stale', 'warn')}` : ''}${r.isEstimate ? html` ${F.badge('estimate', 'info')}` : ''}</div>`;
}
function holdingColumns(cls, total) {
  const cols = [
    { key: 'name', label: cls === 'STOCK' ? 'Company' : 'Asset', sort: (r) => r.name, render: (r) => html`<a href="#/assets/${r.asset_id}"><strong>${r.ticker || r.name}</strong></a><div class="xs muted">${r.ticker ? r.name : (r.asset.category || '').toLowerCase()}${r.asset.network ? ' · ' + r.asset.network : ''}${r.asset.exchange ? ' · ' + r.asset.exchange : ''}</div>` },
    { key: 'where', label: 'Held in', sort: (r) => r.locations.length, render: (r) => html`<span class="sm">${r.locations.map((l) => store.account(l.account_id)?.name).filter(Boolean).join(', ') || '—'}</span>` },
    { key: 'qty', label: cls === 'STOCK' ? 'Shares' : 'Quantity', align: 'r', sort: (r) => r.qty, render: (r) => html`${F.qty(r.qty)} <span class="xs muted">${r.asset.unit_label || ''}</span>` },
    { key: 'avg', label: 'Avg cost', align: 'r', sort: (r) => r.avgCostBase, render: (r) => (r.qty ? F.php(r.avgCostBase) : '—') },
    { key: 'costBase', label: 'Cost basis', align: 'r', sort: (r) => r.costBase, render: (r) => F.php(r.costBase) },
    { key: 'price', label: 'Price', align: 'r', sort: (r) => r.price, render: priceCell },
    { key: 'valueBase', label: 'Market value', align: 'r', sort: (r) => r.valueBase, render: (r) => html`<strong class="amt">${F.php(r.valueBase)}</strong>` },
    { key: 'unrealizedBase', label: 'Unrealized', align: 'r', sort: (r) => r.unrealizedBase, render: (r) => html`${F.pl(r.unrealizedBase)}<div class="xs ${F.tone(r.unrealizedBase)}">${r.returnPct === null || r.returnPct === undefined ? '' : F.pct(r.returnPct)}</div>` },
    { key: 'realizedBase', label: 'Realized', align: 'r', sort: (r) => r.realizedBase, render: (r) => (r.realizedBase ? F.pl(r.realizedBase) : html`<span class="muted">—</span>`) },
    { key: 'incomeBase', label: cls === 'STOCK' ? 'Dividends' : 'Income', align: 'r', sort: (r) => r.incomeBase, render: (r) => (r.incomeBase ? F.php(r.incomeBase) : html`<span class="muted">—</span>`) },
    { key: 'alloc', label: 'Alloc.', align: 'r', sort: (r) => r.valueBase, render: (r) => (total > 0 ? F.pct(r.valueBase / total * 100, { sign: false, dp: 1 }) : '—') },
    { key: 'act', label: '', noSort: true, align: 'r', render: (r) => html`<div class="row-actions">${r.asset.status !== 'ARCHIVED' ? html`<button class="btn xs" data-buy="${r.asset_id}">${cls === 'OTHER' ? 'Add' : 'Buy'}</button>${r.qty ? html`<button class="btn xs" data-sell="${r.asset_id}">${cls === 'OTHER' ? 'Reduce' : 'Sell'}</button>` : ''}` : ''}${r.qty ? html`<button class="btn xs ghost" data-price="${r.asset_id}">${cls === 'OTHER' ? 'Value' : 'Price'}</button>` : ''}<button class="icon-btn" data-remove="${r.asset_id}" aria-label="Remove ${r.ticker || r.name}" title="Remove asset">${F.icon('trash')}</button></div>` }
  ];
  return cols;
}

export function render(root, params, route) {
  if (route === 'asset') return renderAsset(root, params.id);
  const cls = route === 'crypto' ? 'CRYPTO' : route === 'stocks' ? 'STOCK' : route === 'other' ? 'OTHER' : null;
  const st = store.live, s = st.summary;
  if (!cls) return renderOverview(root);
  const meta = CLASS[cls];
  const rows = rowsFor(cls);
  const total = cls === 'CRYPTO' ? s.crypto : cls === 'STOCK' ? s.stock : s.other;
  const cost = rows.reduce((a, r) => a + r.costBase, 0), unr = rows.reduce((a, r) => a + r.unrealizedBase, 0), rea = rows.reduce((a, r) => a + r.realizedBase, 0), inc = rows.reduce((a, r) => a + r.incomeBase, 0), fees = rows.reduce((a, r) => a + r.feesBase, 0);
  const canRefresh = cls === 'CRYPTO' && marketAssets().length > 0;
  mount(root, html`
    <div class="page-head"><div><h1>${meta.title}</h1><p class="muted">Weighted-average cost. ${cls === 'OTHER' ? 'Manual valuations are labelled as estimates.' : 'Prices show their source and age.'}</p></div>
      <div class="head-actions wrap">${canRefresh ? html`<button class="btn" id="refresh">${F.icon('refresh')} Refresh prices</button>` : ''}
        ${cls !== 'OTHER' ? html`<button class="btn" data-x="move">${F.icon('swap')} Move between accounts</button>` : ''}
        ${cls === 'STOCK' ? html`<button class="btn" data-x="div">Record dividend</button>` : ''}${cls === 'CRYPTO' ? html`<button class="btn" data-x="stake">Record reward</button>` : ''}
        <button class="btn primary" data-x="add">${F.icon('plus')} Add ${meta.noun}</button></div></div>
    ${qualityBanner(st)}
    <section class="grid g5">
      ${statCard({ label: 'Market value', value: F.php(total), sub: s.totalAssets ? F.pct(total / s.totalAssets * 100, { sign: false, dp: 1 }) + ' of total assets' : '' })}
      ${statCard({ label: 'Cost basis', value: F.php(cost) })}
      ${statCard({ label: 'Unrealized P&L', value: F.pl(unr), sub: cost ? F.pct(unr / cost * 100) : '' })}
      ${statCard({ label: 'Realized P&L', value: F.pl(rea), sub: 'after fees' })}
      ${statCard({ label: cls === 'STOCK' ? 'Dividends · Fees' : 'Income · Fees', value: html`<span class="amt ${inc ? 'up' : ''}">${F.php(inc, { compact: true })}</span> · <span class="amt ${fees ? 'down' : ''}">${F.php(fees, { compact: true })}</span>` })}
    </section>
    <div class="card" id="holdings"></div>`);
  if (!rows.length) mount($('#holdings'), emptyState('No ' + meta.title.toLowerCase() + ' yet', cls === 'OTHER' ? 'Add a business stake, property, gold or any other holding, then record your position and a valuation.' : 'Add the asset, then record a purchase (or an existing position you already own).', html`<button class="btn primary" data-x="add">Add ${meta.noun}</button>`));
  else dataTable($('#holdings'), { rows, columns: holdingColumns(cls, total), initialSort: { key: 'valueBase', dir: 'desc' }, pageSize: 50 });
  root.onclick = async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'add') return assetForm(cls);
    if (x === 'move') return assetTransferForm({ asset_class: cls });
    if (x === 'div') return cashTxForm('INCOME', { category: 'DIVIDEND' });
    if (x === 'stake') return cashTxForm('INCOME', { category: 'STAKING' });
    const b = e.target.closest('[data-buy]'), sl = e.target.closest('[data-sell]'), pr = e.target.closest('[data-price]');
    if (b) return assetTxForm(cls === 'OTHER' ? 'ADD_POSITION' : 'BUY', { asset_id: b.dataset.buy, asset_class: cls });
    if (sl) return assetTxForm(cls === 'OTHER' ? 'REDUCE_POSITION' : 'SELL', { asset_id: sl.dataset.sell, asset_class: cls, account_id: store.live.positions.find((p) => p.asset_id === sl.dataset.sell)?.account_id });
    if (pr) { const a = store.asset(pr.dataset.price); return cls === 'OTHER' ? valuationForm(a) : priceForm(a); }
    const rm = e.target.closest('[data-remove]');
    if (rm) return removeAssetForm(store.asset(rm.dataset.remove));
    if (e.target.closest('#refresh')) refreshPrices(e.target.closest('#refresh'));
  };
}

export async function refreshPrices(btn, { quiet = false } = {}) {
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    const r = await refreshMarketPrices();
    const extra = [...r.skipped, ...r.errors];
    if (!quiet || extra.length) toast(`Updated ${r.updated} price${r.updated === 1 ? '' : 's'}${r.fx ? ' and ' + r.fx + ' FX rate' + (r.fx === 1 ? '' : 's') : ''}${extra.length ? ' · ' + extra.join(' · ') : ''}`, extra.length ? 'error' : 'ok', extra.length ? 9000 : 4200);
  } catch (err) { toast(errorMessage(err), 'error', 9000); }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('loading'); } }
}

function renderOverview(root) {
  const st = store.live, s = st.summary;
  const rows = rowsFor(null).filter((r) => r.qty || r.realizedBase);
  const threshold = Number(store.setting('concentration_threshold', 25));
  const conc = Core.concentration(st.byAsset, s.totalAssets, threshold);
  mount(root, html`
    <div class="page-head"><div><h1>My portfolio</h1><p class="muted">All investment positions across every account, valued in ${store.base}.</p></div>
      <div class="head-actions"><button class="btn primary" data-x="add">${F.icon('plus')} Add asset</button></div></div>
    ${qualityBanner(st)}
    ${conc.length ? html`<div class="banner danger" role="status">${F.icon('alert')}<div><strong>Concentration risk</strong> · ${conc.map((c) => c.name + ' is ' + F.pct(c.pct, { sign: false, dp: 1 })).join(', ')} of total assets (threshold ${threshold}%). <a href="#/planning">See allocation planner</a></div></div>` : ''}
    <section class="grid g4">
      ${statCard({ label: 'Investment value', value: F.php(s.investment), sub: html`Cost basis ${F.php(s.costBasis, { compact: true })}` })}
      ${statCard({ label: 'Unrealized P&L', value: F.pl(s.unrealized), sub: s.costBasis ? F.pct(s.unrealized / s.costBasis * 100) : '' })}
      ${statCard({ label: 'Realized P&L', value: F.pl(s.realized) })}
      ${statCard({ label: 'Investment income', value: F.php(s.income) })}
    </section>
    <section class="grid g3">
      ${[['CRYPTO', s.crypto, 'crypto'], ['STOCK', s.stock, 'stocks'], ['OTHER', s.other, 'other']].map(([c, v, r]) => html`<a class="card class-card" href="#/${r}"><div class="stat-label">${CLASS[c].title}</div><div class="stat-value amt">${F.php(v)}</div><div class="stat-sub">${s.investment ? F.pct(v / s.investment * 100, { sign: false, dp: 1 }) + ' of investments' : '—'} · ${rowsFor(c).filter((x) => x.qty).length} positions →</div></a>`)}
    </section>
    <section class="grid g2">${chartBox('ch-class', 'Investments by class', '', 260)}${chartBox('ch-top', 'Largest positions', '', 260)}</section>
    <div class="card"><div class="card-head"><h3>All positions</h3></div><div id="all"></div></div>`);
  const pal = PALETTE();
  const cv = [s.crypto, s.stock, s.other];
  if (cv.some((v) => v > 0)) chart($('#ch-class'), { type: 'doughnut', data: { labels: ['Crypto', 'Stocks', 'Other'], datasets: [{ data: cv, backgroundColor: pal, borderColor: cssVar('--panel'), borderWidth: 2 }] }, options: { cutout: '64%', plugins: { legend: { position: window.innerWidth < 640 ? 'bottom' : 'right' }, tooltip: { callbacks: { label: (c) => c.label + ': ' + F.php(c.parsed) } } } } });
  else $('#ch-class').closest('.chart-wrap').innerHTML = String(html`<div class="chart-empty">No positions yet.</div>`);
  const top = [...rows].sort((a, b) => b.valueBase - a.valueBase).slice(0, 8);
  if (top.length) chart($('#ch-top'), { type: 'bar', data: { labels: top.map((r) => r.ticker || r.name), datasets: [{ label: 'Value', data: top.map((r) => r.valueBase), backgroundColor: cssVar('--c1'), borderRadius: 4 }, { label: 'Cost', data: top.map((r) => r.costBase), backgroundColor: cssVar('--c4'), borderRadius: 4 }] }, options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + F.php(c.parsed.x) } } }, scales: { x: { ticks: { callback: (v) => F.php(v, { compact: true }) } } } } });
  else $('#ch-top').closest('.chart-wrap').innerHTML = String(html`<div class="chart-empty">No positions yet.</div>`);
  if (rows.length) dataTable($('#all'), { rows, columns: holdingColumns('ALL', s.investment).filter((c) => c.key !== 'act'), initialSort: { key: 'valueBase', dir: 'desc' } });
  else mount($('#all'), emptyState('No positions yet', 'Add crypto, stocks or other assets to see them here.'));
  root.onclick = (e) => {
    if (e.target.closest('[data-x="add"]')) import('../components/forms.js').then((m) => m.addAssetChooser());
  };
}

function renderAsset(root, id) {
  const a = store.asset(id);
  if (!a) { mount(root, emptyState('Asset not found', '', html`<a class="btn" href="#/portfolio">Back</a>`)); return; }
  if (a.status === 'REMOVED') { mount(root, emptyState('This asset was removed', 'Its transactions were reversed and remain visible in Transactions (filter by Reversed) and the audit log.', html`<a class="btn" href="#/${CLASS[a.asset_class].route}">Back to ${CLASS[a.asset_class].title}</a>`)); return; }
  const r = rowsFor(null).find((x) => x.asset_id === id) || { qty: 0, costBase: 0, valueBase: 0, unrealizedBase: 0, realizedBase: 0, incomeBase: 0, feesBase: 0, locations: [] };
  const cls = a.asset_class, meta = CLASS[cls];
  const txs = store.txs().filter((t) => t.asset_id === id && t.type !== 'REVERSAL');
  const prices = (store.data.prices || []).filter((p) => p.asset_id === id).sort((x, y) => Date.parse(y.as_of) - Date.parse(x.as_of));
  const archived = a.status === 'ARCHIVED';
  mount(root, html`
    <div class="page-head"><div><a class="back sm" href="#/${meta.route}">← ${meta.title}</a><h1>${a.ticker ? a.ticker + ' · ' : ''}${a.name}</h1>
      <p class="muted">${[cls === 'OTHER' ? (a.category || '').toLowerCase() : meta.title.replace(/s$/, ''), a.network, a.exchange, 'priced in ' + a.currency, a.price_source === 'COINGECKO' ? 'CoinGecko: ' + a.price_source_id : a.price_source === 'BINANCE' ? 'Binance: ' + a.price_source_id : 'manual prices'].filter(Boolean).join(' · ')}${archived ? ' · archived' : ''}</p></div>
      <div class="head-actions wrap">${archived ? '' : html`<button class="btn sm" data-x="buy">${cls === 'OTHER' ? 'Add to position' : 'Buy'}</button>${r.qty ? html`<button class="btn sm" data-x="sell">${cls === 'OTHER' ? 'Reduce' : 'Sell'}</button><button class="btn sm" data-x="move">Move</button>` : ''}<button class="btn sm" data-x="income">Income</button><button class="btn sm" data-x="price">${cls === 'OTHER' ? 'Update valuation' : 'Update price'}</button><button class="btn sm" data-x="addpos">Add existing</button>`}
        <button class="btn sm ghost" data-x="edit">Edit</button><button class="btn sm ghost" data-x="archive">${archived ? 'Restore' : 'Archive'}</button><button class="btn sm danger" data-x="remove">${F.icon('trash')} Remove</button></div></div>
    <section class="grid g5">
      ${statCard({ label: 'Quantity', value: F.qty(r.qty) + ' ' + (a.unit_label || ''), sub: r.locations.map((l) => store.account(l.account_id)?.name + ': ' + F.qty(l.qty)).join(' · ') })}
      ${statCard({ label: 'Market value', value: F.php(r.valueBase), sub: priceCell(r) })}
      ${statCard({ label: 'Cost basis', value: F.php(r.costBase), sub: r.qty ? 'Avg ' + F.php(r.avgCostBase) + ' / unit' : '' })}
      ${statCard({ label: 'Unrealized P&L', value: F.pl(r.unrealizedBase), sub: r.returnPct === null || r.returnPct === undefined ? '' : F.pct(r.returnPct) })}
      ${statCard({ label: 'Realized · Income', value: html`${F.pl(r.realizedBase)} · <span class="amt up">${F.php(r.incomeBase)}</span>`, sub: 'Fees ' + F.php(r.feesBase) })}
    </section>
    <section class="grid g2">${chartBox('ch-price', 'Recorded price history (' + a.currency + ')')}<div class="card"><div class="card-head"><h3>Price & valuation records</h3></div><div id="prices"></div></div></section>
    <div class="card"><div class="card-head"><h3>Purchase, sale, transfer & income history</h3></div><div id="atx"></div></div>`);
  const pts = [...prices].reverse();
  if (pts.length < 2) $('#ch-price').closest('.chart-wrap').innerHTML = String(html`<div class="chart-empty">${pts.length ? 'One recorded price so far.' : 'No recorded prices yet (trade prices are used until you record one).'}</div>`);
  else chart($('#ch-price'), { type: 'line', data: { labels: pts.map((p) => F.date(p.as_of)), datasets: [{ data: pts.map((p) => p.price), borderColor: cssVar('--c3'), pointRadius: 2, tension: 0.2, borderWidth: 2 }] }, options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => F.money(c.parsed.y, a.currency) } } } } });
  dataTable($('#prices'), { search: false, pageSize: 10, rows: prices, empty: 'No price records.', columns: [
    { key: 'as_of', label: 'As of', sort: (p) => Date.parse(p.as_of), render: (p) => F.dateTime(p.as_of) },
    { key: 'price', label: 'Price', align: 'r', render: (p) => F.money(p.price, p.currency) },
    { key: 'source', label: 'Source', render: (p) => html`${p.source.toLowerCase()}${p.is_estimate ? html` ${F.badge('estimate', 'info')}` : ''}` },
    { key: 'notes', label: 'Notes', render: (p) => html`<span class="muted sm">${p.notes}</span>` }] });
  dataTable($('#atx'), { rows: txs, columns: txColumns(), initialSort: { key: 'date', dir: 'desc' }, empty: 'No transactions for this asset yet.' });
  root.onclick = async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    const firstAcc = r.locations[0]?.account_id;
    if (x === 'buy') assetTxForm(cls === 'OTHER' ? 'ADD_POSITION' : 'BUY', { asset_id: id, account_id: firstAcc });
    if (x === 'sell') assetTxForm(cls === 'OTHER' ? 'REDUCE_POSITION' : 'SELL', { asset_id: id, account_id: firstAcc });
    if (x === 'addpos') assetTxForm('ADD_POSITION', { asset_id: id, account_id: firstAcc });
    if (x === 'move') assetTransferForm({ asset_id: id, from_account_id: firstAcc });
    if (x === 'income') cashTxForm('INCOME', { asset_id: id, account_id: firstAcc, category: cls === 'STOCK' ? 'DIVIDEND' : cls === 'CRYPTO' ? 'STAKING' : 'OTHER' });
    if (x === 'price') (cls === 'OTHER' ? valuationForm : priceForm)(a);
    if (x === 'edit') assetForm(cls, a);
    if (x === 'remove') removeAssetForm(a, () => { location.hash = '#/' + meta.route; });
    if (x === 'archive') {
      if (!archived && r.qty) { toast('Sell, reduce or move out the remaining position before archiving.', 'error'); return; }
      const ok = await confirmDialog({ title: archived ? 'Restore asset' : 'Archive asset', danger: !archived, confirmLabel: archived ? 'Restore' : 'Archive', message: 'History is kept either way.' });
      if (!ok) return;
      try { await store.write('updateAsset', { asset_id: id, status: archived ? 'ACTIVE' : 'ARCHIVED' }); toast('Saved'); } catch (err) { toast(errorMessage(err), 'error'); }
    }
  };
}
