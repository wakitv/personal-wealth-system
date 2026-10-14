import { html, raw, mount, $ } from '../utils/dom.js';
import * as F from '../utils/format.js';
import { store } from '../state.js';
import { statCard, chart, chartBox, segmented, emptyState, cssVar, PALETTE } from '../components/ui.js';
import { quick } from '../components/forms.js';
import { valuationSeries, monthlyPerformance, monthLabel, BUCKET_LABELS } from '../services/analytics.js';
import { exportMenu } from './reports.js';
const Core = window.WealthCore;

let period = null;
let custom = null;

export function qualityBanner(st) {
  const q = st.quality;
  const items = [];
  if (q.missingPrice.length) items.push(`${q.missingPrice.length} holding${q.missingPrice.length > 1 ? 's have' : ' has'} no price — valued at cost`);
  if (q.stalePrice.length) items.push(`${q.stalePrice.length} price${q.stalePrice.length > 1 ? 's are' : ' is'} older than ${store.setting('stale_price_days', 3)} days`);
  if (q.missingFx.length) items.push(`${q.missingFx.length} balance${q.missingFx.length > 1 ? 's' : ''} excluded: no FX rate for ${[...new Set(q.missingFx.map((x) => x.currency))].join(', ')}`);
  if (q.estimates.length) items.push(`${q.estimates.length} valuation${q.estimates.length > 1 ? 's are' : ' is an'} estimate${q.estimates.length > 1 ? 's' : ''}`);
  if (!items.length) return '';
  return html`<div class="banner warn" role="status">${F.icon('alert')}<div><strong>Data quality</strong> · ${items.join(' · ')}. <a href="#/portfolio">Review prices</a> · <a href="#/settings">FX rates</a></div></div>`;
}

function perfCard(key, label) {
  const p = store.performance(key);
  if (!p.available) return html`<div class="card perf"><div class="stat-label">${label}</div><div class="stat-value muted">—</div><div class="stat-sub">${p.note || 'Not enough history'}</div></div>`;
  const t = F.tone(p.gain);
  return html`<div class="card perf ${t}" title="${p.note || ''}">
    <div class="stat-label">${label}</div>
    <div class="stat-value amt ${t}">${F.php(p.gain, { sign: true })}</div>
    <div class="stat-sub"><span class="pct ${F.tone(p.returnPct || 0)}">${p.returnPct === null ? '—' : F.pct(p.returnPct)}</span> · flows ${F.php(p.netFlows, { sign: true, compact: true })}</div></div>`;
}

