import { store } from '../state.js';
const Core = window.WealthCore;

/** Valuation points from stored snapshots (+ the live valuation as the final point). */
export function valuationSeries(field = 'net_worth', fromMs = -Infinity) {
  const pts = Core.snapshotSeries(store.snapshots(), store.tz, field).filter((p) => p.t > fromMs);
  const liveField = { net_worth: 'netWorth', investment_value: 'investment', total_assets: 'totalAssets', cash_value: 'cash' }[field];
  const today = Core.localDate(Date.now(), store.tz);
  const withoutToday = pts.filter((p) => p.date !== today);
  if (store.txs().length) withoutToday.push({ t: Date.now(), date: today, value: store.live.summary[liveField], live: true });
  return withoutToday;
}

/**
 * Monthly investment results from snapshots. For each month with a valuation at both
 * the previous month-end and this month-end (or now): gain = ΔV − external flows,
 * plus a chain-linked TWR over the month's daily snapshots.
 */
export function monthlyPerformance() {
  const series = valuationSeries('net_worth');
  if (series.length < 2) return [];
  const byMonth = new Map();
  series.forEach((p) => { const m = p.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(p); });
  const months = [...byMonth.keys()].sort();
  const out = [];
  months.forEach((m, i) => {
    const inMonth = byMonth.get(m);
    const prev = i > 0 ? byMonth.get(months[i - 1]).slice(-1)[0] : null;
    const pts = prev ? [prev, ...inMonth] : inMonth;
    if (pts.length < 2) return;
    const perf = Core.performance(pts, store.live.events, pts[0].t, pts[pts.length - 1].t, store.setting('performance_method', 'TWR'));
    out.push({ month: m, gain: perf.gain, returnPct: perf.returnPct, netFlows: perf.netFlows, startValue: perf.startValue, endValue: perf.endValue, partial: !prev });
  });
  return out;
}

export function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1] + ' ' + String(y).slice(2);
}

export const BUCKET_LABELS = { CASH: 'Cash', CRYPTO: 'Crypto', STOCK: 'Stocks', BUSINESS: 'Business', PROPERTY: 'Property', OTHER: 'Other assets' };

/** Period report figures from the ledger (all reproducible). */
export function periodReport(fromMs, toMs) {
  const open = fromMs === -Infinity ? null : store.stateAt(fromMs);
  const close = toMs >= Date.now() - 1000 ? store.live : store.stateAt(toMs);
  const ev = Core.sumEvents(store.live.events, fromMs === -Infinity ? -Infinity : fromMs, toMs);
  const openNW = open ? open.summary.netWorth : 0;
  const gain = Core.base2(close.summary.netWorth - openNW - ev.flows);
  const unrealizedChange = Core.base2(close.summary.unrealized - (open ? open.summary.unrealized : 0));
  return { open, close, flows: ev, openNW, closeNW: close.summary.netWorth, gain, unrealizedChange };
}