export function render(root) {
  const d = store.data, st = store.live, s = st.summary;
  period = period || store.setting('default_period', '30D');
  root.onclick = (e) => {
    const q = e.target.closest('[data-q]');
    if (q) { if (q.dataset.q === 'export') exportMenu(); else quick[q.dataset.q]?.(); return; }
    const sg = e.target.closest('[data-seg="period"]');
    if (sg) { period = sg.dataset.value; if (period !== 'CUSTOM') custom = null; render(root); }
    if (e.target.id === 'cr-go') {
      const f = $('#cr-from').value, t = $('#cr-to').value;
      if (f && t && f <= t) { custom = { from: f, to: t }; store.memo.clear(); render(root); }
    }
  };
  if (!d.accounts.length) {
    mount(root, html`<div class="page-head"><h1>Dashboard</h1></div>
      ${emptyState('Welcome to your Wealth OS', 'Start by adding the accounts you hold money in — banks, e-wallets, exchanges, wallets, cash. Each opening balance becomes the first entry in your ledger.', html`<button class="btn primary" data-q="account">${F.icon('plus')} Add your first account</button>`)}
      <div class="card steps"><h3>Getting set up</h3><ol>
        <li>Add accounts with their current balances (GCash, Maya, banks, Binance, cash on hand).</li>
        <li>Add assets you already own with <em>Add existing position</em>, entering what you paid as cost basis.</li>
        <li>Record FX rates for any non-PHP currency (e.g. USDT) in Settings.</li>
        <li>From then on, record deposits, withdrawals, transfers, buys and sells as they happen.</li>
        <li>Daily snapshots build your history automatically (Apps Script trigger) or via Settings → Snapshots.</li></ol></div>`);
    return;
  }
  const sel = store.performance(period, custom);
  const periods = [['1D', 'Today'], ['7D', '7D'], ['30D', '30D'], ['90D', '90D'], ['YTD', 'YTD'], ['1Y', '1Y'], ['ALL', 'All'], ['CUSTOM', 'Custom']];
  const firstSnap = store.snapshots()[0];
  mount(root, html`
    <div class="page-head">
      <div><h1>Dashboard</h1><p class="muted">As of ${F.dateTime(Date.now())} · ${store.base} · valuations from recorded prices</p></div>
      <div class="head-actions">${segmented('period', periods, period)}
        ${period === 'CUSTOM' ? html`<div class="custom-range"><input type="date" id="cr-from" value="${custom?.from || Core.addDays(F.today(), -30)}" aria-label="From"><span>→</span><input type="date" id="cr-to" value="${custom?.to || F.today()}" aria-label="To"><button class="btn sm" id="cr-go">Apply</button></div>` : ''}</div>
    </div>
    ${qualityBanner(st)}
    <section class="hero card">
      <div class="hero-main">
        <div class="stat-label">Total net worth</div>
        <div class="hero-value amt">${F.php(s.netWorth)}</div>
        <div class="hero-sub">${sel.available ? html`<span class="amt ${F.tone(sel.gain)}">${F.php(sel.gain, { sign: true })}</span> <span class="pct ${F.tone(sel.returnPct || 0)}">${sel.returnPct === null ? '' : F.pct(sel.returnPct)}</span> <span class="muted">investment result · ${sel.label}</span>` : html`<span class="muted">${sel.note}</span>`}</div>
        ${sel.available ? html`<div class="hero-flows muted">Net external flows in period: <span class="amt">${F.php(sel.netFlows, { sign: true })}</span> — excluded from the result above.</div>` : ''}
      </div>
      <div class="hero-grid">
        ${statCard({ label: 'Total assets', value: F.php(s.totalAssets) })}
        ${statCard({ label: 'Liabilities', value: F.php(s.liabilities), tone: s.liabilities > 0 ? 'neg' : '' })}
        ${statCard({ label: 'Investments', value: F.php(s.investment), sub: html`Cost basis ${F.php(s.costBasis, { compact: true })}` })}
        ${statCard({ label: 'Cash & equivalents', value: F.php(s.cash) })}
      </div>
    </section>
    <section class="grid g4">
      ${statCard({ label: 'Unrealized P&L', value: F.pl(s.unrealized), sub: s.costBasis ? F.pct(s.unrealized / s.costBasis * 100) + ' on cost' : '', hint: 'Market value of current positions minus their weighted-average cost basis (fees included in cost).' })}
      ${statCard({ label: 'Realized P&L', value: F.pl(s.realized), sub: 'All time, after fees', hint: 'Sale proceeds minus fees minus the average cost of units sold.' })}
      ${statCard({ label: 'Net external flows', value: F.php(s.netFlows, { sign: true }), sub: html`In ${F.php(s.deposits + s.opening + s.positionsIn, { compact: true })} · out ${F.php(s.withdrawals + s.positionsOut, { compact: true })}`, hint: 'Opening balances, deposits, positions added, minus withdrawals and positions removed. Internal transfers are excluded.' })}
      ${statCard({ label: 'Fees · Income', value: html`<span class="amt ${s.fees ? 'down' : ''}">${F.php(-s.fees)}</span> · <span class="amt ${s.income ? 'up' : ''}">${F.php(s.income)}</span>`, sub: 'All time' })}
    </section>
    <section class="grid g5">${perfCard('1D', 'Today')}${perfCard('7D', 'This week (7D)')}${perfCard('30D', 'This month (30D)')}${perfCard('YTD', 'Year to date')}${perfCard('ALL', 'All time')}</section>
    <p class="method-note muted">Performance = change in net worth minus external deposits & withdrawals. Return % is ${store.setting('performance_method', 'TWR') === 'TWR' ? 'time-weighted (chain-linked daily snapshots, flows at end of day)' : 'Modified Dietz (flows weighted by time in period)'}. ${firstSnap ? 'History from ' + F.dateStr(firstSnap.snapshot_date) + '.' : 'No daily snapshots yet — history will build from today.'}</p>

    <section class="card quick" aria-label="Quick actions"><h3>Quick actions</h3><div class="quick-grid">
      ${[['deposit', 'Add deposit', 'down'], ['withdrawal', 'Add withdrawal', 'up'], ['transfer', 'Transfer funds', 'swap'], ['addAsset', 'Add asset', 'plus'], ['buy', 'Record purchase', 'cart'], ['sell', 'Record sale', 'tag'], ['balance', 'Update balance', 'scale'], ['export', 'Export report', 'file']].map(([k, l, i]) => html`<button class="qa" data-q="${k}">${F.icon(i)}<span>${l}</span></button>`)}
    </div></section>

    <section class="grid g2">
      ${chartBox('ch-nw', 'Net worth history')}
      ${chartBox('ch-inv', 'Portfolio (investment) value history')}
    </section>
    <section class="grid g2">
      ${chartBox('ch-cat', 'Category allocation', '', 280)}
      ${chartBox('ch-asset', 'Asset allocation', '', 280)}
    </section>
    <section class="grid g2">
      ${chartBox('ch-pl', 'Monthly investment result (P&L)', html`<span class="muted sm">${store.base}, flows excluded</span>`)}
      ${chartBox('ch-flow', 'Monthly deposits vs withdrawals')}
    </section>
    <section class="grid g2">
      ${chartBox('ch-perf', 'Monthly performance (%)', html`<span class="muted sm">${store.setting('performance_method', 'TWR')}</span>`)}
      <div class="card"><div class="card-head"><h3>Recent activity</h3><a href="#/transactions" class="sm">All transactions →</a></div><div id="recent"></div></div>
    </section>`);

  // ---- charts
  const { from } = store.periodRange(period, custom);
  const nw = valuationSeries('net_worth', from === -Infinity ? -Infinity : from - 1);
  const inv = valuationSeries('investment_value', from === -Infinity ? -Infinity : from - 1);
  const line = (id, pts, color) => {
    if (pts.length < 2) { $('#' + id).closest('.chart-wrap').innerHTML = String(html`<div class="chart-empty">History starts at the first daily snapshot${firstSnap ? ' (' + F.dateStr(firstSnap.snapshot_date) + ')' : ''}. ${pts.length ? 'Current value: ' + F.php(pts[pts.length - 1].value) : ''}<br><a href="#/settings">Take or rebuild snapshots</a></div>`); return; }
    chart($('#' + id), { type: 'line', data: { labels: pts.map((p) => F.dateStr(p.date) + (p.live ? ' (now)' : '')), datasets: [{ data: pts.map((p) => p.value), borderColor: color, backgroundColor: color + '22', fill: true, tension: 0.25, pointRadius: pts.length > 40 ? 0 : 2, borderWidth: 2 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => F.php(c.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => F.php(v, { compact: true }) } } } } });
  };
  line('ch-nw', nw, cssVar('--c1'));
  line('ch-inv', inv, cssVar('--c2'));

  const pal = PALETTE();
  const cats = Object.entries(st.allocation).filter(([, v]) => v > 0);
  const dough = (id, labels, values) => {
    if (!values.length) { $('#' + id).closest('.chart-wrap').innerHTML = String(html`<div class="chart-empty">Nothing to allocate yet.</div>`); return; }
    const total = values.reduce((a, b) => a + b, 0);
    chart($('#' + id), { type: 'doughnut', data: { labels, datasets: [{ data: values, backgroundColor: pal, borderColor: cssVar('--panel'), borderWidth: 2 }] },
      options: { cutout: '64%', plugins: { legend: { position: window.innerWidth < 640 ? 'bottom' : 'right' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${F.php(c.parsed)} (${(c.parsed / total * 100).toFixed(1)}%)` } } } } });
  };
  dough('ch-cat', cats.map(([k]) => BUCKET_LABELS[k]), cats.map(([, v]) => v));
  const byAsset = [...st.byAsset].filter((a) => a.valueBase > 0).sort((a, b) => b.valueBase - a.valueBase);
  const top = byAsset.slice(0, 7), rest = byAsset.slice(7).reduce((x, a) => x + a.valueBase, 0);
  const aLabels = [...(s.cash > 0 ? ['Cash'] : []), ...top.map((a) => a.ticker || a.name), ...(rest > 0 ? ['Other'] : [])];
  const aValues = [...(s.cash > 0 ? [s.cash] : []), ...top.map((a) => a.valueBase), ...(rest > 0 ? [rest] : [])];
  dough('ch-asset', aLabels, aValues);

  const mp = monthlyPerformance();
  if (!mp.length) ['ch-pl', 'ch-perf'].forEach((id) => { $('#' + id).closest('.chart-wrap').innerHTML = String(html`<div class="chart-empty">Monthly results appear once daily snapshots span more than one day.</div>`); });
  else {
    const up = cssVar('--up'), down = cssVar('--down');
    chart($('#ch-pl'), { type: 'bar', data: { labels: mp.map((m) => monthLabel(m.month) + (m.partial ? '*' : '')), datasets: [{ data: mp.map((m) => m.gain), backgroundColor: mp.map((m) => (m.gain >= 0 ? up : down)), borderRadius: 4 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => F.php(c.parsed.y, { sign: true }) } } }, scales: { y: { ticks: { callback: (v) => F.php(v, { compact: true }) } } } } });
    chart($('#ch-perf'), { type: 'bar', data: { labels: mp.map((m) => monthLabel(m.month)), datasets: [{ data: mp.map((m) => m.returnPct), backgroundColor: mp.map((m) => ((m.returnPct || 0) >= 0 ? up : down)), borderRadius: 4 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => F.pct(c.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } } });
  }
  const mf = Core.monthlyFlows(st.events, store.tz).slice(-12);
  if (!mf.length) $('#ch-flow').closest('.chart-wrap').innerHTML = String(html`<div class="chart-empty">No deposits or withdrawals yet.</div>`);
  else chart($('#ch-flow'), { type: 'bar', data: { labels: mf.map((m) => monthLabel(m.month)), datasets: [
    { label: 'Deposits', data: mf.map((m) => m.deposits), backgroundColor: cssVar('--c2'), borderRadius: 4 },
    { label: 'Withdrawals', data: mf.map((m) => -m.withdrawals), backgroundColor: cssVar('--c5'), borderRadius: 4 }] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + F.php(Math.abs(c.parsed.y)) } } }, scales: { y: { ticks: { callback: (v) => F.php(v, { compact: true }) } } } } });

  // ---- recent activity
  const recent = store.txs().filter((t) => t.type !== 'REVERSAL').slice(0, 10);
  mount($('#recent'), recent.length ? html`<ul class="activity">${recent.map(activityItem)}</ul>` : html`<p class="muted">No activity yet.</p>`);

}

export function activityItem(t) {
  const acc = store.account(t.account_id), asset = t.asset_id ? store.asset(t.asset_id) : null;
  const cls = { DEPOSIT: 'up', OPENING_BALANCE: 'up', INCOME: 'up', TRANSFER_IN: 'flat', WITHDRAWAL: 'down', FEE: 'down', TRANSFER_OUT: 'flat', BUY: 'flat', SELL: 'flat' }[t.type] || 'flat';
  const amount = t.type === 'BUY' || t.type === 'SELL' ? t.quantity * t.unit_price : t.gross_amount;
  const desc = asset ? `${F.qty(t.quantity)} ${asset.ticker || asset.name}${t.unit_price ? ' @ ' + F.money(t.unit_price, t.currency) : ''}` : t.remarks || '';
  return html`<li class="${t.status === 'REVERSED' ? 'reversed' : ''}"><span class="dot ${cls}"></span>
    <div class="act-main"><strong>${F.typeLabel(t.type)}</strong>${t.status === 'REVERSED' ? F.badge('reversed', 'muted') : ''}<span class="muted"> · ${acc?.name || '—'}</span><div class="muted sm">${desc}</div></div>
    <div class="act-side"><div class="amt">${t.type === 'ASSET_TRANSFER_OUT' || t.type === 'ASSET_TRANSFER_IN' || t.type === 'ADD_POSITION' && !amount ? '' : F.money(amount, t.currency)}</div><div class="muted sm">${F.date(t.occurred_at)}</div></div></li>`;
}
